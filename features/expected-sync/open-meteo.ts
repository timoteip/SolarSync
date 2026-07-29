// Open-Meteo needs no API key. The forecast endpoint serves recent past days from
// its own reanalysis, which is what `past_days` reaches back into. Data older than
// roughly three months lives on the separate archive endpoint instead.
const ENDPOINT = "https://api.open-meteo.com/v1/forecast";

// How much history one sync pulls. The ceiling Open-Meteo documents is 92.
export const DAYS_OF_HISTORY = 30;

export type DailyRadiation = {
  /** A local day at the site, already in the requested timezone. Never shifted. */
  date: string;
  radiationMjM2: number;
};

type OpenMeteoResponse = {
  daily?: {
    time?: string[];
    shortwave_radiation_sum?: (number | null)[];
  };
};

export async function fetchDailyRadiation(site: {
  latitude: number;
  longitude: number;
  timezone: string;
}): Promise<DailyRadiation[]> {
  const url = new URL(ENDPOINT);
  url.searchParams.set("latitude", String(site.latitude));
  url.searchParams.set("longitude", String(site.longitude));
  url.searchParams.set("daily", "shortwave_radiation_sum");
  url.searchParams.set("past_days", String(DAYS_OF_HISTORY));
  // Today is still in progress, so its radiation total would understate the day.
  url.searchParams.set("forecast_days", "0");
  // Asking for the site's own zone makes the returned dates local days at the site,
  // which is what expected_daily stores. Without this they would come back as UTC.
  url.searchParams.set("timezone", site.timezone);

  // A sync must see today's answer, never a cached one from an earlier run.
  const response = await fetch(url, { cache: "no-store" });

  if (!response.ok) {
    throw new Error(`Open-Meteo returned ${response.status} ${response.statusText}`);
  }

  const body: OpenMeteoResponse = await response.json();
  const dates = body.daily?.time;
  const radiation = body.daily?.shortwave_radiation_sum;

  if (!dates || !radiation || dates.length !== radiation.length) {
    throw new Error("Open-Meteo response did not contain matching daily arrays");
  }

  // A null reading means Open-Meteo has no figure for that day, so there is nothing
  // to derive an expected output from. Those days are left absent rather than stored
  // as a zero, which would read as a day the site genuinely produced nothing.
  const days: DailyRadiation[] = [];
  for (let i = 0; i < dates.length; i++) {
    const value = radiation[i];
    if (value !== null && value !== undefined) {
      days.push({ date: dates[i], radiationMjM2: value });
    }
  }

  return days;
}
