# solar-sync

Live at [solar-sync-gamma.vercel.app](https://solar-sync-gamma.vercel.app).

A daily data-integration pipeline for solar sites. It pulls solar radiation for a site
from the [Open-Meteo](https://open-meteo.com/) API, derives the production that site
should have generated, and imports the production the operator actually reported.

The interesting part of the project is the seam between two data sources that disagree
with each other, so the design leans on auditability: every sync is logged, every
rejected input row is kept along with the reason it was rejected, and every derived
number stores the raw value it came from.

## What it does

- **Expected production** — fetches daily shortwave radiation for the site and derives
  expected output from its capacity and performance ratio. The radiation figure, the
  capacity and the ratio are all stored next to the result, so a row stays explicable
  if the formula is ever retuned.
- **Actual production** — imports an operator's CSV. Rows that fail validation go to a
  quarantine table carrying a reason code and the line exactly as it was submitted.
  Nothing is dropped silently, and a file with bad rows still imports its good ones.
- **Run log** — every sync and every import writes a record, successes and failures
  alike. The record is opened before the work starts, so a run that dies partway
  through is still visible as a run that was attempted.
- **Dashboard** — the outcome of the most recent sync and the most recent import, how
  many rows that import rejected, and the two series on one row per day with a verdict
  on whether they agree.

## What it deliberately does not do

- **The CSV parser does not handle quoted fields.** It splits on commas. The files it
  reads are machine exports of daily totals — a date, a number and a site name — so a
  value containing a comma is rejected as a malformed row rather than stored as a
  guess. That limit is the reason the project does not pull in a CSV library.
- **The comparison is a flat tolerance, not a diagnosis.** A day is flagged when the
  reported figure sits more than 10% from the derived one, in either direction. It does
  not say why, and it does not adapt the threshold to the season or to the weather. The
  point is to narrow a month down to the days worth opening.
- **The comparison is driven by reported days.** A day with expected production and no
  report does not appear. It is a gap in reporting rather than a variance, and the run
  log is where an absent import shows up.
- **The dashboard counts rejected rows without listing them.** The import panel shows
  how many a file lost and the rows themselves are in `quarantine`, reason and original
  line intact, but nothing on the page reads them back. Screen space went to the
  comparison instead.
- **One site.** The expected sync looks it up by name. Nothing about the schema is
  single-site, but nothing iterates yet either.
- **No tests.** `features/actual-import/parse-csv.ts` is pure and takes no database, so
  it is the piece written to be tested first.
- **No authentication, and no row level security policies.** Every database call is
  made from server code holding the service role key. There is no browser-side key to
  restrict, so there is no per-user rule to express. RLS is enabled on every table with
  no policy, which denies everything that does not bypass it.
- **Uploads are capped at 1 MB** by the server action default. Not raised, because the
  files this reads are a few kilobytes.

## Stack

Next.js 16 (App Router) with TypeScript in strict mode, Tailwind CSS, and Supabase
Postgres. Data access is server-side only; the service role key never reaches the
browser. Deployed to Vercel.

## Getting started

```bash
npm install
cp .env.example .env.local   # then fill in the Supabase values
npm run dev
```

The app runs at http://localhost:3000.

A fresh database needs the migrations in `supabase/migrations` applied in filename
order, then `supabase/seed.sql` to insert the site.

## Scripts

| Script                 | Purpose                     |
| ---------------------- | --------------------------- |
| `npm run dev`          | Development server          |
| `npm run build`        | Production build            |
| `npm run typecheck`    | TypeScript with no emit     |
| `npm run lint`         | ESLint                      |
| `npm run format`       | Prettier, writing in place  |
| `npm run format:check` | Prettier in check-only mode |

## Project layout

```
app/         routes, pages, and the reset the dashboard offers
features/    one folder per slice, each owning its own fetch, logic, and persistence
lib/         environment validation and the Supabase client
samples/     a deliberately imperfect CSV, one bad row per rejection reason
supabase/    schema migrations and seed data
```
