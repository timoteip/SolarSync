import type { ReactNode } from "react";

import { importActualProduction } from "@/features/actual-import/import";
import { DAYS_OF_HISTORY } from "@/features/expected-sync/open-meteo";
import { syncExpectedProduction } from "@/features/expected-sync/sync";
import { supabase } from "@/lib/supabase";

// Every visit reads the current state of the database. Without this the page would
// be prerendered at build time, which would also mean the build needs a reachable
// database to succeed.
export const dynamic = "force-dynamic";

// The tables stay readable while the database keeps every day ever recorded.
const ROWS_SHOWN = 14;

type RunRow = {
  id: string;
  status: string;
  started_at: string;
  rows_written: number;
  rows_quarantined: number;
  error: string | null;
};

type ExpectedRow = {
  date: string;
  radiation_mj_m2: number;
  expected_kwh: number;
};

type ActualRow = {
  date: string;
  actual_kwh: number;
  source_file: string;
};

type QuarantineRow = {
  source_row_number: number;
  reason_code: string;
  reason_detail: string | null;
  raw_payload: { line?: string };
};

const RUN_COLUMNS = "id, status, started_at, rows_written, rows_quarantined, error";

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

/**
 * The outcome of the most recent run of one kind, with whatever control starts the
 * next one. Both halves of the pipeline report themselves the same way, so a failure
 * looks the same wherever it happened.
 */
function RunPanel({
  label,
  run,
  children,
}: {
  label: string;
  run: RunRow | null;
  children: ReactNode;
}) {
  return (
    <div className="flex flex-col gap-4 rounded-lg border border-zinc-200 bg-white p-5 dark:border-zinc-800 dark:bg-zinc-950">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div className="flex flex-col gap-2">
          <span className="text-xs font-medium tracking-wide text-zinc-500 uppercase">{label}</span>
          {run ? (
            <div className="flex flex-wrap items-center gap-3 text-sm">
              <span
                className={`rounded-full px-2.5 py-0.5 text-xs font-medium ${
                  statusStyles[run.status] ?? "bg-zinc-100 text-zinc-700"
                }`}
              >
                {run.status}
              </span>
              <span className="text-zinc-600 dark:text-zinc-400">
                {new Date(run.started_at).toLocaleString("en-GB")}
              </span>
              <span className="text-zinc-600 dark:text-zinc-400">
                {run.rows_written} rows written
              </span>
              {/* Only shown when it happened. A permanent "0 quarantined" would read
                  as a metric to watch rather than as an exception worth opening. */}
              {run.rows_quarantined > 0 && (
                <span className="font-medium text-amber-700 dark:text-amber-400">
                  {run.rows_quarantined} quarantined
                </span>
              )}
            </div>
          ) : (
            <span className="text-sm text-zinc-600 dark:text-zinc-400">Never run.</span>
          )}
        </div>

        {children}
      </div>

      {run?.error && (
        <p className="rounded-md bg-red-50 px-3 py-2 font-mono text-xs text-red-800 dark:bg-red-950/50 dark:text-red-300">
          {run.error}
        </p>
      )}
    </div>
  );
}

