// 泊まる宿の欄に出す泊と、離れすぎの一言（旅を作る画面とプランを変更のシートで使う）
import type { GeoHit } from './api'
import { distM } from './geo'
import { tr } from './i18n'

// 片道の出発地と到着地は、これより離れていたら作らない（サーバーの places.MAX_TRIP_KM と同じ）
export const MAX_TRIP_KM = 30

export const FAR_TEXT = tr({
  ja: {
    far: (km: number) => `最初の場所から${km} km あります。${MAX_TRIP_KM} km までにしてください。`,
    farGoal: (km: number) => `観光を終える場所から${km} km あります。${MAX_TRIP_KM} km までにしてください。`,
    farStay: (km: number) => `前の宿から${km} km あります。${MAX_TRIP_KM} km までにしてください。`,
  },
  en: {
    far: (km: number) => `${km} km from the start. Choose a place within ${MAX_TRIP_KM} km.`,
    farGoal: (km: number) => `${km} km from where you end sightseeing. Choose a place within ${MAX_TRIP_KM} km.`,
    farStay: (km: number) => `${km} km from the previous lodging. Choose a place within ${MAX_TRIP_KM} km.`,
  },
})

// 欄に出す泊（毎晩同じ宿のときと、泊が 1 つのときは最初の泊だけ）
export function shownNights(nights: number[], same: boolean): number[] {
  return same || nights.length < 2 ? nights.slice(0, 1) : nights
}

// 宿の欄ごとの、離れすぎているときの一言。hits: 欄に出す泊の宿（空の欄は null＝前の泊と同じ）。
// その日の出発地と到着地の組（start→最初の宿、宿→次の宿、最後の宿→goal）ごとに見る。afterStay: start が前の宿
export function stayFarTexts(start: GeoHit | null, hits: (GeoHit | null)[], goal: GeoHit | null, afterStay: boolean): (string | null)[] {
  const out: (string | null)[] = hits.map(() => null)
  const km = (a: GeoHit, b: GeoHit) => Math.round(distM(a, b) / 1000)
  let prev = start
  let prevStay = afterStay
  let last = -1
  hits.forEach((h, j) => {
    if (!h) return
    if (prev && km(prev, h) > MAX_TRIP_KM) out[j] = (prevStay ? FAR_TEXT.farStay : FAR_TEXT.far)(km(prev, h))
    prev = h
    prevStay = true
    last = j
  })
  if (last >= 0 && prev && goal && !out[last] && km(prev, goal) > MAX_TRIP_KM) out[last] = FAR_TEXT.farGoal(km(prev, goal))
  return out
}
