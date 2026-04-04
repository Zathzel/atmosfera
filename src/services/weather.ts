// src/services/weather.ts
// Data sources:
//   • Open-Meteo  — forecast, current conditions, UV, hourly precip (free, no key)
//   • Open-Meteo Air Quality API — AQI + dominant pollutant (free, no key)
//   • Open-Meteo Geocoding — forward geocoding (free, no key)
//   • BigDataCloud  — reverse geocoding (free, no key)

// ─── Public types ─────────────────────────────────────────────────────────────

export interface LocationInfo {
  name: string
  country: string
  latitude: number
  longitude: number
}

export interface CurrentConditions {
  temperature_2m: number
  apparent_temperature: number
  relative_humidity_2m: number
  wind_speed_10m: number
  wind_direction_10m: number   // degrees 0-360
  wind_gusts_10m: number       // peak gust speed
  cloud_cover: number
  surface_pressure: number
  is_day: number
  precipitation: number
  visibility: number           // metres
  dew_point_2m: number         // comfort / fog indicator
  weather_code: number         // WMO weather code
}

export interface CurrentUnits {
  temperature_2m: string
  apparent_temperature: string
  relative_humidity_2m: string
  wind_speed_10m: string
  wind_direction_10m: string
  wind_gusts_10m: string
  cloud_cover: string
  surface_pressure: string
  precipitation: string
  visibility: string
  dew_point_2m: string
}

export interface DailyForecast {
  time: string[]
  temperature_2m_max: number[]
  temperature_2m_min: number[]
  apparent_temperature_max: number[]
  apparent_temperature_min: number[]
  uv_index_max: number[]
  sunrise: string[]
  sunset: string[]
  daylight_duration: number[]          // seconds of daylight
  precipitation_sum: number[]          // mm per day
  precipitation_probability_max: number[]
  wind_speed_10m_max: number[]
  wind_gusts_10m_max: number[]
  weather_code: number[]
  precipitation_summary: string[]      // human-readable daily rain window
}

export interface AirQuality {
  aqi: number                          // European AQI (0–500+)
  aqi_label: string                    // "Good" / "Fair" / "Poor" / "Very Poor" / "Extremely Poor"
  aqi_color: string                    // CSS-safe colour token for UI badges
  pm2_5: number
  pm10: number
  carbon_monoxide: number              // µg/m³
  nitrogen_dioxide: number
  ozone: number
  dominant_pollutant: string
}

export interface WeatherData {
  location: LocationInfo
  current: CurrentConditions
  units: CurrentUnits
  daily: DailyForecast
  air_quality: AirQuality | null       // null when AQI fetch fails (non-fatal)
  fetched_at: string                   // ISO timestamp for cache-busting display
}

// ─── Internal API response shapes ────────────────────────────────────────────

interface GeoResult {
  latitude: number
  longitude: number
  name: string
  country?: string
}

interface OpenMeteoForecastResponse {
  current: CurrentConditions
  current_units: CurrentUnits
  daily: Omit<DailyForecast, 'precipitation_summary'>
  hourly: {
    time: string[]
    precipitation_probability: number[]
  }
}

interface OpenMeteoAQResponse {
  hourly: {
    european_aqi: number[]
    pm2_5: number[]
    pm10: number[]
    carbon_monoxide: number[]
    nitrogen_dioxide: number[]
    ozone: number[]
    dominant_pollution_source?: string[]  // not always present
  }
}

interface BigDataCloudResponse {
  city?: string
  locality?: string
  principalSubdivision?: string
  countryName?: string
}

// ─── Constants ────────────────────────────────────────────────────────────────

const BASE_FORECAST  = 'https://api.open-meteo.com/v1/forecast'
const BASE_AQ        = 'https://air-quality-api.open-meteo.com/v1/air-quality'
const BASE_GEO       = 'https://geocoding-api.open-meteo.com/v1/search'
const BASE_REVERSE   = 'https://api.bigdatacloud.net/data/reverse-geocode-client'

