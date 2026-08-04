// WMO weather interpretation codes, as used by Open-Meteo's API.
const WEATHER_CODE_DESCRIPTIONS: Record<number, string> = {
  0: 'clear sky',
  1: 'mainly clear',
  2: 'partly cloudy',
  3: 'overcast',
  45: 'fog',
  48: 'depositing rime fog',
  51: 'light drizzle',
  53: 'moderate drizzle',
  55: 'dense drizzle',
  56: 'light freezing drizzle',
  57: 'dense freezing drizzle',
  61: 'slight rain',
  63: 'moderate rain',
  65: 'heavy rain',
  66: 'light freezing rain',
  67: 'heavy freezing rain',
  71: 'slight snow fall',
  73: 'moderate snow fall',
  75: 'heavy snow fall',
  77: 'snow grains',
  80: 'slight rain showers',
  81: 'moderate rain showers',
  82: 'violent rain showers',
  85: 'slight snow showers',
  86: 'heavy snow showers',
  95: 'thunderstorm',
  96: 'thunderstorm with slight hail',
  99: 'thunderstorm with heavy hail'
}

export function describeWeatherCode(code: number): string {
  return WEATHER_CODE_DESCRIPTIONS[code] ?? `unknown conditions (code ${code})`
}

interface GeocodeResult {
  latitude: number
  longitude: number
  name: string
  country: string
}

interface GeocodeResponse {
  results?: { latitude: number; longitude: number; name: string; country: string }[]
}

interface ForecastResponse {
  current: {
    temperature_2m: number
    relative_humidity_2m: number
    weather_code: number
    wind_speed_10m: number
  }
  daily: {
    time: string[]
    weather_code: number[]
    temperature_2m_max: number[]
    temperature_2m_min: number[]
  }
}

async function geocodeLocation(location: string): Promise<GeocodeResult | undefined> {
  const url = `https://geocoding-api.open-meteo.com/v1/search?name=${encodeURIComponent(location)}&count=1&language=en&format=json`
  const response = await fetch(url)

  if (!response.ok) {
    throw new Error(`Geocoding request failed with status ${response.status}`)
  }

  const data = (await response.json()) as GeocodeResponse
  const result = data.results?.[0]

  return result
    ? {
        latitude: result.latitude,
        longitude: result.longitude,
        name: result.name,
        country: result.country
      }
    : undefined
}

/**
 * Free, no-API-key weather lookup via Open-Meteo (geocoding + forecast).
 * Returns a plain-text summary suitable for feeding back to the model as a
 * tool result; throws on network/API failure so the caller decides how to
 * surface that.
 */
export async function getWeather(location: string): Promise<string> {
  const place = await geocodeLocation(location)
  if (!place) {
    return `Error: could not find a location named "${location}".`
  }

  const url = `https://api.open-meteo.com/v1/forecast?latitude=${place.latitude}&longitude=${place.longitude}&current=temperature_2m,relative_humidity_2m,weather_code,wind_speed_10m&daily=weather_code,temperature_2m_max,temperature_2m_min&timezone=auto&forecast_days=3`
  const response = await fetch(url)

  if (!response.ok) {
    throw new Error(`Forecast request failed with status ${response.status}`)
  }

  const data = (await response.json()) as ForecastResponse
  const { current, daily } = data

  const lines = [
    `Current weather in ${place.name}, ${place.country}: ${describeWeatherCode(current.weather_code)}, ${current.temperature_2m}°C, humidity ${current.relative_humidity_2m}%, wind ${current.wind_speed_10m} km/h.`,
    '3-day forecast:'
  ]

  for (let i = 0; i < daily.time.length; i++) {
    lines.push(
      `- ${daily.time[i]}: ${describeWeatherCode(daily.weather_code[i])}, high ${daily.temperature_2m_max[i]}°C / low ${daily.temperature_2m_min[i]}°C`
    )
  }

  return lines.join('\n')
}
