import type { ReactNode } from "react";

import { importActualProduction } from "@/features/actual-import/import";
import { DAYS_OF_HISTORY } from "@/features/expected-sync/open-meteo";
import { syncExpectedProduction } from "@/features/expected-sync/sync";
import { supabase } from "@/lib/supabase";
import { clearExpectedProduction, clearReportedProduction } from "./reset";

// Every visit reads the current state of the database. Without this the page would
// be prerendered at build time, which would also mean the build needs a reachable
// database to succeed.
export const dynamic = "force-dynamic";

// The table stays readable while the database keeps every day ever recorded.
const ROWS_SHOWN = 14;

// How far the reported figure may sit from the derived one before the day is worth
// opening. A model this simple never lands on the reported number exactly, so the
// tolerance has to be wider than the model's own error. Both directions count:
// production well above what the sun could have supplied is a disagreement too.
const VARIANCE_TOLERANCE = 0.1;

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
  expected_kwh: number;
};

type ActualRow = {
  date: string;
  actual_kwh: number;
};

const RUN_COLUMNS = "id, status, started_at, rows_written, rows_quarantined, error";

const statusStyles: Record<string, string> = {
  succeeded: "bg-emerald-100 text-emerald-800",
  failed: "bg-red-100 text-red-800",
  running: "bg-amber-100 text-amber-800",
};

function formatKwh(value: number): string {
  return value.toLocaleString("en-US", {
    minimumFractionDigits: 1,
    maximumFractionDigits: 1,
  });
}

// A day the sync has not covered is not a day the site got wrong, so it gets its own
// verdict rather than being counted against the operator.
type Verdict = "ok" | "off" | "no-expected";

const verdicts: Record<Verdict, { label: string; style: string }> = {
  ok: { label: "OK", style: "bg-emerald-100 text-emerald-800" },
  off: { label: "Not OK", style: "bg-red-100 text-red-800" },
  "no-expected": { label: "No expected figure", style: "bg-zinc-100 text-zinc-600" },
};

function verdictFor(expectedKwh: number | null, actualKwh: number): Verdict {
  if (expectedKwh === null) {
    return "no-expected";
  }

  // A fully overcast day derives to zero, and dividing by it would give Infinity.
  // Nothing reported against a zero expectation agrees with it; zero does.
  if (expectedKwh === 0) {
    return actualKwh === 0 ? "ok" : "off";
  }

  return Math.abs(actualKwh - expectedKwh) / expectedKwh <= VARIANCE_TOLERANCE ? "ok" : "off";
}

function formatDifference(expectedKwh: number | null, actualKwh: number): string {
  if (expectedKwh === null || expectedKwh === 0) {
    return "—";
  }

  // signDisplay puts a + on the gains, so a column of differences reads as a
  // direction rather than as a set of unrelated numbers.
  return ((actualKwh - expectedKwh) / expectedKwh).toLocaleString("en-US", {
    style: "percent",
    signDisplay: "exceptZero",
    maximumFractionDigits: 0,
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
    <div className="flex flex-col gap-4 rounded-lg border border-zinc-200 bg-white p-5">
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
              <span className="text-zinc-600">
                {new Date(run.started_at).toLocaleString("en-GB")}
              </span>
              <span className="text-zinc-600">{run.rows_written} rows written</span>
              {/* Only shown when it happened. A permanent "0 quarantined" would read
                  as a metric to watch rather than as an exception worth opening. */}
              {run.rows_quarantined > 0 && (
                <span className="font-medium text-amber-700">
                  {run.rows_quarantined} quarantined
                </span>
              )}
            </div>
          ) : (
            <span className="text-sm text-zinc-600">Never run.</span>
          )}
        </div>

        {children}
      </div>

      {run?.error && (
        <p className="rounded-md bg-red-50 px-3 py-2 font-mono text-xs text-red-800">{run.error}</p>
      )}
    </div>
  );
}

/**
 * A destructive control, kept beside the thing it destroys rather than collected with
 * the others at the foot of the page. A native disclosure element gives it its second
 * click without the page needing any JavaScript to hide the button behind the first.
 */
