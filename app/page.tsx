import { DAYS_OF_HISTORY } from "@/features/expected-sync/open-meteo";
import { syncExpectedProduction } from "@/features/expected-sync/sync";
import { supabase } from "@/lib/supabase";

// Every visit reads the current state of the database. Without this the page would
// be prerendered at build time, which would also mean the build needs a reachable
// database to succeed.
export const dynamic = "force-dynamic";

// The table stays readable while the database keeps every day ever synced.
const ROWS_SHOWN = 14;

type RunRow = {
  status: string;
  started_at: string;
  finished_at: string | null;
  rows_written: number;
  error: string | null;
};

type DayRow = {
  date: string;
  radiation_mj_m2: number;
  expected_kwh: number;
};

const statusStyles: Record<string, string> = {
  succeeded: "bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-300",
  failed: "bg-red-100 text-red-800 dark:bg-red-950 dark:text-red-300",
  running: "bg-amber-100 text-amber-800 dark:bg-amber-950 dark:text-amber-300",
};

function formatKwh(value: number): string {
  return value.toLocaleString("en-US", {
    minimumFractionDigits: 1,
    maximumFractionDigits: 1,
  });
}

export default async function Home() {
  const { data: lastRun, error: runError } = await supabase
    .from("sync_runs")
    .select("status, started_at, finished_at, rows_written, error")
    .eq("kind", "expected_fetch")
    .order("started_at", { ascending: false })
    .limit(1)
    .maybeSingle<RunRow>();

  // count is the total number of stored days, unaffected by the limit below.
  const {
    data: days,
    count,
    error: daysError,
  } = await supabase
    .from("expected_daily")
    .select("date, radiation_mj_m2, expected_kwh", { count: "exact" })
    .order("date", { ascending: false })
    .limit(ROWS_SHOWN)
    .returns<DayRow[]>();

  // A query that failed is not the same as a site with no data, and rendering the
  // empty state for both would hide a broken database behind a plausible page.
  if (runError || daysError) {
    throw new Error(`Could not read production data: ${runError?.message ?? daysError?.message}`);
  }

  return (
    <div className="min-h-full bg-zinc-50 font-sans dark:bg-black">
      <main className="mx-auto flex w-full max-w-3xl flex-col gap-8 px-6 py-16">
        <header className="flex flex-col gap-1">
          <h1 className="text-2xl font-semibold tracking-tight text-black dark:text-zinc-50">
            solar-sync
          </h1>
          <p className="text-sm text-zinc-600 dark:text-zinc-400">
            Expected production for Leola Rooftop Array, derived from Open-Meteo daily radiation.
          </p>
        </header>

        <section className="flex flex-col gap-4 rounded-lg border border-zinc-200 bg-white p-5 dark:border-zinc-800 dark:bg-zinc-950">
          <div className="flex flex-wrap items-center justify-between gap-4">
            <div className="flex flex-col gap-2">
              <span className="text-xs font-medium tracking-wide text-zinc-500 uppercase">
                Last sync
              </span>
              {lastRun ? (
                <div className="flex flex-wrap items-center gap-3 text-sm">
                  <span
                    className={`rounded-full px-2.5 py-0.5 text-xs font-medium ${
                      statusStyles[lastRun.status] ?? "bg-zinc-100 text-zinc-700"
                    }`}
                  >
                    {lastRun.status}
                  </span>
                  <span className="text-zinc-600 dark:text-zinc-400">
                    {new Date(lastRun.started_at).toLocaleString("en-GB")}
                  </span>
                  <span className="text-zinc-600 dark:text-zinc-400">
                    {lastRun.rows_written} rows written
                  </span>
                </div>
              ) : (
                <span className="text-sm text-zinc-600 dark:text-zinc-400">Never run.</span>
              )}
            </div>

            <form action={syncExpectedProduction}>
              <button
                type="submit"
                className="rounded-md bg-black px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-zinc-800 dark:bg-zinc-50 dark:text-black dark:hover:bg-zinc-200"
              >
                Sync {DAYS_OF_HISTORY} days
              </button>
            </form>
          </div>

          {lastRun?.error && (
            <p className="rounded-md bg-red-50 px-3 py-2 font-mono text-xs text-red-800 dark:bg-red-950/50 dark:text-red-300">
              {lastRun.error}
            </p>
          )}
        </section>

        <section className="flex flex-col gap-3">
          <p className="text-xs text-zinc-500">
            {count ?? 0} days on record
            {count && count > ROWS_SHOWN ? `, showing the most recent ${ROWS_SHOWN}` : ""}
          </p>

          <div className="overflow-x-auto rounded-lg border border-zinc-200 dark:border-zinc-800">
            <table className="w-full border-collapse text-sm">
              <thead>
                <tr className="bg-zinc-100 text-left text-xs tracking-wide text-zinc-600 uppercase dark:bg-zinc-900 dark:text-zinc-400">
                  <th className="px-4 py-2 font-medium">Date</th>
                  <th className="px-4 py-2 text-right font-medium">Radiation MJ/m²</th>
                  <th className="px-4 py-2 text-right font-medium">Expected kWh</th>
                </tr>
              </thead>
              <tbody className="bg-white dark:bg-zinc-950">
                {days && days.length > 0 ? (
                  days.map((day) => (
                    <tr key={day.date} className="border-t border-zinc-200 dark:border-zinc-800">
                      {/* Printed as stored. Parsing it into a Date would read the
                          local day as UTC midnight and shift it a day west. */}
                      <td className="px-4 py-2 font-mono text-zinc-900 dark:text-zinc-100">
                        {day.date}
                      </td>
                      <td className="px-4 py-2 text-right text-zinc-600 tabular-nums dark:text-zinc-400">
                        {day.radiation_mj_m2}
                      </td>
                      <td className="px-4 py-2 text-right text-zinc-900 tabular-nums dark:text-zinc-100">
                        {formatKwh(day.expected_kwh)}
                      </td>
                    </tr>
                  ))
                ) : (
                  <tr>
                    <td colSpan={3} className="px-4 py-8 text-center text-zinc-500">
                      No production data yet. Run a sync.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </section>
      </main>
    </div>
  );
}
