// ペンギンの一言: プランに合わせた、その日に役立つ注意を Gemini が 3〜5 行書く（サーバーの penguin.py）。
// 資料はプランから組む。時刻は "HH:MM"。時刻の差（閉まるまで・開くまで）はここで計算し、Gemini には計算させない
import { useEffect, useState } from 'react'
import type { AreaData } from '../types'
import type { Plan, PlanInput, Stop } from './planner'
import type { Wear } from './weather'
import type { Lang } from './i18n'
import { askPenguin, hasServer } from './api'
import { afterSunset, isOutdoor, needsReserve } from './caution'
import { crowdGap, FIRST_HOUR, LAST_HOUR, hourly, levelAt } from './crowd'
import { goalOf, type Leg } from './geo'
import { sunsetMin } from './sun'

export type PenguinMove = { by: 'walk' | 'train' | 'bus' | 'transit'; min: number }
export type PenguinStop = {
  name: string
  kind: string
  arrive: string
  depart: string
  open?: string
  close?: string
  untilClose?: number // 着いてから閉まるまでの分（閉まる時刻が近いときだけ）
  wait?: number // 着いてから開くまで待つ分
  crowd?: number // 着く時刻の混み方（0〜4。推定のある 8〜18 時台だけ）
  peak?: string // 混む時間帯（"11:00-15:00"）
  best?: string
  downside?: string
  reserve?: true
  outdoor?: true
  dark?: true // 日の入りより後に着く屋外の場所
  move: PenguinMove // 前の場所（最初は出発地）からの移動
}
export type PenguinFacts = {
  date: string
  weekday: string
  holiday: boolean
  area: string
  sunset?: string
  start: { name: string; time: string }
  end: { name: string; time: string; move: PenguinMove }
  stops: PenguinStop[]
  wear?: { label: string; feels?: [number, number]; notes?: string[] }
}

const MAX_STOPS = 12
const MAX_TEXT = 120
const NEAR_CLOSE = 120
const JA_DAY = '日月火水木金土'
const EN_DAY = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']

const hhmm = (m: number) => {
  const r = Math.round(m)
  return `${String(Math.floor(r / 60)).padStart(2, '0')}:${String(r % 60).padStart(2, '0')}`
}
const short = (s: string | undefined) => (s ?? '').replace(/\s+/g, ' ').trim().slice(0, MAX_TEXT)

function moveOf(leg: Leg): PenguinMove {
  const min = Math.round(leg.minutes)
  if (leg.mode === 'walk') return { by: 'walk', min }
  const bus = leg.real?.bus
  if (bus) return { by: bus.mode === 'train' ? 'train' : 'bus', min }
  const rides = (leg.real?.steps ?? []).filter((s) => s.mode === 'train' || s.mode === 'bus')
  if (rides.length && rides.every((s) => s.mode === rides[0].mode)) return { by: rides[0].mode as 'train' | 'bus', min }
  if (leg.rail) return { by: 'train', min }
  return { by: 'transit', min }
}

function peakOf(st: Stop, day: PlanInput['day']): string | undefined {
  const hs = hourly(st.spot, day)
    .map((v, i) => (v >= 3 && !st.spot.filled?.crowd?.includes(i) ? i + FIRST_HOUR : -1))
    .filter((h) => h >= 0)
  return hs.length ? `${hhmm(hs[0] * 60)}-${hhmm((hs[hs.length - 1] + 1) * 60)}` : undefined
}

function stopOf(st: Stop, input: PlanInput, date: string): PenguinStop {
  const s = st.spot
  const shut = s.close < 24 * 60 && s.close - st.arrive <= NEAR_CLOSE
  const known = st.arrive >= FIRST_HOUR * 60 && st.arrive < (LAST_HOUR + 1) * 60 && !crowdGap(s, st.arrive)
  const out: PenguinStop = {
    name: short(s.name),
    kind: st.slot === 'sight' ? s.kind : st.slot,
    arrive: hhmm(st.arrive),
    depart: hhmm(st.depart),
    move: moveOf(st.leg),
  }
  if (s.open > 0) out.open = hhmm(s.open)
  if (s.close < 24 * 60) out.close = hhmm(s.close)
  if (shut) out.untilClose = Math.round(s.close - st.arrive)
  if (st.wait > 0) out.wait = Math.round(st.wait)
  if (known) out.crowd = levelAt(s, st.arrive, input.day)
  const peak = peakOf(st, input.day)
  if (peak) out.peak = peak
  if (s.best && s.best !== 'any') out.best = s.best
  const down = short(s.downside)
  if (down) out.downside = down
  if (needsReserve(s)) out.reserve = true
  if (isOutdoor(s)) out.outdoor = true
  if (afterSunset(s, st.arrive, date)) out.dark = true
  return out
}

// プランから資料を組む（数はできるだけ小さく。無い物・当てはまらない物は入れない）
export function penguinFacts(data: AreaData, plan: Plan, input: PlanInput, date: string, wear: Wear | null, lang: Lang): PenguinFacts {
  const d = new Date(`${date}T00:00:00`).getDay()
  const here = data.area.lat ? data.area : data.start
  const set = sunsetMin(date, here.lat, here.lng)
  const out: PenguinFacts = {
    date,
    weekday: lang === 'en' ? EN_DAY[d] : JA_DAY[d],
    holiday: input.day === 'holiday',
    area: short(data.area.name),
    start: { name: short(data.start.name), time: hhmm(plan.leave) },
    end: { name: short(goalOf(data).name), time: hhmm(plan.finish), move: moveOf(plan.back) },
    stops: plan.stops.slice(0, MAX_STOPS).map((st) => stopOf(st, input, date)),
  }
  if (set !== null) out.sunset = hhmm(set)
  if (wear) {
    out.wear = { label: short(wear.label) }
    if (wear.feels.every(Number.isFinite)) out.wear.feels = wear.feels
    if (wear.notes.length) out.wear.notes = wear.notes.map((n) => short(n.text))
  }
  return out
}

const SETTLE = 2000 // 資料が落ち着いてから頼むまで（ミリ秒）
const QUIET = 10 * 60 * 1000 // 枠に届いたら、このページではしばらく頼まない
const KEEP = 40
const memo = new Map<string, string[]>()
const failed = new Set<string>()
let quietUntil = 0

function remember(key: string, lines: string[]) {
  memo.set(key, lines)
  while (memo.size > KEEP) memo.delete(memo.keys().next().value as string)
}

// 資料が落ち着いて 2 秒たったら頼む。資料が変わったら前の頼みを取りやめて頼み直す。同じ資料の答えはページの中でも作り置き。
// wait（プランの組み直しの途中）の間と、資料が無いときは頼まない。失敗・枠のときは黙って null
export function usePenguinNote(facts: PenguinFacts | null, wait = false): string[] | null {
  const key = facts ? JSON.stringify(facts) : ''
  const [, setGot] = useState('')
  useEffect(() => {
    if (!key || wait || !hasServer || memo.has(key) || failed.has(key)) return
    const stop = new AbortController()
    const t = window.setTimeout(() => {
      if (Date.now() < quietUntil) return
      askPenguin(JSON.parse(key), stop.signal)
        .then((r) => {
          if (r.lines?.length) {
            remember(key, r.lines)
            setGot(key)
          } else failed.add(key)
        })
        .catch((e: unknown) => {
          if (e instanceof Error && e.message === '429') quietUntil = Date.now() + QUIET
        })
    }, SETTLE)
    return () => {
      window.clearTimeout(t)
      stop.abort()
    }
  }, [key, wait])
  return key ? (memo.get(key) ?? null) : null
}
