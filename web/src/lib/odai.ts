// 旅のミッション（旅全体で 1 つ。設定で 3 つまで）。ミッションごとに写真を 1 枚撮って記録し、出し直しは 2 回まで。
// ミッションの例は data/odai.json
import { useEffect, useState } from 'react'
import type { Spot } from '../types'
import type { Plan, Stop } from './planner'
import { askOdai, hasServer } from './api'
import { fmt } from './time'
import examplesJa from '../data/odai.json'
import examplesEn from '../data/odai.en.json'
import { isEn, lang, tr } from './i18n'

export type OdaiKind = 'temple' | 'street' | 'cafe' | 'park' | 'culture'
export type OdaiLevel = 'easy' | 'normal' | 'hard'
// past: 出し直す前に出したミッション（古い順）。出し直すときは、いまのミッションと合わせて避ける
export type OdaiItem = { spotId: string; spotName: string; kind: OdaiKind; text: string; level: OdaiLevel; rerolls: number; past?: string[]; photo?: string; at: number }
export type TripOdai = { items: OdaiItem[] }

export const MAX_REROLLS = 2
export const MAX_COUNT = 3
export const MAX_AVOID = 5

// 種類の名前（Gemini への頼みにも使う）と難しさ。英語のときは英語で頼み、英語の例を渡す
export const KIND_LABEL: Record<OdaiKind, string> = tr({
  ja: { temple: '寺社・歴史', street: '商店街・路地裏', cafe: 'カフェ・グルメ', park: '公園・自然', culture: '文化・レトロ・雑貨' },
  en: { temple: 'Temples and history', street: 'Shopping streets and alleys', cafe: 'Cafés and food', park: 'Parks and nature', culture: 'Culture, retro, and crafts' },
})
export const LEVELS: { key: OdaiLevel; label: string; hint: string }[] = tr({
  ja: [
    { key: 'easy', label: 'やさしい', hint: 'その場ですぐできる' },
    { key: 'normal', label: 'ふつう', hint: '少し探す' },
    { key: 'hard', label: 'むずかしい', hint: 'よく観察して工夫する' },
  ],
  en: [
    { key: 'easy', label: 'Easy', hint: 'Right where you are' },
    { key: 'normal', label: 'Normal', hint: 'A little searching' },
    { key: 'hard', label: 'Hard', hint: 'Look closely' },
  ],
})

const EXAMPLES = (isEn ? examplesEn : examplesJa) as { kind: OdaiKind; text: string }[]

export function odaiKind(s: Spot): OdaiKind {
  if (s.kind === 'food' || s.kind === 'cafe') return 'cafe'
  if (s.kind === 'street') return 'street'
  const t = s.tags
  if (t.some((x) => ['美術', '買い物', '古着', '雑貨', '工芸', '本', '音楽', '映画'].includes(x))) return 'culture'
  if (t.includes('寺社') || t.includes('歴史')) return 'temple'
  if (t.some((x) => ['庭', '景色', '竹', '海', '散策', '夜景', '温泉', '水辺', '自然', '花', '坂', '路地'].includes(x))) return 'park'
  return 'temple'
}

// Gemini が作ったミッションか（作れなかったときに出す、ミッションの例ではないか）
export const byGemini = (it: OdaiItem) => !EXAMPLES.some((e) => e.text === it.text)

const examplesOf = (kind: OdaiKind) => EXAMPLES.filter((e) => e.kind === kind).map((e) => e.text)

function pickExample(kind: OdaiKind, not: string[] = []): string {
  const list = examplesOf(kind).filter((t) => !not.includes(t))
  return list[Math.floor(Math.random() * list.length)] ?? examplesOf(kind)[0]
}

// ミッションを出す場所を選ぶ。隠れた名所・見どころ・通りを先に、昼の時間帯を少し先に。2 つ以上のときは種類が違う場所に
export function pickStops(plan: Plan, n: number, not: string[] = [], usedKinds: OdaiKind[] = []): Stop[] {
  const score = (s: Stop) => {
    const k = s.spot.kind
    let v = k === 'street' ? 3 : k === 'sight' ? (s.spot.role === 'hidden' ? 4 : 2.5) : 1
    if (s.arrive >= 11 * 60 && s.arrive <= 16 * 60) v += 0.5
    return v
  }
  const pool = plan.stops.filter((s) => !not.includes(s.spot.id)).sort((a, b) => score(b) - score(a))
  const out: Stop[] = []
  for (const s of pool) {
    if (out.length >= n) break
    const k = odaiKind(s.spot)
    if (!usedKinds.includes(k) && !out.some((o) => odaiKind(o.spot) === k)) out.push(s)
  }
  for (const s of pool) {
    if (out.length >= n) break
    if (!out.includes(s)) out.push(s)
  }
  return out.sort((a, b) => a.arrive - b.arrive)
}