// WMO weather codes → human-readable description
const WMO_CODES: Record<number, string> = {
  0:  'Clear sky', 1: 'Mainly clear', 2: 'Partly cloudy', 3: 'Overcast',
  45: 'Fog', 48: 'Icy fog',
  51: 'Light drizzle', 53: 'Moderate drizzle', 55: 'Dense drizzle',
  61: 'Slight rain', 63: 'Moderate rain', 65: 'Heavy rain',
  71: 'Slight snow', 73: 'Moderate snow', 75: 'Heavy snow', 77: 'Snow grains',
  80: 'Slight showers', 81: 'Moderate showers', 82: 'Violent showers',
  85: 'Slight snow showers', 86: 'Heavy snow showers',
  95: 'Thunderstorm', 96: 'Thunderstorm w/ slight hail', 99: 'Thunderstorm w/ heavy hail',
}

export function describeWeatherCode(code: number): string {
  return WMO_CODES[code] ?? 'Unknown'
}

// ─── AQI helpers ─────────────────────────────────────────────────────────────

interface AQILevel { label: string; color: string }

function classifyAQI(aqi: number): AQILevel {
  if (aqi <=  20) return { label: 'Good',           color: 'ok'      }
  if (aqi <=  40) return { label: 'Fair',            color: 'fair'    }
  if (aqi <=  60) return { label: 'Moderate',        color: 'warn'    }
  if (aqi <=  80) return { label: 'Poor',            color: 'poor'    }
  if (aqi <= 100) return { label: 'Very Poor',       color: 'danger'  }
  return                  { label: 'Extremely Poor', color: 'hazard'  }
}

function firstValid(arr: number[]): number {
  const v = arr.find(n => n != null && !isNaN(n))
  return v !== undefined ? Math.round(v * 10) / 10 : 0
}

// ─── Precipitation summary ───────────────────────────────────────────────────

function buildPrecipitationSummaries(
  hourlyProb: number[],
  dayCount: number,
  threshold = 40,
): string[] {
  return Array.from({ length: dayCount }, (_, i) => {
    const slice = hourlyProb.slice(i * 24, i * 24 + 24)
    const rainHours = slice.reduce<number[]>((acc, p, h) => (p > threshold ? [...acc, h] : acc), [])

    if (rainHours.length === 0) return 'Clear'

    const fmt = (h: number) => `${String(h).padStart(2, '0')}:00`
    if (rainHours.length === 1) return `Rain ~${fmt(rainHours[0])}`

    // Cluster consecutive hours into ranges for readability
    const ranges: string[] = []
    let start = rainHours[0]
    let prev  = rainHours[0]

    for (let k = 1; k < rainHours.length; k++) {
      if (rainHours[k] !== prev + 1) {
        ranges.push(start === prev ? fmt(start) : `${fmt(start)}–${fmt(prev)}`)
        start = rainHours[k]
      }
      prev = rainHours[k]
    }
    ranges.push(start === prev ? fmt(start) : `${fmt(start)}–${fmt(prev)}`)

    return `Rain ${ranges.join(', ')}`
  })
}

// ─── Parallel fetchers ───────────────────────────────────────────────────────

async function fetchForecast(lat: number, lon: number): Promise<OpenMeteoForecastResponse> {
  const params = new URLSearchParams({
    latitude:  String(lat),
    longitude: String(lon),
    current: [
      'temperature_2m', 'relative_humidity_2m', 'apparent_temperature',
      'is_day', 'precipitation', 'cloud_cover', 'surface_pressure',
      'wind_speed_10m', 'wind_direction_10m', 'wind_gusts_10m',
      'visibility', 'dew_point_2m', 'weather_code',
    ].join(','),
    daily: [
      'temperature_2m_max', 'temperature_2m_min',
      'apparent_temperature_max', 'apparent_temperature_min',
      'uv_index_max', 'sunrise', 'sunset', 'daylight_duration',
      'precipitation_sum', 'precipitation_probability_max',
      'wind_speed_10m_max', 'wind_gusts_10m_max', 'weather_code',
    ].join(','),
    hourly:   'precipitation_probability',
    timezone: 'auto',
  })

  const res = await fetch(`${BASE_FORECAST}?${params}`)
  if (!res.ok) throw new Error('Gagal mengambil data cuaca. Coba lagi beberapa saat.')
  return res.json() as Promise<OpenMeteoForecastResponse>
}

