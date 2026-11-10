// 徒歩の区間の距離。地図に描く道に沿った線（/api/legs）の長さから求める。
// 線がまだ届いていない・取れなかった区間は null（直線の距離は道の距離ではないので使わない）
import { useEffect, useState } from 'react'
import type { Leg } from './geo'
import { LINES_EVENT, legKey, lineCache, type LL } from '../components/mapShared'

const R = 6371008.8
const rad = (d: number) => (d * Math.PI) / 180

function meters(a: LL, b: LL): number {
  const dLat = rad(b[1] - a[1])
  const dLng = rad(b[0] - a[0])
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(rad(a[1])) * Math.cos(rad(b[1])) * Math.sin(dLng / 2) ** 2
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(h)))
}

export function lineMeters(line: LL[]): number {
  let m = 0
  for (let i = 1; i < line.length; i++) m += meters(line[i - 1], line[i])
  return m
}

// 1 km 未満は 50 m ごと、1 km からは 0.1 km ごと
export function distText(m: number): string {
  const r = Math.max(50, Math.round(m / 50) * 50)
  return r < 1000 ? `${r} m` : `${(Math.round(m / 100) / 10).toFixed(1)} km`
}

function walkLine(leg: Leg): LL[] | null {
  if (leg.mode !== 'walk' || leg.real) return null
  return lineCache.get(legKey([leg.from.lng, leg.from.lat], [leg.to.lng, leg.to.lat], 'walk')) ?? null
}

// 区間ごとの、徒歩の道のりの m（徒歩でない区間・線が無い区間は null）。地図が線を取りに行き、届いたら出し直す
export function useWalkMeters(legs: Leg[]): (number | null)[] {
  const [, setTick] = useState(0)
  useEffect(() => {
    const on = () => setTick((t) => t + 1)
    window.addEventListener(LINES_EVENT, on)
    return () => window.removeEventListener(LINES_EVENT, on)
  }, [])
  return legs.map((l) => {
    const line = walkLine(l)
    return line ? lineMeters(line) : null
  })
}
