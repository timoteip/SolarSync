# solar-sync

A daily data-integration pipeline for solar sites. It pulls solar radiation and weather
for a site from the [Open-Meteo](https://open-meteo.com/) API, derives the production
that site should have generated, imports the production it actually reported, and
surfaces the gap between the two.

The interesting part of the project is the seam between two data sources that disagree
with each other, so the design leans on auditability: every sync is logged, every
rejected input row is kept along with the reason it was rejected, and every derived
number stores the raw value it came from.

## What it does

- **Expected production** — fetches daily shortwave radiation per site and computes
  expected output from the site's capacity and performance ratio.
- **Actual production** — imports operator-supplied CSV. Rows that fail validation go
  to a quarantine table with a reason attached. Nothing is dropped silently.
- **Run log** — every sync writes a record, successes and failures alike.
- **Dashboard** — last sync status, expected against actual, and variance flags where
  the two diverge beyond tolerance.

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
app/         routes and pages
components/  shared UI
features/    one folder per slice, each owning its own fetch, logic, and persistence
lib/         environment validation and the Supabase client
supabase/    schema migrations and seed data
```
