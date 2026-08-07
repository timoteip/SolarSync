-- Row level security on every table, with no policy written against any of them.
--
-- A table with RLS enabled and no policy denies every request that does not bypass
-- it. service_role does bypass it, and service_role is the only credential this
-- project ever connects with, so nothing the application does is affected.
--
-- The point is the second lock. The previous migration withholds table privileges
-- from anon and authenticated, which is already enough to keep production figures
-- out of a browser. But that is one decision recorded in one place, and a later
-- blanket grant would quietly undo it. Enabling RLS means such a grant would still
-- reach nothing.
--
-- Nobody signs in to this application, so there is no per-user rule to express and
-- no policy belongs here. An empty policy list is the intended state, not an
-- unfinished one.

alter table sites enable row level security;
alter table sync_runs enable row level security;
alter table expected_daily enable row level security;
alter table actual_daily enable row level security;
alter table quarantine enable row level security;
