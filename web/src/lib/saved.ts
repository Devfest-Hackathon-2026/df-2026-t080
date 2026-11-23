// 作ったプランと手を入れた分（このブラウザに取っておく形）。再読み込みしても消えないように、言語ごとに 1 つ持つ
import type { AreaData, Condition, GeoHit, Spot, TransitRoute, TripPoint } from '../types'
import type { LegMode } from './geo'
import type { BaseItem, Pace, Slot } from './planner'
import type { TripWants } from './stayTalk'
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
  // 本人がプランに手を入れた（例のプランは、手を入れたものだけを端末の棚とクラウドに残す）
  edited?: boolean
  // 何日かある旅の全日（今開いている日の位置は null、ほかは各日の Saved から days と day を除いた物）と、今開いている日（0 始まり）
  days?: (Saved | null)[]
  day?: number
  // 予定している日数（作った日数より多いときだけ。まだ作っていない日も、日の切り替えに出す）
  planDays?: number
  // 泊ごとの宿（k 番目が k+1 泊目・入っていない泊は null で、前の泊と同じ。これから作る日の出発地・到着地に使う）と、
  // 旅の最後に観光を終える場所（null なら 1日目の出発地）
  stays?: (TripPoint | null)[]
  tripEnd?: TripPoint | null
  // 旅全体の希望と、日ごとの希望と時刻（泊まりの旅を 1 行の文から作ったときだけ。次の日を作るときに使う）
  wants?: TripWants
  // 泊まりの旅で、入りきらずにプランから外した見どころ（まだどの日にも入れていない場所。次の日の候補が出さないことがあるので場所ごと持つ）
  carry?: Spot[]
  // 車で回る旅（旅の全日で 1 つ。徒歩と車で回り、電車・バスは使わない）
  car?: boolean
}

const isObj = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v)
const isNum = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v)
const isPoint = (v: unknown): v is TripPoint => isObj(v) && typeof v.text === 'string' && typeof v.name === 'string' && isNum(v.lat) && isNum(v.lng)
const isDayWant = (v: unknown) => isObj(v) && (v.wish === undefined || typeof v.wish === 'string') && (v.start === undefined || isNum(v.start)) && (v.end === undefined || isNum(v.end))
const isSpot = (v: unknown) => isObj(v) && typeof v.id === 'string' && typeof v.name === 'string' && isNum(v.lat) && isNum(v.lng) && typeof v.kind === 'string' && Array.isArray(v.crowd)
const isBody = (v: unknown): v is Saved => isObj(v) && isObj(v.data) && Array.isArray(v.data.places)

// 旅の全日の分（days・day・planDays・stays・tripEnd・wants・carry・car）のうち、形の壊れた物を外す（無い物として扱う）
function dropBroken(v: Record<string, unknown>) {
  if (v.stays !== undefined && !(Array.isArray(v.stays) && v.stays.every((x) => x === null || isPoint(x)))) delete v.stays
  if (v.tripEnd !== undefined && v.tripEnd !== null && !isPoint(v.tripEnd)) delete v.tripEnd
  const w = v.wants
  if (w !== undefined && !(isObj(w) && typeof w.wish === 'string' && Array.isArray(w.days) && w.days.every(isDayWant))) delete v.wants
  if (v.planDays !== undefined && !isNum(v.planDays)) delete v.planDays
  if (v.carry !== undefined && !(Array.isArray(v.carry) && v.carry.every(isSpot))) delete v.carry
  if (v.car !== undefined && typeof v.car !== 'boolean') delete v.car
  if (v.days !== undefined && !(Array.isArray(v.days) && v.days.every((d) => d === null || isBody(d)))) {
    delete v.days
    delete v.day
  }
  if (v.day !== undefined && !isNum(v.day)) delete v.day
}

// 取っておいた形か（旅の全日の分で形の壊れた物は、ここで外す）
export const isSaved = (s: unknown): s is Saved => {
  if (!isBody(s)) return false
  dropBroken(s as unknown as Record<string, unknown>)
  return true
}

// 本体とほかの日の場所の一覧（何日かある旅は、全日の分）
export const placeLists = (s: Saved) => [s.data.places, ...(s.days ?? []).flatMap((d) => (d?.data?.places ? [d.data.places] : [])), ...(s.carry?.length ? [s.carry] : [])]

// 取っておく形にする（全日の、検索から追加した場所の名前と営業時間を外す）
export function stripSaved(s: Saved): Saved {
  const strip = (d: Saved): Saved => {
    const places = stripFound(d.data.places)
    return places === d.data.places ? d : { ...d, data: { ...d.data, places } }
  }
  const stripped = strip(s)
  const carry = s.carry?.length ? stripFound(s.carry) : s.carry
  const body = carry === s.carry ? stripped : { ...stripped, carry }
  if (!s.days?.length) return body
  return { ...body, days: s.days.map((d) => (d ? strip(d) : null)) }
}

export function readSaved(): Saved | null {
  try {
    const raw = window.localStorage.getItem(STORE) ?? (isEn ? null : window.localStorage.getItem(OLD_STORE))
    if (!isEn) window.localStorage.removeItem(OLD_STORE)
    if (!raw) return null
    const s = JSON.parse(raw) as unknown
    if (!isSaved(s)) return null
    for (const list of placeLists(s)) {
      expireGoogleLocations(list)
      nameFound(list)
    }
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
      if (isSaved(s) && placeLists(s).reduce((n, list) => n + expireGoogleLocations(list, now), 0) > 0) window.localStorage.setItem(key, JSON.stringify(s))
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
    window.localStorage.setItem(STORE, JSON.stringify(stripSaved(s)))
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
