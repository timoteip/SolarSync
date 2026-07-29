-- The single site the pipeline currently syncs. Coordinates and timezone are real
-- so that the Open-Meteo call returns genuine data; capacity and performance ratio
-- are representative figures for a commercial rooftop array of this size.

insert into sites (name, latitude, longitude, timezone, capacity_kwp, performance_ratio)
values ('Leola Rooftop Array', 40.08980, -76.18520, 'America/New_York', 250.000, 0.820)
on conflict (name) do nothing;