function ClearControl({
  label,
  description,
  action,
}: {
  label: string;
  description: string;
  action: () => Promise<void>;
}) {
  return (
    <details className="text-xs">
      <summary className="w-fit cursor-pointer text-zinc-500 transition-colors hover:text-zinc-800">
        {label}
      </summary>

      <div className="mt-3 flex flex-col items-start gap-3">
        <p className="text-zinc-500">{description}</p>

        <form action={action}>
          <button
            type="submit"
            className="rounded-md border border-red-300 px-3 py-1.5 text-sm font-medium text-red-700 transition-colors hover:bg-red-50"
          >
            Yes, clear it
          </button>
        </form>
      </div>
    </details>
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

  // head skips the rows and asks only for the total, which is all the caption needs.
  const { count: expectedCount, error: expectedCountError } = await supabase
    .from("expected_daily")
    .select("date", { count: "exact", head: true });

  // The comparison is driven by the days that were reported. A day nobody reported
  // is a gap in reporting rather than a variance, and listing every unreported day
  // would bury the handful that can actually be judged.
  const {
    data: actualDays,
    count: actualCount,
    error: actualError,
  } = await supabase
    .from("actual_daily")
    .select("date, actual_kwh", { count: "exact" })
    .order("date", { ascending: false })
    .limit(ROWS_SHOWN)
    .returns<ActualRow[]>();

  const reportedDates = actualDays?.map((day) => day.date) ?? [];

  // Only the derived figures that have a reported day to sit beside.
  const { data: expectedDays, error: expectedError } =
    reportedDates.length > 0
      ? await supabase
          .from("expected_daily")
          .select("date, expected_kwh")
          .in("date", reportedDates)
          .returns<ExpectedRow[]>()
      : { data: null, error: null };

  // A query that failed is not the same as a site with no data, and rendering the
  // empty state for both would hide a broken database behind a plausible page.
  const readError =
    expectedRunError ?? importRunError ?? expectedCountError ?? actualError ?? expectedError;

  if (readError) {
    throw new Error(`Could not read production data: ${readError.message}`);
  }

  // One lookup built once, rather than scanning the expected rows again for every
  // reported day. get returns undefined for a day the sync has not covered, and the
  // rest of the page treats that absence as a value of its own.
  const expectedByDate = new Map<string, number>(
    expectedDays?.map((day) => [day.date, day.expected_kwh]) ?? [],
  );

  const comparison = (actualDays ?? []).map((day) => ({
    date: day.date,
    actualKwh: day.actual_kwh,
    expectedKwh: expectedByDate.get(day.date) ?? null,
  }));

  return (
    <div className="min-h-full bg-zinc-50 font-sans">
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
            <h1 className="text-2xl font-semibold tracking-tight text-black">solar-sync</h1>
            <p className="text-sm text-zinc-600">
              Expected and reported production for Leola Rooftop Array.
            </p>
          </div>
        </header>

        <section className="flex flex-col gap-4">
          <h2 className="text-sm font-semibold text-black">Expected production</h2>

          <RunPanel label="Last sync" run={expectedRun}>
            <form action={syncExpectedProduction}>
              <button
                type="submit"
                className="rounded-md bg-black px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-zinc-800"
              >
                Sync {DAYS_OF_HISTORY} days
              </button>
            </form>
          </RunPanel>

          <p className="text-xs text-zinc-500">
            {expectedCount ?? 0} days derived from radiation on record.
          </p>

          <ClearControl
            label="Clear expected production"
            description="Removes every derived day and the sync runs that produced them. The site itself stays, so there is still something to sync."
            action={clearExpectedProduction}
          />
        </section>

        <section className="flex flex-col gap-4">
          <h2 className="text-sm font-semibold text-black">Reported production</h2>

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
                className="max-w-full text-sm text-zinc-600 file:mr-3 file:rounded-md file:border-0 file:bg-zinc-100 file:px-3 file:py-2 file:text-sm file:font-medium file:text-zinc-900 hover:file:bg-zinc-200"
              />
              <button
                type="submit"
                className="rounded-md bg-black px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-zinc-800"
              >
                Import
              </button>
            </form>
          </RunPanel>

          <p className="text-xs text-zinc-500">{actualCount ?? 0} days reported on record.</p>

          <ClearControl
            label="Clear reported production"
            description="Removes every imported day, every rejected row and the import runs that recorded them. The file itself is not stored, so importing it again is how it comes back."
            action={clearReportedProduction}
          />
        </section>

        <section className="flex flex-col gap-4">
          <h2 className="text-sm font-semibold text-black">Expected against reported</h2>

          <p className="text-xs text-zinc-500">
            A day is OK when the reported figure sits within{" "}
            {VARIANCE_TOLERANCE.toLocaleString("en-US", { style: "percent" })} of the figure derived
            from that day&rsquo;s radiation, in either direction.{" "}
            {comparison.length === ROWS_SHOWN
              ? `Only the most recent ${ROWS_SHOWN} reported days appear.`
              : "Only reported days appear."}
          </p>

          <div className="overflow-x-auto rounded-lg border border-zinc-200">
            <table className="w-full border-collapse text-sm">
              <thead>
                <tr className="bg-zinc-100 text-left text-xs tracking-wide text-zinc-600 uppercase">
                  <th className="px-4 py-2 font-medium">Date</th>
                  <th className="px-4 py-2 text-right font-medium">Expected kWh</th>
                  <th className="px-4 py-2 text-right font-medium">Reported kWh</th>
                  <th className="px-4 py-2 text-right font-medium">Difference</th>
                  <th className="px-4 py-2 font-medium">Status</th>
                </tr>
              </thead>
              <tbody className="bg-white">
                {comparison.length > 0 ? (
                  comparison.map((day) => {
                    const verdict = verdicts[verdictFor(day.expectedKwh, day.actualKwh)];

                    return (
                      <tr key={day.date} className="border-t border-zinc-200">
                        {/* Printed as stored. Parsing it into a Date would read the
                            local day as UTC midnight and shift it a day west. */}
                        <td className="px-4 py-2 font-mono text-zinc-900">{day.date}</td>
                        <td className="px-4 py-2 text-right text-zinc-600 tabular-nums">
                          {day.expectedKwh === null ? "—" : formatKwh(day.expectedKwh)}
                        </td>
                        <td className="px-4 py-2 text-right text-zinc-900 tabular-nums">
                          {formatKwh(day.actualKwh)}
                        </td>
                        <td className="px-4 py-2 text-right text-zinc-600 tabular-nums">
                          {formatDifference(day.expectedKwh, day.actualKwh)}
                        </td>
                        <td className="px-4 py-2">
                          <span
                            className={`rounded-full px-2.5 py-0.5 text-xs font-medium ${verdict.style}`}
                          >
                            {verdict.label}
                          </span>
                        </td>
                      </tr>
                    );
                  })
                ) : (
                  <tr>
                    <td colSpan={5} className="px-4 py-8 text-center text-zinc-500">
                      Nothing to compare yet. Run a sync, then import a CSV.
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
