// 選んだ理由（場所ごとに、定型の理由と一言）。AI の欠点を見たうえで、自分の理由で選ぶために残す。
// このブラウザに取っておく（エリアごと。サーバーには送らない）。振り返りカードも、ここを読む。
import { useEffect, useState } from 'react'
import { tr } from './i18n'

export type Why = {
  spotId: string
  spotName: string
  chips: string[] // 選んだ定型の理由
  text: string // 自由入力（MAX_TEXT 文字まで。空でもよい）
  downsideSeen: string // 選んだときに見ていた、AI の欠点（spot.downside）
  hit?: 'yes' | 'no' // 旅のあとに「理由は当たったか」
  at: number
}
export type TripWhy = { items: Why[] }

export const MAX_TEXT = 40
export const WHY_CHIPS: readonly string[] = tr({
  ja: ['人が少なそう', '雰囲気が良さそう', '行ってみたかった', '近いから', '歴史を感じたい'],
  en: ['Looks less crowded', 'Nice atmosphere', 'Always wanted to go', 'It’s nearby', 'For the history'],
})

// 理由が空でも、「当たったか」が入っていれば、残す
export const isEmpty = (w: Pick<Why, 'chips' | 'text'> & { hit?: Why['hit'] }) => w.chips.length === 0 && !w.text.trim() && !w.hit

// 検索で入れた場所（lib/found.ts）の id の頭。その場所の名前は Google の Places の内容なので取っておかない
const FOUND_PREFIX = 'g_'
const STORE = 'intentrip:why:v1'
export const WHY_EVENT = 'intentrip:why-change'
const EVENT = WHY_EVENT

function readAll(): Record<string, TripWhy> {
  try {
    return JSON.parse(window.localStorage.getItem(STORE) || '{}') as Record<string, TripWhy>
  } catch {
    return {}
  }
}
export const readTrip = (area: string): TripWhy => readAll()[area] ?? { items: [] }

// 書き込みに失敗したとき（端末の空きが足りないなど）は false を返す
export function writeTrip(area: string, trip: TripWhy): boolean {
  const all = readAll()
  all[area] = { ...trip, items: trip.items.map((w) => (w.spotId.startsWith(FOUND_PREFIX) ? { ...w, spotName: '' } : w)) }
  try {
    window.localStorage.setItem(STORE, JSON.stringify(all))
    return true
  } catch {
    return false
  }
}

export function useTripWhy(area: string) {
  const [trip, setTrip] = useState(() => readTrip(area))
  useEffect(() => {
    const on = () => setTrip(readTrip(area))
    on()
    window.addEventListener(EVENT, on)
    return () => window.removeEventListener(EVENT, on)
  }, [area])

  const get = (spotId: string) => trip.items.find((w) => w.spotId === spotId)

  // 同じ場所の理由は上書きする。理由が空なら消す。ほかの画面にも知らせる
  const put = (w: Why): boolean => {
    const rest = readTrip(area).items.filter((x) => x.spotId !== w.spotId)
    const next: TripWhy = { items: isEmpty(w) ? rest : [...rest, w] }
    const ok = writeTrip(area, next)
    setTrip(next)
    window.dispatchEvent(new Event(EVENT))
    return ok
  }
  const remove = (spotId: string): boolean => {
    const next: TripWhy = { items: readTrip(area).items.filter((x) => x.spotId !== spotId) }
    const ok = writeTrip(area, next)
    setTrip(next)
    window.dispatchEvent(new Event(EVENT))
    return ok
  }
  return { trip, get, put, remove }
}

// 画面の外から書き替えたとき（クラウドの旅を開いたときなど）に、開いている画面へ知らせる
export const notifyWhy = () => window.dispatchEvent(new Event(EVENT))
