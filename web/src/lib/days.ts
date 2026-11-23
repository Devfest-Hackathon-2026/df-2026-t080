// 何日かある旅（宿泊）の日の入れ替え。今開いている日を Saved の本体に、ほかの日を days に入れる（開いている日の位置は null）
import type { AreaData, Point, Spot, TripPoint } from '../types'
import type { Saved } from './saved'
import { distM } from './geo'
import { MEAL_WISH } from './highlight'

export const DAYS_MAX = 4

export type Day = Omit<Saved, 'days' | 'day' | 'planDays' | 'stays' | 'tripEnd' | 'wants' | 'carry' | 'car'>

// 日の Saved から、旅の全日の分（days・day・planDays・stays・tripEnd・wants・carry・car）を外す
export function bare(s: Saved): Day {
  const { days: _days, day: _day, planDays: _plan, stays: _stays, tripEnd: _end, wants: _wants, carry: _carry, car: _car, ...rest } = s
  return rest
}

// 旅の全日で 1 つの分（泊ごとの宿と、旅の最後に観光を終える場所と、日ごとの希望と時刻と、まだ入れていない場所と、車で回るか）
type Shared = Pick<Saved, 'stays' | 'tripEnd' | 'wants' | 'carry' | 'car'>
const sharedOf = (s: Saved): Shared => ({ ...(s.stays && { stays: s.stays }), ...(s.tripEnd !== undefined && { tripEnd: s.tripEnd }), ...(s.wants && { wants: s.wants }), ...(s.carry?.length && { carry: s.carry }), ...(s.car && { car: true }) })

// 旅の全日（開いている日も入れて、日の順）
export function allDays(s: Saved): Day[] {
  if (!s.days?.length) return [bare(s)]
  return s.days.map((d) => (d ? bare(d as Saved) : bare(s)))
}

// 今開いている日の位置（0 始まり）
export function dayIndex(s: Saved): number {
  if (!s.days?.length) return 0
  const at = s.days.indexOf(null)
  return at >= 0 ? at : Math.min(Math.max(0, s.day ?? 0), s.days.length - 1)
}

// 予定している日数（作った日数より少なくも、上限より多くもしない）
export function plannedDays(s: Saved): number {
  return Math.min(DAYS_MAX, Math.max(allDays(s).length, Number.isFinite(s.planDays) ? Math.round(s.planDays as number) : 1))
}

// 全日から、i 日目を開いた形を作る。since は全日で同じ。plan: 予定している日数（作った日数より多いときだけ持つ）
function build(list: Day[], i: number, since: number | undefined, plan = 1, shared: Shared = {}): Saved {
  const at = Math.min(Math.max(0, i), list.length - 1)
  const planDays = Math.min(DAYS_MAX, plan)
  const body: Saved = { ...list[at], ...(since !== undefined && { since }), ...(planDays > list.length && { planDays }), ...shared }
  if (list.length < 2) return body
  return { ...body, days: list.map((d, k) => (k === at ? null : { ...d, ...(since !== undefined && { since }) })), day: at }
}

// i 日目を開く
export function switchDay(s: Saved, i: number): Saved {
  return build(allDays(s), i, s.since, plannedDays(s), sharedOf(s))
}

// 最後の日の次に next の日を加え、その日を開く
export function addDay(s: Saved, next: Day): Saved {
  return build([...allDays(s), bare(next as Saved)], Number.MAX_SAFE_INTEGER, s.since, plannedDays(s), sharedOf(s))
}

// 開いている日を消し、前の日を開く（1日目を消したときは、次の日が 1日目になって開く）。後ろの日と日ごとの希望・時刻は詰め、予定の日数も 1 日減らす
export function removeDay(s: Saved): Saved {
  const list = allDays(s)
  if (list.length < 2) return s
  const at = dayIndex(s)
  const rest = list.filter((_, k) => k !== at)
  const shared = sharedOf(s)
  if (shared.wants) shared.wants = { ...shared.wants, days: shared.wants.days.filter((_, k) => k !== at) }
  return build(rest, Math.max(0, at - 1), s.since, plannedDays(s) - 1, shared)
}

// 予定の日数を n 日にする（作った日数より少なくはしない）
export function setPlannedDays(s: Saved, n: number): Saved {
  return build(allDays(s), dayIndex(s), s.since, Math.max(1, Math.round(n)), sharedOf(s))
}

// 日に回る場所の id（最後に見せていた並び。無ければ組む前の並び）
export function dayStopIds(d: Day): string[] {
  return (d.shown?.length ? d.shown : (d.base ?? [])).map((b) => b.id)
}

