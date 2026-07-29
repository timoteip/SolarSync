"use server";

import { revalidatePath } from "next/cache";

import { supabase } from "@/lib/supabase";
import { fetchDailyRadiation } from "./open-meteo";

// The one site this slice syncs. The name is the hardcoded part, not the id: the
// seed generates the id with gen_random_uuid(), so it differs on every db reset.
const SITE_NAME = "Leola Rooftop Array";

// One kilowatt hour is 3.6 megajoules.
const MJ_PER_KWH = 3.6;

type SiteRow = {
  id: string;
  latitude: number;
  longitude: number;
  timezone: string;
  capacity_kwp: number;
  performance_ratio: number;
};

function expectedKwh(site: SiteRow, radiationMjM2: number): number {
  const insolationKwhM2 = radiationMjM2 / MJ_PER_KWH;
  return insolationKwhM2 * site.capacity_kwp * site.performance_ratio;
}

export async function syncExpectedProduction(): Promise<void> {
  // The run is recorded before any work starts, so a process that dies partway
  // through still leaves evidence of having tried. Nothing here knows the site yet;
  // site_id is filled in by the same update that closes the run out.
  const { data: run, error: runError } = await supabase
    .from("sync_runs")
    .insert({ kind: "expected_fetch", status: "running" })
    .select("id")
    .single<{ id: string }>();

  // This is the one failure that cannot be recorded, because recording is what
  // failed. Throwing is the only honest option left.
  if (runError || !run) {
    throw new Error(`Could not open a sync run: ${runError?.message}`);
  }

  try {
    const { data: site, error: siteError } = await supabase
      .from("sites")
      .select("id, latitude, longitude, timezone, capacity_kwp, performance_ratio")
      .eq("name", SITE_NAME)
      // maybeSingle rather than single, so a missing site is an absent row to report
      // in plain words instead of a coercion error from the API layer.
      .maybeSingle<SiteRow>();

    if (siteError) {
      throw new Error(`Could not look up ${SITE_NAME}: ${siteError.message}`);
    }

    if (!site) {
      throw new Error(`No site named ${SITE_NAME} exists.`);
    }

    const days = await fetchDailyRadiation(site);
    const fetchedAt = new Date().toISOString();

    // capacity_kwp and performance_ratio are stored on every row alongside the
    // radiation they were applied to, so a row stays explicable after either is
    // retuned. Re-syncing a day overwrites it rather than adding a second figure.
    const rows = days.map((day) => ({
      site_id: site.id,
      date: day.date,
      radiation_mj_m2: day.radiationMjM2,
      expected_kwh: expectedKwh(site, day.radiationMjM2),
      capacity_kwp_used: site.capacity_kwp,
      performance_ratio_used: site.performance_ratio,
      sync_run_id: run.id,
      // Sent explicitly rather than left to the column default, which only applies
      // on insert. An overwritten row would otherwise name this run while carrying
      // the timestamp of the one that first created it.
      fetched_at: fetchedAt,
    }));

    const { error: upsertError } = await supabase
      .from("expected_daily")
      .upsert(rows, { onConflict: "site_id,date" });

    if (upsertError) {
      throw new Error(`Could not write expected production: ${upsertError.message}`);
    }

    await supabase
      .from("sync_runs")
      .update({
        status: "succeeded",
        finished_at: new Date().toISOString(),
        rows_written: rows.length,
        site_id: site.id,
      })
      .eq("id", run.id);
  } catch (error) {
    // The failure becomes a row rather than a stack trace, which is what makes it
    // visible on the dashboard. Rethrowing would replace the page with an error
    // screen and hide the record that was just written.
    await supabase
      .from("sync_runs")
      .update({
        status: "failed",
        finished_at: new Date().toISOString(),
        error: error instanceof Error ? error.message : String(error),
      })
      .eq("id", run.id);
  }

  revalidatePath("/");
}
