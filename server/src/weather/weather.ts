import { z } from "zod";

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
  // The city's offset from UTC, for which day a moment falls on there.
  offsetSeconds: number;
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
// A city's place and its week barely change within half an hour.
const CACHE_MS = 30 * 60 * 1000;
// Cities are typed by people: the cache is capped, the oldest going first.
const CACHE_MAX = 500;
// A service that doesn't answer in this long counts as unavailable, rather than holding her screen.
const TIMEOUT_MS = 4000;

type Fetch = typeof fetch;

// Open-Meteo's answers, checked: a change in its format is "unavailable", not quiet nonsense.
const geocodeAnswer = z.object({
  results: z
    .array(z.object({ name: z.string(), latitude: z.number(), longitude: z.number() }))
    .optional(),
});
const forecastAnswer = z.object({
  utc_offset_seconds: z.number(),
  daily: z.object({
    time: z.array(z.string()).length(13),
    temperature_2m_max: z.array(z.number()).length(13),
    temperature_2m_min: z.array(z.number()).length(13),
    weather_code: z.array(z.number()).length(13),
    precipitation_probability_max: z.array(z.number().nullable()).length(13),
  }),
});

// The local date at a UTC offset, YYYY-MM-DD.
export const localDate = (at: number, offsetSeconds: number) =>
  new Date(at + offsetSeconds * 1000).toISOString().slice(0, 10);

// All three app languages: she may type her city in any of them.
const SEARCH_LANGUAGES = ["ru", "en", "he"];

// Open-Meteo: free, no key, and only the city's name and coordinates leave the server (no user).
export function createOpenMeteo(fetcher: Fetch = fetch, now = () => Date.now()): WeatherClient {
  // Promises, so two requests for a city nobody asked about yet make one call between them.
  const cache = new Map<string, { at: number; week: Promise<WeekWeather | null> }>();
  const get = async (url: URL) => {
    const response = await fetcher(url, { signal: AbortSignal.timeout(TIMEOUT_MS) });
    if (!response.ok) throw new Error(`weather: ${response.status} from ${url.host}`);
    return await response.json();
  };

  // Open-Meteo matches a name in the language asked: "Минск" isn't found in English. So the app's
  // language first (its name for the place), then the others, since she may have typed the city
  // in another language than the one the app is in (QA, 2026-11-12).
  async function findSpot(city: string, country: string | null, lang: string) {
    const languages = [lang, ...SEARCH_LANGUAGES.filter((l) => l !== lang)];
    // At once, so a city found in no language costs one wait, not three; one that fails or times
    // out doesn't hide another that finds it.
    const tries = await Promise.allSettled(
      languages.map(async (language) => {
        const geo = new URL(GEOCODE);
        geo.searchParams.set("name", city);
        geo.searchParams.set("count", "1");
        geo.searchParams.set("language", language);
        if (country) geo.searchParams.set("countryCode", country);
        return geocodeAnswer.parse(await get(geo)).results?.[0] ?? null;
      }),
    );
    // The app's language first: its name for the place.
    for (const tried of tries) if (tried.status === "fulfilled" && tried.value) return tried.value;
    // Nothing found: "not found" only when every language answered; else the weather is down.
    const failed = tries.find((tried) => tried.status === "rejected");
    if (failed) throw failed.reason;
    return null;
  }

  async function fetchWeek(city: string, country: string | null, lang: string) {
    const spot = await findSpot(city, country, lang);
    if (!spot) return null;

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
    const { daily, utc_offset_seconds: offset } = forecastAnswer.parse(await get(url));
    // The forecast's own "today": the 7th of 13 days (6 past, today, 6 ahead).
    const today = daily.time[6]!;
    const from = daily.time.indexOf(mondayOf(today));
    const days = daily.time.slice(from, from + 7).map((date, i) => ({
      date,
      max: Math.round(daily.temperature_2m_max[from + i]!),
      min: Math.round(daily.temperature_2m_min[from + i]!),
      sky: skyOf(daily.weather_code[from + i]!),
      wet: daily.precipitation_probability_max[from + i] ?? 0,
    }));
    return { place: spot.name, days, today, offsetSeconds: offset };
  }

  return {
    async week({ city, country }, lang) {
      const key = `${city.trim().toLowerCase()}|${country ?? ""}|${lang}`;
      const hit = cache.get(key);
      if (hit && now() - hit.at < CACHE_MS) {
        const week = await hit.week;
        // Past midnight in the city, a week read yesterday is asked for again.
        if (!week || localDate(now(), week.offsetSeconds) === week.today) return week;
      }
      const week = fetchWeek(city.trim(), country, lang);
      if (cache.size >= CACHE_MAX) cache.delete(cache.keys().next().value!);
      cache.set(key, { at: now(), week });
      // A failure isn't kept: the next request tries again.
      week.catch(() => cache.delete(key));
      return week;
    },
  };
}
