"use server";

import { revalidatePath } from "next/cache";

import { supabase } from "@/lib/supabase";
import { parseCsv, type CsvRow } from "./parse-csv";

// The columns the importer needs. They are looked up by name rather than by position,
// so a file that lists them in a different order still imports correctly.
const SITE_COLUMN = "site";
const DATE_COLUMN = "date";
const KWH_COLUMN = "kwh";

type SiteRow = {
  id: string;
  name: string;
};

// One of the reason codes the quarantine table accepts. Naming them here means a
// typo is a compile error rather than a constraint violation at write time.
type ReasonCode =
  | "missing_column"
  | "unparseable_date"
  | "non_numeric_value"
  | "negative_value"
  | "unknown_site"
  | "duplicate_in_file";

type Rejection = {
  reasonCode: ReasonCode;
  reasonDetail: string;
  siteId: string | null;
};

type Accepted = {
  siteId: string;
  date: string;
  kwh: number;
};

function isRealDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    return false;
  }

  const [year, month, day] = value.split("-").map(Number);

  // Built in local time and compared part by part, so only the calendar arithmetic
  // matters. Postgres rolls 2026-02-30 forward silently; this catches it instead.
  const date = new Date(year, month - 1, day);
  return date.getFullYear() === year && date.getMonth() === month - 1 && date.getDate() === day;
}

/**
 * Decides what to do with one row. Returns the figure to store, or the reason it
 * cannot be stored. Checks run in a fixed order and the first failure wins, so a row
 * with two problems is reported by the first one a person would notice.
 */
function checkRow(
  row: CsvRow,
  columns: { site: number; date: number; kwh: number },
  sitesByName: Map<string, SiteRow>,
  headerLength: number,
  seen: Set<string>,
): Accepted | Rejection {
  if (row.values.length !== headerLength) {
    return {
      reasonCode: "missing_column",
      reasonDetail: `Expected ${headerLength} fields, found ${row.values.length}.`,
      siteId: null,
    };
  }

  const siteName = row.values[columns.site];
  const date = row.values[columns.date];
  const kwh = row.values[columns.kwh];

  for (const [name, value] of [
    [SITE_COLUMN, siteName],
    [DATE_COLUMN, date],
    [KWH_COLUMN, kwh],
  ]) {
    if (value === "") {
      return {
        reasonCode: "missing_column",
        reasonDetail: `The ${name} column is empty.`,
        siteId: null,
      };
    }
  }

  if (!isRealDate(date)) {
    return {
      reasonCode: "unparseable_date",
      reasonDetail: `${date} is not a calendar date in YYYY-MM-DD form.`,
      siteId: null,
    };
  }

  const parsedKwh = Number(kwh);

  // Number("") is zero and Number("1e999") is Infinity, so neither a blank nor an
  // overflowing figure may be trusted to the plain conversion alone.
  if (!Number.isFinite(parsedKwh)) {
    return {
      reasonCode: "non_numeric_value",
      reasonDetail: `${kwh} is not a number.`,
      siteId: null,
    };
  }

  if (parsedKwh < 0) {
    return {
      reasonCode: "negative_value",
      reasonDetail: `${kwh} is below zero, and a site cannot generate a negative amount.`,
      siteId: null,
    };
  }

  // Matched without regard to case, since the name is typed by whoever produced the
  // export rather than copied out of our own table.
  const site = sitesByName.get(siteName.toLowerCase());

  if (!site) {
    return {
      reasonCode: "unknown_site",
      reasonDetail: `No site named ${siteName} exists.`,
      siteId: null,
    };
  }

  const key = `${site.id}|${date}`;

  // The first figure for a day is the one that is kept. Letting the last one win
  // would make the stored value depend on the order of the file, with nothing left
  // to show that the file disagreed with itself.
  if (seen.has(key)) {
    return {
      reasonCode: "duplicate_in_file",
      reasonDetail: `${date} already appeared earlier in this file for ${site.name}.`,
      siteId: site.id,
    };
  }

  seen.add(key);
  return { siteId: site.id, date, kwh: parsedKwh };
}