export default async function Home() {
  const { data: expectedRun, error: expectedRunError } = await supabase
    .from("sync_runs")
    .select(RUN_COLUMNS)
    .eq("kind", "expected_fetch")
    .order("started_at", { ascending: false })
    .limit(1)
    .maybeSingle<RunRow>();

  const { data: importRun, error: importRunError } = await supabase
    .from("sync_runs")
    .select(RUN_COLUMNS)
    .eq("kind", "actual_import")
    .order("started_at", { ascending: false })
    .limit(1)
    .maybeSingle<RunRow>();

  // count is the total number of stored days, unaffected by the limit below.
  const {
    data: expectedDays,
    count: expectedCount,
    error: expectedError,
  } = await supabase
    .from("expected_daily")
    .select("date, radiation_mj_m2, expected_kwh", { count: "exact" })
    .order("date", { ascending: false })
    .limit(ROWS_SHOWN)
    .returns<ExpectedRow[]>();

  const {
    data: actualDays,
    count: actualCount,
    error: actualError,
  } = await supabase
    .from("actual_daily")
    .select("date, actual_kwh, source_file", { count: "exact" })
    .order("date", { ascending: false })
    .limit(ROWS_SHOWN)
    .returns<ActualRow[]>();

  // Scoped to the latest import rather than to the whole table, so the rows on show
  // are the ones the operator just submitted and not a backlog of old rejections.
  const { data: rejectedRows, error: rejectedError } = importRun
    ? await supabase
        .from("quarantine")
        .select("source_row_number, reason_code, reason_detail, raw_payload")
        .eq("sync_run_id", importRun.id)
        .order("source_row_number", { ascending: true })
        .returns<QuarantineRow[]>()
    : { data: null, error: null };

  // A query that failed is not the same as a site with no data, and rendering the
  // empty state for both would hide a broken database behind a plausible page.
  const readError =
    expectedRunError ?? importRunError ?? expectedError ?? actualError ?? rejectedError;

  if (readError) {
    throw new Error(`Could not read production data: ${readError.message}`);
  }

  return (
    <div className="min-h-full bg-zinc-50 font-sans dark:bg-black">
      <main className="mx-auto flex w-full max-w-3xl flex-col gap-12 px-6 py-16">
        <header className="flex items-center gap-3">
          {/* The same drawing as app/icon.svg, inlined so it costs no extra request.
              Hidden from screen readers because the name sits right beside it. */}
          <svg viewBox="0 0 24 24" aria-hidden="true" className="h-9 w-9 shrink-0">
            <circle cx="12" cy="12" r="5.5" fill="#facc15" />
            <path
              d="M15.08 3.54 A 9 9 0 1 1 3.98 7.91"
              fill="none"
              stroke="#3e6db5"
              strokeWidth="2.2"
              strokeLinecap="round"
            />
            <polygon points="4.84,5.35 5.42,9.6 1.66,8.24" fill="#3e6db5" />
          </svg>
          <div className="flex flex-col gap-1">
            <h1 className="text-2xl font-semibold tracking-tight text-black dark:text-zinc-50">
              solar-sync
            </h1>
            <p className="text-sm text-zinc-600 dark:text-zinc-400">
              Expected and reported production for Leola Rooftop Array.
            </p>
          </div>
        </header>

        <section className="flex flex-col gap-4">
          <h2 className="text-sm font-semibold text-black dark:text-zinc-50">
            Expected production
          </h2>

          <RunPanel label="Last sync" run={expectedRun}>
            <form action={syncExpectedProduction}>
              <button
                type="submit"
                className="rounded-md bg-black px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-zinc-800 dark:bg-zinc-50 dark:text-black dark:hover:bg-zinc-200"
              >
                Sync {DAYS_OF_HISTORY} days
              </button>
            </form>
          </RunPanel>

          <p className="text-xs text-zinc-500">
            {expectedCount ?? 0} days on record
            {expectedCount && expectedCount > ROWS_SHOWN
              ? `, showing the most recent ${ROWS_SHOWN}`
              : ""}
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
                {expectedDays && expectedDays.length > 0 ? (
                  expectedDays.map((day) => (
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
                      No expected production yet. Run a sync.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </section>

        <section className="flex flex-col gap-4">
          <h2 className="text-sm font-semibold text-black dark:text-zinc-50">Actual production</h2>

          <RunPanel label="Last import" run={importRun}>
            <form action={importActualProduction} className="flex flex-wrap items-center gap-3">
              <label className="sr-only" htmlFor="file">
                Production CSV
              </label>
              <input
                id="file"
                name="file"
                type="file"
                accept=".csv,text/csv"
                required
                className="max-w-full text-sm text-zinc-600 file:mr-3 file:rounded-md file:border-0 file:bg-zinc-100 file:px-3 file:py-2 file:text-sm file:font-medium file:text-zinc-900 hover:file:bg-zinc-200 dark:text-zinc-400 dark:file:bg-zinc-800 dark:file:text-zinc-100 dark:hover:file:bg-zinc-700"
              />
              <button
                type="submit"
                className="rounded-md bg-black px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-zinc-800 dark:bg-zinc-50 dark:text-black dark:hover:bg-zinc-200"
              >
                Import
              </button>
            </form>
          </RunPanel>

          {rejectedRows && rejectedRows.length > 0 && (
            <div className="flex flex-col gap-2">
              <p className="text-xs text-zinc-500">
                Rows the last import rejected. None of them reached the production table, and none
                of them were thrown away.
              </p>

              <div className="overflow-x-auto rounded-lg border border-amber-200 dark:border-amber-900">
                <table className="w-full border-collapse text-sm">
                  <thead>
                    <tr className="bg-amber-50 text-left text-xs tracking-wide text-amber-800 uppercase dark:bg-amber-950/40 dark:text-amber-300">
                      <th className="px-4 py-2 font-medium">Row</th>
                      <th className="px-4 py-2 font-medium">Reason</th>
                      <th className="px-4 py-2 font-medium">Detail</th>
                      <th className="px-4 py-2 font-medium">Submitted</th>
                    </tr>
                  </thead>
                  <tbody className="bg-white dark:bg-zinc-950">
                    {rejectedRows.map((row) => (
                      <tr
                        key={row.source_row_number}
                        className="border-t border-zinc-200 dark:border-zinc-800"
                      >
                        <td className="px-4 py-2 text-zinc-600 tabular-nums dark:text-zinc-400">
                          {row.source_row_number}
                        </td>
                        <td className="px-4 py-2 font-mono text-xs whitespace-nowrap text-amber-700 dark:text-amber-400">
                          {row.reason_code}
                        </td>
                        <td className="px-4 py-2 text-zinc-900 dark:text-zinc-100">
                          {row.reason_detail}
                        </td>
                        <td className="px-4 py-2 font-mono text-xs text-zinc-500">
                          {row.raw_payload.line}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          <p className="text-xs text-zinc-500">
            {actualCount ?? 0} days on record
            {actualCount && actualCount > ROWS_SHOWN
              ? `, showing the most recent ${ROWS_SHOWN}`
              : ""}
          </p>

          <div className="overflow-x-auto rounded-lg border border-zinc-200 dark:border-zinc-800">
            <table className="w-full border-collapse text-sm">
              <thead>
                <tr className="bg-zinc-100 text-left text-xs tracking-wide text-zinc-600 uppercase dark:bg-zinc-900 dark:text-zinc-400">
                  <th className="px-4 py-2 font-medium">Date</th>
                  <th className="px-4 py-2 text-right font-medium">Actual kWh</th>
                  <th className="px-4 py-2 font-medium">Source file</th>
                </tr>
              </thead>
              <tbody className="bg-white dark:bg-zinc-950">
                {actualDays && actualDays.length > 0 ? (
                  actualDays.map((day) => (
                    <tr key={day.date} className="border-t border-zinc-200 dark:border-zinc-800">
                      <td className="px-4 py-2 font-mono text-zinc-900 dark:text-zinc-100">
                        {day.date}
                      </td>
                      <td className="px-4 py-2 text-right text-zinc-900 tabular-nums dark:text-zinc-100">
                        {formatKwh(day.actual_kwh)}
                      </td>
                      <td className="px-4 py-2 text-zinc-500">{day.source_file}</td>
                    </tr>
                  ))
                ) : (
                  <tr>
                    <td colSpan={3} className="px-4 py-8 text-center text-zinc-500">
                      No reported production yet. Import a CSV.
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
