// The weather for her week, by the city in her profile (look of the day, decided 2026-11-12).
// One module, so tests swap it for a stub and never reach the network.

// What the look of the day needs from a day's weather, not the forecast in full.
export type DaySky = "clear" | "clouds" | "fog" | "rain" | "snow" | "storm";
export interface DayWeather {
  // Local date of the city, YYYY-MM-DD.
  date: string;
  max: number;
  min: number;
  sky: DaySky;
  // Chance of rain or snow over the day, 0 to 100.
  wet: number;
}
export interface WeekWeather {
  // The city as the weather service names it, in the language asked for.
  place: string;
  // Monday to Sunday of the week holding `today`, in the city's time.
  days: DayWeather[];
  today: string;
}

export interface WeatherClient {
  // null when the city can't be found; throws when the service can't be reached.
  week(place: { city: string; country: string | null }, lang: string): Promise<WeekWeather | null>;
}

// WMO weather codes (Open-Meteo's `weather_code`) by what they mean for clothes.
export function skyOf(code: number): DaySky {
  if (code <= 1) return "clear";
  if (code <= 3) return "clouds";
  if (code <= 48) return "fog";
  if (code <= 67 || (code >= 80 && code <= 82)) return "rain";
  if (code <= 77 || code === 85 || code === 86) return "snow";
  return "storm";
}

// The Monday of the week holding a local date, YYYY-MM-DD.
export function mondayOf(date: string) {
  const d = new Date(`${date}T00:00:00Z`);
  const back = (d.getUTCDay() + 6) % 7;
  d.setUTCDate(d.getUTCDate() - back);
  return d.toISOString().slice(0, 10);
}

const GEOCODE = "https://geocoding-api.open-meteo.com/v1/search";
const FORECAST = "https://api.open-meteo.com/v1/forecast";
// A city's place and a week's weather barely change within an hour: one call per city per hour.
const CACHE_MS = 60 * 60 * 1000;

type Fetch = typeof fetch;

// Open-Meteo: free, no key, and only the city's name and coordinates leave the server (no user).
export function createOpenMeteo(fetcher: Fetch = fetch, now = () => Date.now()): WeatherClient {
  const cache = new Map<string, { at: number; week: WeekWeather | null }>();
  return {
    async week({ city, country }, lang) {
      const key = `${city.toLowerCase()}|${country ?? ""}|${lang}`;
      const hit = cache.get(key);
      if (hit && now() - hit.at < CACHE_MS) return hit.week;

      const geo = new URL(GEOCODE);
      geo.searchParams.set("name", city);
      geo.searchParams.set("count", "1");
      geo.searchParams.set("language", lang);
      if (country) geo.searchParams.set("countryCode", country);
      const found = (await (await fetcher(geo)).json()) as {
        results?: { name: string; latitude: number; longitude: number }[];
      };
      const spot = found.results?.[0];
      if (!spot) {
        cache.set(key, { at: now(), week: null });
        return null;
      }

      const url = new URL(FORECAST);
      url.searchParams.set("latitude", String(spot.latitude));
      url.searchParams.set("longitude", String(spot.longitude));
      url.searchParams.set(
        "daily",
        "temperature_2m_max,temperature_2m_min,weather_code,precipitation_probability_max",
      );
      url.searchParams.set("timezone", "auto");
      // Enough on both sides to cover Monday to Sunday of this week, whatever day it is.
      url.searchParams.set("past_days", "6");
      url.searchParams.set("forecast_days", "7");
      const response = await fetcher(url);
      if (!response.ok) throw new Error(`weather: ${response.status}`);
      const body = (await response.json()) as {
        current_weather?: unknown;
        daily: {
          time: string[];
          temperature_2m_max: number[];
          temperature_2m_min: number[];
          weather_code: number[];
          precipitation_probability_max: (number | null)[];
        };
      };
      const { daily } = body;
      // The forecast's own "today": the 7th day of 13 (6 past, today, 6 ahead).
      const today = daily.time[6]!;
      const monday = mondayOf(today);
      const from = daily.time.indexOf(monday);
      const days = daily.time.slice(from, from + 7).map((date, i) => ({
        date,
        max: Math.round(daily.temperature_2m_max[from + i]!),
        min: Math.round(daily.temperature_2m_min[from + i]!),
        sky: skyOf(daily.weather_code[from + i]!),
        wet: daily.precipitation_probability_max[from + i] ?? 0,
      }));
      const week = { place: spot.name, days, today };
      cache.set(key, { at: now(), week });
      return week;
    },
  };
}