export async function importActualProduction(formData: FormData): Promise<void> {
  // Opened before the file is even read, for the same reason the expected sync opens
  // one first: an import that dies partway through still has to be visible as a run
  // that was attempted. site_id stays null because one file may carry rows for more
  // than one site, so the run as a whole is not about any single one.
  //
  // started_at is sent rather than left to the column default, so that both ends of
  // the interval come from this clock instead of one from here and one from the
  // database. See the same insert in the expected sync.
  const { data: run, error: runError } = await supabase
    .from("sync_runs")
    .insert({
      kind: "actual_import",
      status: "running",
      started_at: new Date().toISOString(),
    })
    .select("id")
    .single<{ id: string }>();

  if (runError || !run) {
    throw new Error(`Could not open a sync run: ${runError?.message}`);
  }

  try {
    const file = formData.get("file");

    if (!(file instanceof File) || file.size === 0) {
      throw new Error("No file was chosen, or the file was empty.");
    }

    const { header, rows } = parseCsv(await file.text());

    const columns = {
      site: header.indexOf(SITE_COLUMN),
      date: header.indexOf(DATE_COLUMN),
      kwh: header.indexOf(KWH_COLUMN),
    };

    // A missing column heading is not a bad row, it is a file we cannot read at all.
    // Quarantining every line individually would bury that one fact under noise.
    const missing = Object.entries(columns)
      .filter(([, index]) => index === -1)
      .map(([name]) => name);

    if (missing.length > 0) {
      throw new Error(`The header is missing the ${missing.join(" and ")} column.`);
    }

    const { data: sites, error: sitesError } = await supabase
      .from("sites")
      .select("id, name")
      .returns<SiteRow[]>();

    if (sitesError) {
      throw new Error(`Could not read the site list: ${sitesError.message}`);
    }

    const sitesByName = new Map(sites.map((site) => [site.name.toLowerCase(), site]));

    const accepted: Accepted[] = [];
    const rejected: { row: CsvRow; rejection: Rejection }[] = [];
    const seen = new Set<string>();

    for (const row of rows) {
      const result = checkRow(row, columns, sitesByName, header.length, seen);

      if ("reasonCode" in result) {
        rejected.push({ row, rejection: result });
      } else {
        accepted.push(result);
      }
    }

    // Rejected rows are written first. If the process dies between the two writes,
    // the run is left looking like a failure with its rejections already recorded,
    // which is the safer half to have saved.
    if (rejected.length > 0) {
      const { error: quarantineError } = await supabase.from("quarantine").insert(
        rejected.map(({ row, rejection }) => ({
          sync_run_id: run.id,
          site_id: rejection.siteId,
          source_row_number: row.lineNumber,
          reason_code: rejection.reasonCode,
          reason_detail: rejection.reasonDetail,
          // The line as submitted, not our reading of it. A row rejected for having
          // the wrong number of fields has no reliable mapping to column names, and
          // storing a guess would misrepresent what the operator actually sent.
          raw_payload: { line: row.raw },
        })),
      );

      if (quarantineError) {
        throw new Error(`Could not quarantine the rejected rows: ${quarantineError.message}`);
      }
    }

    if (accepted.length > 0) {
      const importedAt = new Date().toISOString();

      const { error: upsertError } = await supabase.from("actual_daily").upsert(
        accepted.map((entry) => ({
          site_id: entry.siteId,
          date: entry.date,
          actual_kwh: entry.kwh,
          source_file: file.name,
          sync_run_id: run.id,
          // Sent rather than left to the column default, which only applies on
          // insert. Re-importing a day would otherwise keep the first import's time.
          imported_at: importedAt,
        })),
        { onConflict: "site_id,date" },
      );

      if (upsertError) {
        throw new Error(`Could not write actual production: ${upsertError.message}`);
      }
    }

    // A file of thirty good rows and two bad ones is a run that worked. Failing the
    // whole import over a rejected row would throw away thirty valid days, which is
    // the opposite of what the quarantine table exists to prevent.
    const { error: closeError } = await supabase
      .from("sync_runs")
      .update({
        status: "succeeded",
        finished_at: new Date().toISOString(),
        rows_written: accepted.length,
        rows_quarantined: rejected.length,
      })
      .eq("id", run.id);

    // Checked like every other write, so that a refused update shows up as a failed
    // run rather than as one that appears to still be going.
    if (closeError) {
      throw new Error(`Could not close the import run out: ${closeError.message}`);
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);

    const { error: recordError } = await supabase
      .from("sync_runs")
      .update({
        status: "failed",
        finished_at: new Date().toISOString(),
        error: message,
      })
      .eq("id", run.id);

    // Nothing is left that can carry the news, so it goes to the caller instead.
    if (recordError) {
      throw new Error(`${message} (the run could not be marked failed: ${recordError.message})`);
    }
  }

  revalidatePath("/");
}
