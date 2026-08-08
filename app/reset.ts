"use server";

import { revalidatePath } from "next/cache";

import { supabase } from "@/lib/supabase";

/**
 * Clearing the data down, one half of the pipeline at a time.
 *
 * These are demo affordances rather than a slice, which is why they live beside the
 * page that offers them instead of under features/. Nothing in the pipeline calls them.
 *
 * sites is left alone by both. The expected sync looks its site up by name, so removing
 * that row would leave the button above it with nothing to sync.
 *
 * Neither clear writes a sync_runs record for itself. Every sync logs a run; a clear is
 * not a sync, and a record written into a table it is about to delete from would only
 * survive by contradicting the thing it recorded.
 */

/**
 * Empties one of the two daily tables. Both declare date not null, so "is not null" is
 * how this says every row on purpose — the API refuses a delete carrying no filter at
 * all, which is a guard against emptying a table by leaving one off.
 */
async function deleteEveryDay(table: "expected_daily" | "actual_daily"): Promise<void> {
  const { error } = await supabase.from(table).delete().not("date", "is", null);

  if (error) {
    throw new Error(`Could not clear ${table}: ${error.message}`);
  }
}

/**
 * Removes the runs of one kind, which is what returns the panel above the table to
 * "Never run". Filtering by kind rather than by the ids the deleted rows referenced
 * also takes the failed runs, which wrote a record and no rows at all.
 *
 * Must be called after the rows, since expected_daily and actual_daily both carry a
 * sync_run_id with no cascade on it.
 */
async function deleteRunsOfKind(kind: "expected_fetch" | "actual_import"): Promise<void> {
  const { error } = await supabase.from("sync_runs").delete().eq("kind", kind);

  if (error) {
    throw new Error(`Could not clear the ${kind} runs: ${error.message}`);
  }
}

export async function clearExpectedProduction(): Promise<void> {
  await deleteEveryDay("expected_daily");
  await deleteRunsOfKind("expected_fetch");

  revalidatePath("/");
}

export async function clearReportedProduction(): Promise<void> {
  await deleteEveryDay("actual_daily");
  // quarantine is not named here because it does not need to be. Its sync_run_id
  // cascades, and every rejected row belongs to an import run, so the rejections go
  // with the runs that recorded them.
  await deleteRunsOfKind("actual_import");

  revalidatePath("/");
}