// その場所のミッションを Gemini に 1 つ考えさせる（失敗したときは null。サーバーの無いときは、その種類の例から）
export async function tryOdai(area: string, date: string, stop: Stop, level: OdaiLevel, avoid: string[] = []): Promise<string | null> {
  const kind = odaiKind(stop.spot)
  if (!hasServer) return pickExample(kind, avoid)
  try {
    const s = stop.spot
    const r = await askOdai({ lang, area, date, time: fmt(stop.arrive), level, kind: KIND_LABEL[kind], examples: examplesOf(kind), avoid: avoid.slice(-MAX_AVOID), place: { name: s.name, kind: s.kind, tags: s.tags, why: s.why, district: s.district } })
    return r.text || null
  } catch {
    return null
  }
}

// その場所のミッションを 1 つ考える（失敗したときは、その種類の例から）
export async function makeOdai(area: string, date: string, stop: Stop, level: OdaiLevel, avoid: string[] = []): Promise<string> {
  return (await tryOdai(area, date, stop, level, avoid)) ?? pickExample(odaiKind(stop.spot), avoid)
}

// このブラウザに取っておく（エリアごと）。2 つの画面（プランと場所）で同じものを見るため、書いたら知らせる
// 検索で入れた場所（lib/found.ts）の id の頭。その場所の名前は Google の Places の内容なので取っておかない
const FOUND_PREFIX = 'g_'
const STORE = 'intentrip:odai:v2'
const forStore = (t: TripOdai): TripOdai => ({ ...t, items: t.items.map((x) => (x.spotId.startsWith(FOUND_PREFIX) ? { ...x, spotName: '' } : x)) })
export const ODAI_EVENT = 'intentrip:odai-change'
const EVENT = ODAI_EVENT
function readAll(): Record<string, TripOdai> {
  try {
    return JSON.parse(window.localStorage.getItem(STORE) || '{}') as Record<string, TripOdai>
  } catch {
    return {}
  }
}
export const readTripOdai = (area: string): TripOdai => readAll()[area] ?? { items: [] }
export const readTrip = readTripOdai

// 画面の外から書き替える（クラウドの旅を開いたときなど）。開いている画面へ知らせる。書き込めたら true
export function writeTripOdai(area: string, t: TripOdai): boolean {
  const all = readAll()
  all[area] = forStore(t)
  let ok = true
  try {
    window.localStorage.setItem(STORE, JSON.stringify(all))
  } catch {
    ok = false
  }
  window.dispatchEvent(new Event(EVENT))
  return ok
}

export function useTripOdai(area: string): [TripOdai, (t: TripOdai) => boolean] {
  const [trip, setTrip] = useState(() => readTrip(area))
  useEffect(() => {
    const on = () => setTrip(readTrip(area))
    on()
    window.addEventListener(EVENT, on)
    return () => window.removeEventListener(EVENT, on)
  }, [area])
  const save = (t: TripOdai) => {
    const all = readAll()
    all[area] = forStore(t)
    let ok = true
    try {
      window.localStorage.setItem(STORE, JSON.stringify(all))
    } catch {
      ok = false
    }
    setTrip(t)
    window.dispatchEvent(new Event(EVENT))
    return ok
  }
  return [trip, save]
}

// 設定（ミッションの数・難しさ）
const COUNT_STORE = 'intentrip:odai-count:v1'
const LEVEL_STORE = 'intentrip:odai-level:v2'
export function readCount(): number {
  try {
    const v = Number(window.localStorage.getItem(COUNT_STORE))
    return v >= 1 && v <= MAX_COUNT ? v : 1
  } catch {
    return 1
  }
}
export function saveCount(v: number) {
  try {
    window.localStorage.setItem(COUNT_STORE, String(v))
  } catch {
    /* 取っておけないときは、そのまま */
  }
}
export function readLevel(): OdaiLevel {
  try {
    const v = window.localStorage.getItem(LEVEL_STORE)
    return v === 'normal' || v === 'hard' ? v : 'easy'
  } catch {
    return 'easy'
  }
}
export function saveLevel(v: OdaiLevel) {
  try {
    window.localStorage.setItem(LEVEL_STORE, v)
  } catch {
    /* 取っておけないときは、そのまま */
  }
}

// 写真は長い辺を 720px までに縮め、JPEG にしてから取っておく
export async function shrinkPhoto(file: File): Promise<string> {
  const url = URL.createObjectURL(file)
  try {
    const img = new Image()
    img.src = url
    await img.decode()
    const k = Math.min(1, 720 / Math.max(img.naturalWidth, img.naturalHeight))
    const c = document.createElement('canvas')
    c.width = Math.round(img.naturalWidth * k)
    c.height = Math.round(img.naturalHeight * k)
    c.getContext('2d')!.drawImage(img, 0, 0, c.width, c.height)
    return c.toDataURL('image/jpeg', 0.72)
  } finally {
    URL.revokeObjectURL(url)
  }
}