async function fetchAirQuality(lat: number, lon: number): Promise<AirQuality | null> {
  try {
    const params = new URLSearchParams({
      latitude:  String(lat),
      longitude: String(lon),
      hourly: [
        'european_aqi', 'pm2_5', 'pm10',
        'carbon_monoxide', 'nitrogen_dioxide', 'ozone',
      ].join(','),
      timezone: 'auto',
      forecast_days: '1',
    })

    const res = await fetch(`${BASE_AQ}?${params}`)
    if (!res.ok) return null

    const data: OpenMeteoAQResponse = await res.json()
    const h = data.hourly

    // Take the most recent non-null reading from the first 24 hrs
    const aqi = firstValid(h.european_aqi)
    const { label, color } = classifyAQI(aqi)

    // Identify dominant pollutant by highest relative concentration
    const pollutants: Record<string, number> = {
      'PM2.5':            firstValid(h.pm2_5),
      'PM10':             firstValid(h.pm10),
      'CO':               firstValid(h.carbon_monoxide) / 1000, // normalise µg/m³ → rough scale
      'NO₂':              firstValid(h.nitrogen_dioxide),
      'O₃':               firstValid(h.ozone),
    }
    const dominant = Object.entries(pollutants).sort((a, b) => b[1] - a[1])[0][0]

    return {
      aqi,
      aqi_label:          label,
      aqi_color:          color,
      pm2_5:              firstValid(h.pm2_5),
      pm10:               firstValid(h.pm10),
      carbon_monoxide:    firstValid(h.carbon_monoxide),
      nitrogen_dioxide:   firstValid(h.nitrogen_dioxide),
      ozone:              firstValid(h.ozone),
      dominant_pollutant: dominant,
    }
  } catch {
    // AQI is supplementary — silently degrade, never break weather display
    return null
  }
}

// ─── Core assembler ───────────────────────────────────────────────────────────

async function buildWeatherData(
  lat: number,
  lon: number,
  name: string,
  country: string,
): Promise<WeatherData> {
  // Fire both requests in parallel — faster than sequential awaits
  const [forecast, airQuality] = await Promise.all([
    fetchForecast(lat, lon),
    fetchAirQuality(lat, lon),
  ])

  const dayCount            = forecast.daily.time.length
  const precipitation_summary = buildPrecipitationSummaries(
    forecast.hourly.precipitation_probability,
    dayCount,
  )

  return {
    location: {
      name,
      country,
      latitude:  Number(lat.toFixed(4)),
      longitude: Number(lon.toFixed(4)),
    },
    current:     forecast.current,
    units:       forecast.current_units,
    daily: {
      ...forecast.daily,
      precipitation_summary,
    },
    air_quality: airQuality,
    fetched_at:  new Date().toISOString(),
  }
}

// ─── Public API ───────────────────────────────────────────────────────────────

export async function getWeatherByCity(city: string): Promise<WeatherData> {
  const geoRes  = await fetch(`${BASE_GEO}?name=${encodeURIComponent(city)}&count=1&language=id&format=json`)
  const geoData = await geoRes.json() as { results?: GeoResult[] }

  if (!geoData.results?.length) {
    throw new Error('Kota tidak ditemukan. Periksa ejaan dan coba lagi.')
  }

  const { latitude, longitude, name, country } = geoData.results[0]
  return buildWeatherData(latitude, longitude, name, country ?? 'Unknown')
}

export async function getWeatherByCoords(latitude: number, longitude: number): Promise<WeatherData> {
  // Reverse-geocode — failure is non-fatal, fallback to generic label
  let name    = 'Lokasi Anda'
  let country = 'Unknown'

  try {
    const r = await fetch(
      `${BASE_REVERSE}?latitude=${latitude}&longitude=${longitude}&localityLanguage=id`
    )
    const d: BigDataCloudResponse = await r.json()
    name    = d.city || d.locality || d.principalSubdivision || name
    country = d.countryName || country
  } catch {
    // Proceed with fallback label
  }

  return buildWeatherData(latitude, longitude, name, country)
}