// 旅の全日に入れた場所（id・名前・Google の place_id と、名前の揺れを見るための名前と位置）。skip: 数えない日（0 始まり）
export type Used = { ids: Set<string>; names: Set<string>; placeIds?: Set<string>; spots?: { name: string; lat: number; lng: number }[] }
export function usedPlaces(s: Saved, skip = -1): Used {
  const ids = new Set<string>()
  const names = new Set<string>()
  const placeIds = new Set<string>()
  const spots: { name: string; lat: number; lng: number }[] = []
  allDays(s).forEach((d, k) => {
    if (k === skip) return
    const byId = new Map(d.data.places.map((p) => [p.id, p]))
    for (const id of dayStopIds(d)) {
      ids.add(id)
      const p = byId.get(id)
      if (!p) continue
      if (p.name) names.add(normName(p.name))
      if (p.placeId) placeIds.add(p.placeId)
      if (p.name) spots.push({ name: normName(p.name), lat: p.lat, lng: p.lng })
    }
  })
  return { ids, names, placeIds, spots }
}

// 空白を除き、全角と半角・片仮名と平仮名をそろえる（「国際通リ」と「国際通り」）
export const normName = (n: string) =>
  n
    .normalize('NFKC')
    .replace(/\s+/g, '')
    .replace(/[\u30a1-\u30f6]/g, (c) => String.fromCharCode(c.charCodeAt(0) - 0x60))
    .toLowerCase()

// 名前の片方がもう片方を含み、近くにある場所は、同じ場所とみなす（「首里城」と「首里城公園」）
const NEAR_SAME_M = 500
const sameSpot = (a: { name: string; lat: number; lng: number }, name: string, p: Point) =>
  name.length >= 2 && a.name.length >= 2 && (a.name.includes(name) || name.includes(a.name)) && distM(a, p) < NEAR_SAME_M

// 場所が、前の日までに入れた場所か
export function isUsed(p: Pick<Spot, 'id' | 'name' | 'placeId' | 'lat' | 'lng'>, used: Used): boolean {
  if (used.ids.has(p.id)) return true
  const n = normName(p.name)
  if (n && used.names.has(n)) return true
  if (p.placeId && used.placeIds?.has(p.placeId)) return true
  return !!n && !!used.spots?.some((a) => sameSpot(a, n, p))
}

// 候補から、前の日までに入れた場所を除く
export function dropUsed(data: AreaData, used: Used): AreaData {
  const places = data.places.filter((p) => !isUsed(p, used))
  return places.length === data.places.length ? data : { ...data, places }
}

// used に、spots（今のプランの場所など）を足した形
export function usedWith(used: Used, spots: Spot[]): Used {
  const ids = new Set(used.ids)
  const names = new Set(used.names)
  const placeIds = new Set(used.placeIds)
  const near = [...(used.spots ?? [])]
  for (const p of spots) {
    ids.add(p.id)
    if (p.name) {
      names.add(normName(p.name))
      near.push({ name: normName(p.name), lat: p.lat, lng: p.lng })
    }
    if (p.placeId) placeIds.add(p.placeId)
  }
  return { ids, names, placeIds, spots: near }
}

// まだ入れていない場所に spots を足す（同じ場所は 1 つにする）
export function addCarry(carry: Spot[], spots: Spot[]): Spot[] {
  const out = carry.slice()
  for (const s of spots) if (!out.some((c) => c.id === s.id || normName(c.name) === normName(s.name))) out.push(s)
  return out
}

// まだ入れていない場所から、旅のどれかの日に入れた場所を除く
export function dropCarried(carry: Spot[], used: Used): Spot[] {
  const out = carry.filter((c) => !isUsed(c, used))
  return out.length === carry.length ? carry : out
}

const isMeal = (p: Pick<Spot, 'kind'>) => p.kind === 'food' || p.kind === 'cafe'

// 次の日の候補に、まだ入れていない場所を入れる。同じ id か同じ名前（名前の揺れた近くの同じ場所も）の候補があれば足さずにその候補を使う。
// ids: 選ぶ画面で最初から選んでおく候補
export function withCarry(data: AreaData, carry: Spot[]): { data: AreaData; ids: string[] } {
  if (!carry.length) return { data, ids: [] }
  const ids: string[] = []
  const add: Spot[] = []
  for (const c of carry) {
    const n = normName(c.name)
    const hit =
      data.places.find((p) => p.id === c.id || normName(p.name) === n) ??
      data.places.find((p) => isMeal(p) === isMeal(c) && sameSpot({ name: n, lat: c.lat, lng: c.lng }, normName(p.name), p))
    if (hit) ids.push(hit.id)
    else if (!add.some((p) => p.id === c.id)) {
      add.push(c)
      ids.push(c.id)
    }
  }
  return { data: add.length ? { ...data, places: [...data.places, ...add] } : data, ids: [...new Set(ids)] }
}

