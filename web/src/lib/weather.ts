// 天気予報（Open-Meteo・鍵なし）。
import type { Point } from '../types'
import { loggedFetch } from './apiLog'
import { tr } from './i18n'

export type Weather = {
  byHour: Map<number, { temp: number; feels: number; wind: number; code: number; rain: number }>
  max: number
  min: number
  rain: number
  code: number
}

// 天気の種類（値は中で使う印。日本語は Apple の天気アプリの言い方）
function skyKey(code: number): string {
  if (code <= 1) return '晴れ'
  if (code === 2) return '晴れ時々曇り'
  if (code === 3) return '曇り'
  if (code === 45 || code === 48) return '霧'
  if (code >= 51 && code <= 57) return '霧雨'
  if (code === 65 || code === 82) return '強い雨'
  if (code >= 80 && code <= 81) return 'にわか雨'
  if (code >= 61 && code <= 67) return '雨'
  if ((code >= 71 && code <= 77) || code === 85 || code === 86) return '雪'
  if (code >= 95) return '雷雨'
  return '曇り'
}

// 天気のアイコンの種類（WeatherIcon の形）。天気の言葉と同じ分け方にする
export type Sky = 'sun' | 'cloud-sun' | 'cloud' | 'cloud-fog' | 'cloud-drizzle' | 'cloud-rain' | 'cloud-snow' | 'cloud-lightning'
const SKY: Record<string, Sky> = {
  晴れ: 'sun',
  晴れ時々曇り: 'cloud-sun',
  曇り: 'cloud',
  霧: 'cloud-fog',
  霧雨: 'cloud-drizzle',
  強い雨: 'cloud-rain',
  にわか雨: 'cloud-rain',
  雨: 'cloud-rain',
  雪: 'cloud-snow',
  雷雨: 'cloud-lightning',
}
export const weatherSky = (code: number): Sky => SKY[skyKey(code)] ?? 'cloud'

// 画面に出す天気の言葉（英語も Apple の天気アプリの言い方に合わせる）
const SKY_EN: Record<string, string> = {
  晴れ: 'Sunny',
  晴れ時々曇り: 'Partly Cloudy',
  曇り: 'Cloudy',
  霧: 'Foggy',
  霧雨: 'Drizzle',
  強い雨: 'Heavy Rain',
  にわか雨: 'Showers',
  雨: 'Rain',
  雪: 'Snow',
  雷雨: 'Thunderstorms',
}
export const weatherLabel = (code: number): string => tr({ ja: skyKey(code), en: SKY_EN[skyKey(code)] ?? 'Cloudy' })

export async function fetchWeather(p: Point, iso: string): Promise<Weather | null> {
  const url =
    `https://api.open-meteo.com/v1/forecast?latitude=${p.lat.toFixed(4)}&longitude=${p.lng.toFixed(4)}` +
    `&hourly=temperature_2m,apparent_temperature,wind_speed_10m,weather_code,precipitation_probability&daily=temperature_2m_max,temperature_2m_min,precipitation_probability_max,weather_code` +
    `&timezone=Asia%2FTokyo&start_date=${iso}&end_date=${iso}`
  try {
    const r = await loggedFetch(url)
    if (!r.ok) return null
    const j = await r.json()
    const byHour = new Map<number, { temp: number; feels: number; wind: number; code: number; rain: number }>()
    ;(j.hourly?.time ?? []).forEach((t: string, i: number) => {
      byHour.set(Number(t.slice(11, 13)), {
        temp: Math.round(j.hourly.temperature_2m[i]),
        feels: j.hourly.apparent_temperature[i] == null ? NaN : Math.round(j.hourly.apparent_temperature[i]),
        wind: Math.round(j.hourly.wind_speed_10m[i] ?? 0),
        code: j.hourly.weather_code[i],
        rain: j.hourly.precipitation_probability[i] ?? 0,
      })
    })
    if (!j.daily?.time?.length) return null
    return {
      byHour,
      max: Math.round(j.daily.temperature_2m_max[0]),
      min: Math.round(j.daily.temperature_2m_min[0]),
      rain: j.daily.precipitation_probability_max[0] ?? 0,
      code: j.daily.weather_code[0],
    }
  } catch {
    return null
  }
}

// 服装の目安。予定の時間帯の体感温度（風・湿度を含む）の平均から決め、傘と寒暖差のひと言を添える
// notes の icon: 添える印（傘・重ね着・水）
export type WearNote = { icon: 'umbrella' | 'layers' | 'water'; text: string }
export type Wear = { label: string; feels: [number, number]; notes: WearNote[] }

const WEAR: [number, string][] = tr({
  ja: [
    [28, '半袖'],
    [24, '半袖か薄手の長袖'],
    [20, '長袖のシャツ'],
    [16, '薄手の上着'],
    [12, '上着'],
    [8, 'コート'],
    [4, '厚手のコート'],
    [-99, 'ダウンと手袋'],
  ],
  en: [
    [28, 'Short sleeves'],
    [24, 'Short or light long sleeves'],
    [20, 'Long-sleeve shirt'],
    [16, 'Light jacket'],
    [12, 'Jacket'],
    [8, 'Coat'],
    [4, 'Heavy coat'],
    [-99, 'Down jacket and gloves'],
  ],
})
const NOTE = tr({
  ja: {
    umbrella: (p: number) => `降水確率${p}%。傘をお持ちください。`,
    folding: (p: number) => `降水確率${p}%。折りたたみ傘をおすすめします。`,
    swing: '気温差が大きくなります。脱ぎ着しやすい服装をおすすめします。',
    water: 'こまめな水分補給をおすすめします。',
  },
  en: {
    umbrella: (p: number) => `${p}% chance of rain. Bring an umbrella.`,
    folding: (p: number) => `${p}% chance of rain. A folding umbrella is a good idea.`,
    swing: 'Temperatures will vary a lot. Wear layers.',
    water: 'Drink water often.',
  },
})

export function wearFor(w: Weather, startMin: number, endMin: number): Wear | null {
  const hs: { feels: number; rain: number }[] = []
  for (let h = Math.floor(startMin / 60); h <= Math.ceil(endMin / 60); h++) {
    const x = w.byHour.get(h)
    if (x) hs.push(x)
  }
  if (!hs.length) return null
  const feels = hs.map((x) => x.feels).filter(Number.isFinite)
  const lo = feels.length ? Math.min(...feels) : NaN
  const hi = feels.length ? Math.max(...feels) : NaN
  const avg = feels.length ? feels.reduce((a, b) => a + b, 0) / feels.length : NaN
  const label = WEAR.find(([t]) => avg >= t)?.[1] ?? WEAR[WEAR.length - 1][1]
  const rain = Math.max(...hs.map((x) => x.rain))
  const notes: WearNote[] = []
  if (rain >= 50) notes.push({ icon: 'umbrella', text: NOTE.umbrella(rain) })
  else if (rain >= 30) notes.push({ icon: 'umbrella', text: NOTE.folding(rain) })
  if (hi - lo >= 7) notes.push({ icon: 'layers', text: NOTE.swing })
  if (hi >= 30) notes.push({ icon: 'water', text: NOTE.water })
  return { label, feels: [lo, hi], notes }
}
