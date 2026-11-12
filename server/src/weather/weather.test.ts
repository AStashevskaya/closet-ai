import { describe, expect, it, vi } from "vitest";
import { createOpenMeteo, mondayOf, skyOf } from "./weather";

describe("skyOf and mondayOf", () => {
  it("reads WMO codes as what they mean for clothes", () => {
    expect([0, 2, 45, 61, 81, 71, 85, 95].map(skyOf)).toEqual([
      "clear",
      "clouds",
      "fog",
      "rain",
      "rain",
      "snow",
      "snow",
      "storm",
    ]);
  });

  it("finds the Monday of any day's week", () => {
    expect(mondayOf("2026-11-12")).toBe("2026-11-09"); // a Thursday
    expect(mondayOf("2026-11-09")).toBe("2026-11-09");
    expect(mondayOf("2026-11-15")).toBe("2026-11-09"); // a Sunday
  });
});

// 13 days, 6 before Thursday 2026-11-12 and 6 after, as Open-Meteo answers.
const days = Array.from({ length: 13 }, (_, i) =>
  new Date(Date.UTC(2026, 10, 6 + i)).toISOString().slice(0, 10),
);
const forecast = {
  daily: {
    time: days,
    temperature_2m_max: days.map((_, i) => 10 + i + 0.4),
    temperature_2m_min: days.map((_, i) => i),
    weather_code: days.map((_, i) => (i === 6 ? 61 : 2)),
    precipitation_probability_max: days.map((_, i) => (i === 6 ? 80 : null)),
  },
};

function fakeFetch(found = true) {
  return vi.fn(async (url: URL | string) => {
    const href = String(url);
    const body = href.includes("geocoding")
      ? { results: found ? [{ name: "Минск", latitude: 53.9, longitude: 27.56 }] : [] }
      : forecast;
    return new Response(JSON.stringify(body), { status: 200 });
  });
}

describe("createOpenMeteo", () => {
  it("finds the city and gives Monday to Sunday of this week", async () => {
    const fetcher = fakeFetch();
    const week = await createOpenMeteo(fetcher as typeof fetch).week(
      { city: "Minsk", country: "BY" },
      "ru",
    );
    expect(week!.place).toBe("Минск");
    expect(week!.today).toBe("2026-11-12");
    expect(week!.days.map((d) => d.date)).toEqual([
      "2026-11-09",
      "2026-11-10",
      "2026-11-11",
      "2026-11-12",
      "2026-11-13",
      "2026-11-14",
      "2026-11-15",
    ]);
    expect(week!.days[3]).toEqual({ date: "2026-11-12", max: 16, min: 6, sky: "rain", wet: 80 });
    // Only the city goes out, with its country.
    const geo = new URL(String(fetcher.mock.calls[0]![0]));
    expect(geo.searchParams.get("name")).toBe("Minsk");
    expect(geo.searchParams.get("countryCode")).toBe("BY");
  });

  it("asks once an hour per city, and says null for a city it can't find", async () => {
    const fetcher = fakeFetch();
    let now = 0;
    const weather = createOpenMeteo(fetcher as typeof fetch, () => now);
    await weather.week({ city: "Minsk", country: null }, "ru");
    await weather.week({ city: "minsk", country: null }, "ru");
    expect(fetcher).toHaveBeenCalledTimes(2);
    now = 61 * 60 * 1000;
    await weather.week({ city: "Minsk", country: null }, "ru");
    expect(fetcher).toHaveBeenCalledTimes(4);

    expect(
      await createOpenMeteo(fakeFetch(false) as typeof fetch).week(
        { city: "Nowhere", country: null },
        "en",
      ),
    ).toBeNull();
  });
});