// 前の日までに入れた、希望から来た場所（その日の希望をもう満たした場所）
export function metWishes(s: Saved): Spot[] {
  return allDays(s).flatMap((d) => {
    const byId = new Map(d.data.places.map((p) => [p.id, p]))
    return dayStopIds(d).flatMap((id) => {
      const p = byId.get(id)
      return p && p.source === 'wish' ? [p] : []
    })
  })
}

// 名前を書いた場所の近くで、同じ希望に合う場所とみなす距離
const MET_NEAR_M = 700
const brand = (name: string) => {
  const w = name.normalize('NFKC').trim().split(/\s+/)
  return w.length > 1 && w[0].length >= 2 ? normName(w[0]) : ''
}

// 前の日までに満たした希望の候補か。名前を書いた場所の近くの見どころと、同じ名物（食事の希望の札のタグ）か同じ店の名前の食事の店
function metBy(p: Spot, met: Spot[], asked: string[]): boolean {
  if (isMeal(p)) {
    const b = brand(p.name)
    const dish = p.tags.filter((t) => MEAL_WISH.includes(t) && asked.includes(t))
    return met.some((m) => isMeal(m) && ((!!b && brand(m.name) === b) || dish.some((t) => m.tags.includes(t))))
  }
  return met.some((m) => m.named && !isMeal(m) && distM(m, p) < MET_NEAR_M)
}

// 次の日の候補のうち、前の日までに満たした希望から来た場所を、ふつうの候補にする（最初から選ばず、「希望に合う場所」にも出さない）
export function quietMet(data: AreaData, met: Spot[]): AreaData {
  if (!met.length) return data
  let hit = false
  const asked = data.conditions.map((c) => c.tag)
  const places = data.places.map((p) => {
    if (p.source !== 'wish' || !metBy(p, met, asked)) return p
    hit = true
    const { named: _named, ...rest } = p
    return { ...rest, source: isMeal(p) ? ('food' as const) : p.role === 'famous' ? ('famous' as const) : ('hidden' as const) }
  })
  return hit ? { ...data, places } : data
}

// 日の終わりの場所（片道の旅なら到着地、戻る旅なら出発地）。次の日はここから始める
export function dayGoal(d: Day): TripPoint {
  const q = d.data.query
  const pt = q?.start ? (q.end ?? q.start) : null
  if (pt) return pt
  const g = d.data.end ?? d.data.start
  return { text: g.name, name: g.name, ...(g.ja && { ja: g.ja }), lat: g.lat, lng: g.lng }
}

// 次の日の候補を頼む形（戻る旅の作り置きのエリアは引き継ぐ）
export function nextDayAsk(d: Day): { area?: string; start: TripPoint; end: null } {
  const start = dayGoal(d)
  const q = d.data.query
  const back = !!q?.start && !q.end
  const area = back && q?.area && q.area !== start.text ? q.area : undefined
  return { ...(area && { area }), start, end: null }
}

// 泊ごとの宿（k 番目が k+1 泊目。入っていない泊は null）
export type Stays = (TripPoint | null)[]

// 宿がどれかの泊に入っているか
export const hasStay = (stays: Stays | undefined): boolean => !!stays?.some(Boolean)

// k+1 泊目（k は 0 始まり）の宿。入っていない泊は前の泊と同じ（さかのぼって最初に入っている宿）。それより前にも無ければ null
export function nightStay(stays: Stays | undefined, k: number): TripPoint | null {
  for (let j = Math.min(k, (stays?.length ?? 0) - 1); j >= 0; j--) {
    const t = stays?.[j]
    if (t) return t
  }
  return null
}

// 泊ごとの宿を、後ろの空きを落とした形にする
export function trimStays(stays: Stays): Stays {
  const out = stays.slice()
  while (out.length && !out[out.length - 1]) out.pop()
  return out
}

// 宿を入れた旅の、画面に見せる題（全日で同じ。1日目の出発地の名前）。宿の無い旅と例のプランは null
export function stayTitle(s: Saved): string | null {
  if (!hasStay(s.stays) || s.data.demo) return null
  const first = allDays(s)[0]
  return first.data.query?.start?.name || first.data.start.name || null
}

// 2 点が同じ場所か（頼みの出発地・到着地と、泊まる宿を比べる）
const same = (a: Point, b: Point) => distM(a, b) < 50

