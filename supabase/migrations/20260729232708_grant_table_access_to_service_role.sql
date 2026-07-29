-- The API layer connects to Postgres as one of Supabase's own roles rather than as
-- the table owner, so tables created by a migration are unreachable until granted
-- explicitly. The default privileges that would normally cover this are registered
-- against supabase_admin, and migrations run as postgres, so they never applied.
--
-- Only service_role is granted anything. Every read and write in this project comes
-- from server code holding the service role key; the browser is never given a key of
-- its own. Leaving anon and authenticated with no data access at all means a key that
-- escapes into client code still cannot reach production figures.

grant select, insert, update, delete on all tables in schema public to service_role;
