// 作ったプランと手を入れた分（このブラウザに取っておく形）。再読み込みしても消えないように、言語ごとに 1 つ持つ
import type { AreaData, Condition, GeoHit, TransitRoute } from '../types'
import type { LegMode } from './geo'
import type { BaseItem, Pace, Slot } from './planner'
import { expireGoogleLocations } from './place'
import { nameFound, stripFound } from './found'
import { allLangs, byLang, isEn } from './i18n'

export type Pin = { id: string; slot: Slot }
// 「この近くの場所を足す」で足した場所と、足す前の並び（もう一度押したときに戻すため）。kept: その場所を外さない印をこのときに付けた
export type FocusAdd = { added: string[]; before: BaseItem[]; kept: boolean }

const BASE = 'intentrip:v1'
export const STORE = byLang(BASE)
const OLD_STORE = 'zurashi-tabi:v1' // 名前を変える前の置き場（11-05）

// 入力の画面の出発地・到着地（作り直すときに同じ入力で始める）。fromHit・toHit は地図のデータで引いた場所、
// back は出発地に戻る旅、preset は作り置きのエリアのボタンから出発地を入れたときのエリアの名前
export type SavedForm = { fromHit: GeoHit | null; back: boolean; to: string; toHit: GeoHit | null; preset: string | null }

export type Saved = {
  data: AreaData
  // 出発地の欄に書いた文字（前の形では、エリアの欄に書いた文字）
  areaText: string
  form?: SavedForm
  wish: string
  conds: Condition[]
  condsTouched: boolean
  date: string
  start: number
  end: number
  must: string[]
  pinned: Pin[]
  banned: string[]
  overrides: Record<string, TransitRoute>
  modes?: Record<string, LegMode> // 本人が選んだ区間の手段（legKey ごと）
  stayFix: Record<string, number>
  focus: string[]
  focusAdds?: Record<string, FocusAdd>
  skipDistricts: string[]
  base: BaseItem[] | null
  // 最後に見せていたプランの並び。開き直したときは、場所と並びをこのままにして時刻だけを計算する
  shown?: BaseItem[]
  loose?: string[]
  pace?: Pace
  moveLess?: boolean
  calm?: boolean
  fill?: boolean // false: 選んだ場所と食事だけで組む（空いた時間に足さない）
  leeway?: number // 帰る時刻より早く終わってもよい時間（分）
  // 前の始まり方で最初に見せていた例のプラン（自分で作ったプランではない）
  example?: boolean
  // この旅を作り始めた時刻（行きたい場所を選ぶ画面を開いた時刻）。理由とミッションは、これより後の分を、この旅の物とみなす
  since?: number
}

export const isSaved = (s: unknown): s is Saved => {
  const v = s as Saved | null
  return !!v && typeof v === 'object' && !!v.data && Array.isArray(v.data.places)
}

export function readSaved(): Saved | null {
  try {
    const raw = window.localStorage.getItem(STORE) ?? (isEn ? null : window.localStorage.getItem(OLD_STORE))
    if (!isEn) window.localStorage.removeItem(OLD_STORE)
    if (!raw) return null
    const s = JSON.parse(raw) as unknown
    if (!isSaved(s)) return null
    expireGoogleLocations(s.data.places)
    nameFound(s.data.places)
    return s
  } catch {
    return null
  }
}

// 端末に取ってあるプランを全部（両方の言語と、名前を変える前の置き場）見て、Places から取って 30 日を過ぎた位置を
// 照合の前の位置に戻す。開いていない方の言語のプランにも期限を過ぎた位置を残さないよう、起動のときに 1 回呼ぶ
export function expireSavedLocations(now = Date.now()) {
  for (const key of [...allLangs(BASE), OLD_STORE]) {
    try {
      const raw = window.localStorage.getItem(key)
      const s = raw ? (JSON.parse(raw) as unknown) : null
      if (isSaved(s) && expireGoogleLocations(s.data.places, now) > 0) window.localStorage.setItem(key, JSON.stringify(s))
    } catch {
      /* 読めない・書けない置き場は、そのまま */
    }
  }
}

// 端末の今のプランが別の旅（since の違うプラン）に置き換わる直前に呼ぶ関数（trips.ts が、今の旅を端末の棚へ移すのに使う）
let beforeReplace: ((next: Saved) => void) | null = null
export function onReplaceSaved(f: (next: Saved) => void) {
  beforeReplace = f
}
let storedSince: number | null | undefined

// 書き込めたら true（端末の空きが足りないときなどは false）
export function writeSaved(s: Saved): boolean {
  try {
    if (storedSince === undefined) {
      const cur = readSaved()
      storedSince = cur && !cur.example ? (cur.since ?? 0) : null
    }
    if (beforeReplace && storedSince !== null && storedSince !== (s.since ?? 0)) beforeReplace(s)
    const places = stripFound(s.data.places)
    window.localStorage.setItem(STORE, JSON.stringify(places === s.data.places ? s : { ...s, data: { ...s.data, places } }))
    storedSince = s.example ? null : (s.since ?? 0)
    return true
  } catch {
    return false
  }
}

// 端末の今のプランを消す（ホーム画面の削除。端末の棚へは移さない）
export function clearSaved() {
  try {
    window.localStorage.removeItem(STORE)
  } catch {
    // 消せなくても、画面の状態は空にする
  }
  storedSince = null
}

// もう片方の言語で作った、端末のプラン（ホーム画面に「英語で作った旅」として出す）。無ければ null
export function readOtherSaved(): Saved | null {
  try {
    const raw = window.localStorage.getItem(isEn ? BASE : `${BASE}:en`)
    const s = raw ? (JSON.parse(raw) as unknown) : null
    return isSaved(s) && !s.example ? s : null
  } catch {
    return null
  }
}