// 宿を入れた旅の、n 日目（1 始まり）の出発地と到着地。total: 予定している日数、origin: 1日目の出発地、
// goal: 旅の最後に観光を終える場所（null なら origin）、prevEnd: 前の日の終わりの場所。
// n 日目は n−1 泊目の宿から n 泊目の宿へ（1日目は origin から、最終日は goal へ）。宿が無い泊は、前の日の終わりの場所から出て戻る。
// 出発地と到着地が同じなら、到着地は null（戻る旅）。どの泊にも宿が無いか、日帰りなら null
export function stayTrip(n: number, total: number, origin: TripPoint, stays: Stays | undefined, goal: TripPoint | null | undefined, prevEnd?: TripPoint): { start: TripPoint; end: TripPoint | null } | null {
  if (!hasStay(stays) || total < 2) return null
  const start = n <= 1 ? origin : (nightStay(stays, n - 2) ?? prevEnd ?? origin)
  const end = n >= total ? (goal ?? origin) : nightStay(stays, n - 1)
  return { start, end: end && !same(start, end) ? end : null }
}

// 次の日の候補を頼む形。宿を入れた旅は stayTrip、ほかは前の日の終わりの場所から（nextDayAsk）
export function addDayAsk(s: Saved): { area?: string; start: TripPoint; end: TripPoint | null } {
  const list = allDays(s)
  const n = list.length + 1
  const last = list[list.length - 1]
  const origin = list[0].data.query?.start
  const trip = origin ? stayTrip(n, Math.max(n, plannedDays(s)), origin, s.stays, tripGoal(s), dayGoal(last)) : null
  return trip ?? nextDayAsk(last)
}

// 旅の最後に観光を終える場所（null なら 1日目の出発地）。決めていなければ、1日目の到着地（宿でなければ）
export function tripGoal(s: Saved): TripPoint | null {
  if (s.tripEnd !== undefined) return s.tripEnd
  const end = allDays(s)[0].data.query?.end
  const first = nightStay(s.stays, 0)
  return end && !(first && same(end, first)) ? end : null
}

// 泊ごとの宿を入れる・変える（全部空で外す）。初めて入れるときに、旅の最後に観光を終える場所を決めておく
export function withStays(s: Saved, stays: Stays): Saved {
  const { stays: _old, ...rest } = s
  const tripEnd = s.tripEnd !== undefined ? s.tripEnd : tripGoal(s)
  const next = trimStays(stays)
  return { ...rest, ...(hasStay(next) && { stays: next }), tripEnd }
}

// 日の出発地・到着地が、どれかの泊の宿か
export function stayEnds(d: { data: AreaData }, stays: Stays | undefined): { from: boolean; to: boolean } {
  const q = d.data.query
  const list = (stays ?? []).filter((t): t is TripPoint => !!t)
  if (!list.length || !q?.start || d.data.demo) return { from: false, to: false }
  const end = q.end ?? q.start
  return { from: list.some((t) => same(q.start as TripPoint, t)), to: list.some((t) => same(end, t)) }
}

// YYYY-MM-DD の次の日
export function nextDate(iso: string): string {
  const [y, m, d] = iso.split('-').map(Number)
  const t = new Date(Date.UTC(y, m - 1, d + 1))
  return `${t.getUTCFullYear()}-${String(t.getUTCMonth() + 1).padStart(2, '0')}-${String(t.getUTCDate()).padStart(2, '0')}`
}

// 旅の全日の日付（日の順）
export const tripDates = (s: Saved): string[] => allDays(s).map((d) => d.date)

// 予定している全日の日付（まだ作っていない日は、作った最後の日から 1 日ずつ）。n: 日数（省けば予定している日数）
export function plannedDates(s: Saved, n = plannedDays(s)): string[] {
  const dates = tripDates(s)
  while (dates.length < n) dates.push(nextDate(dates[dates.length - 1]))
  return dates
}

// 日の切り替えに出す日付（例のプランは作った日だけ、ほかは予定している日と、加えている途中の日 adding（1 始まり）まで）。2 日に満たなければ null
export function tabDates(s: Saved, adding = 0): string[] | null {
  const n = s.data.demo ? allDays(s).length : Math.max(plannedDays(s), adding)
  return n > 1 ? plannedDates(s, n) : null
}

// 開いている日のほかの日に回る場所の数
export const otherStops = (s: Saved): number =>
  allDays(s)
    .filter((_, k) => k !== dayIndex(s))
    .reduce((n, d) => n + dayStopIds(d).length, 0)

// もう 1 日加えられるか（日数の上限と、保存の大きさの上限 limit の字数）
export function canAddDay(s: Saved, limit: number): boolean {
  const list = allDays(s)
  if (list.length >= DAYS_MAX) return false
  const size = JSON.stringify(s).length
  return size + size / list.length <= limit
}
