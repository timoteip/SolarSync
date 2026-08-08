"use server";

import { revalidatePath } from "next/cache";

import { supabase } from "@/lib/supabase";

/**
 * Empties the pipeline back to a freshly seeded database.
 *
 * This is a demo affordance rather than a slice, which is why it lives beside the
 * page that offers it instead of under features/. Nothing in the pipeline calls it.
 *
 * sites is left alone. The expected sync looks its site up by name, so removing that
 * row would leave the button below it with nothing to sync.
 *
 * No sync_runs record is written for the reset itself. Every sync logs a run; a reset
 * is not a sync, and a record written into a table that is about to be emptied would
 * only survive by contradicting the thing it recorded.
 */
export async function clearAllData(): Promise<void> {
  // Children before parents. expected_daily and actual_daily both carry a
  // sync_run_id with no cascade on it, so the runs cannot be deleted while either
  // table still references them. quarantine does cascade, and goes with the runs.
  //
  // The filters are here because the API refuses a delete with no filter at all,
  // which is a guard against emptying a table by leaving one off. Both columns are
  // declared not null, so "is not null" is how this says every row on purpose.
  const targets = [
    { table: "expected_daily", column: "date" },
    { table: "actual_daily", column: "date" },
    { table: "sync_runs", column: "id" },
  ];

  for (const target of targets) {
    const { error } = await supabase.from(target.table).delete().not(target.column, "is", null);

    if (error) {
      throw new Error(`Could not clear ${target.table}: ${error.message}`);
    }
  }

  revalidatePath("/");
}
