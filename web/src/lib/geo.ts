// 移動時間の目安。
// 徒歩は直線距離から。遠いときは公共交通機関の目安（車の時間か距離から）を出し、細かい案内は Google マップに渡す。
// 本番では徒歩は Routes API。日本の電車は Google の API で経路が出ないため、目安と Google マップへのリンクのまま。
import type { AreaData, Point, RailOpt, TransitRoute, TransitTable } from '../types'
import { tr } from './i18n'

const WORD = tr({
  ja: {
    transit: '電車・バス',
    sep: '・',
    walk: (m: number) => `徒歩 ${m}分`,
    about: (m: number) => `電車・バス 約${m}分`,
    rail: (line: string, m: number) => `${line} 約${m}分`,
    mins: (m: number) => `${m}分`,
  },
  en: {
    transit: 'Transit',
    sep: ', ',
    walk: (m: number) => `Walk ${m} min`,
    about: (m: number) => `Transit ~${m} min`,
    rail: (line: string, m: number) => `${line} ~${m} min`,
    mins: (m: number) => `${m} min`,
  },
})

export type Leg = {
  mode: 'walk' | 'transit'
  minutes: number
  label: string
  from: Point
  to: Point
  real?: TransitRoute // スクリーンショットから入れた実際の経路
  rail?: RailOpt // 時刻表の無い区間の、乗り換えなしの電車の目安（目安の時間はこの電車から）
  other?: number // もう片方の手段（徒歩なら電車・バス、電車・バスなら徒歩）の目安の分。区間の手段を選ぶ画面で比べるのに使う
  chosen?: boolean // 本人が手段を選んだ区間（自動で選んだ区間は無し）
}

export type LegMode = 'walk' | 'transit'

// 区間の名前（出発地は 'start'、到着地は 'end'）。実際の経路はこの名前で覚える
export const legKey = (fromId: string, toId: string) => `${fromId}>${toId}`

// 旅の終わりの地点（到着地。無ければ出発地に戻る）と、その名前
export const goalOf = (d: AreaData) => d.end ?? d.start
export const goalId = (d: AreaData) => (d.end ? 'end' : 'start')
// 移動時間の表と時刻表の目安の表の点の並び（出発地・到着地・候補。サーバーの移動時間の表と同じ並び）
export const tableIds = (d: AreaData): string[] => ['start', ...(d.end ? ['end'] : []), ...d.places.map((p) => p.id)]
export const tablePoints = (d: AreaData): Point[] => [d.start, ...(d.end ? [d.end] : []), ...d.places]
// 区間の名前に使う id から点へ
export function pointsById(d: AreaData): Map<string, Point> {
  const pts = tablePoints(d)
  return new Map(tableIds(d).map((id, i) => [id, pts[i]]))
}

let O: Map<Point, Map<Point, TransitRoute>> | null = null
// 本人が選んだ区間の手段（legKey ごと）。無い区間は、歩く分と電車・バスの目安で自動に選ぶ
let P: Map<Point, Map<Point, LegMode>> | null = null

export function setModes(data: AreaData, modes: Record<string, LegMode>) {
  cache = new WeakMap()
  const byId = pointsById(data)
  P = new Map()
  for (const [k, m] of Object.entries(modes)) {
    const [a, b] = k.split('>')
    const pa = byId.get(a)
    const pb = byId.get(b)
    if (!pa || !pb || (m !== 'walk' && m !== 'transit')) continue
    if (!P.has(pa)) P.set(pa, new Map())
    P.get(pa)!.set(pb, m)
  }
}

export function setOverrides(data: AreaData, overrides: Record<string, TransitRoute>) {
  cache = new WeakMap() // 入れた経路が変わったら、覚えていた所要時間を使わない
  const byId = pointsById(data)
  O = new Map()
  for (const [k, r] of Object.entries(overrides)) {
    const [a, b] = k.split('>')
    const pa = byId.get(a)
    const pb = byId.get(b)
    if (!pa || !pb) continue
    if (!O.has(pa)) O.set(pa, new Map())
    O.get(pa)!.set(pb, r)
  }
}

export function realLabel(r: TransitRoute): string {
  const lines = r.steps.filter((s) => s.mode !== 'walk' && s.line).map((s) => s.line)
  return `${lines.length ? lines.join(WORD.sep) : WORD.transit} ${WORD.mins(r.minutes)}`
}

const WALK_M_PER_MIN = 75
// 道のりの分かる区間（移動の表の walkM）を歩く速さ。地図の線と同じ道のりから分を出す
const ROAD_M_PER_MIN = 80
const DETOUR = 1.25
// 道の表で歩く道が無いと出た 2 点が、これより近ければ、点が歩道につながっていないだけとみて、直線の見積もりで歩く。これより遠ければ、海や川で切れているとみて、歩かない
const NO_WALK_ROUTE_M = 1500

export function distM(a: Point, b: Point): number {
  const R = 6371000
  const toRad = (d: number) => (d * Math.PI) / 180
  const dLat = toRad(b.lat - a.lat)
  const dLng = toRad(b.lng - a.lng)
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.sin(dLng / 2) ** 2
  return 2 * R * Math.asin(Math.sqrt(h))
}

export function walkMin(a: Point, b: Point): number {
  return Math.max(1, Math.round((distM(a, b) * DETOUR) / WALK_M_PER_MIN))
}

// 坂の分（分）。行き先が高いときだけ、2 点の高さの差を道のりで割った平均の勾配から Tobler の歩く速さの式で見積もる。
// 平均の勾配なので途中の上り下りは数えず、下りで短くもしない（控えめに足す）。道のり d は、分からなければ徒歩の時間 × 時速 5km
export function climbMin(minutes: number, rise: number, d: number = (minutes * 5000) / 60): number {
  if (d <= 0 || rise <= 0) return 0
  return minutes * (Math.exp(3.5 * (rise / d)) - 1)
}

// 道に沿った移動時間の表（サーバーが OpenStreetMap の OSRM で作る）。無いときは直線距離から見積もる
type Matrix = { index: Map<Point, number>; walk: (number | null)[][]; drive: (number | null)[][]; walkM: (number | null)[][] | null; heights: (number | null)[] }
let M: Matrix | null = null

export function setMatrix(data: AreaData) {
  cache = new WeakMap()
  const m = data.matrix
  if (!m) {
    M = null
    return
  }
  const pos = new Map(m.ids.map((id, i) => [id, i]))
  const index = new Map<Point, number>()
  for (const [id, p] of pointsById(data)) {
    const i = pos.get(id)
    if (i !== undefined) index.set(p, i)
  }
  M = { index, walk: m.walk, drive: m.drive, walkM: m.walkM?.length === m.ids.length ? m.walkM : null, heights: m.heights?.length === m.ids.length ? m.heights : [] }
}

// 時刻表から作った、バス・電車で戸口から戸口までの目安の表。あれば電車・バスの時間に使い、直通の便が無い組みは式で見積もる
let T: { index: Map<Point, number>; minutes: (number | null)[][]; rail: TransitTable['rail'] | null } | null = null

export function setBusTable(data: AreaData, table: TransitTable | null | undefined) {
  cache = new WeakMap()
  if (!table) {
    T = null
    return
  }
  const pos = new Map(table.ids.map((id, i) => [id, i]))
  const index = new Map<Point, number>()
  for (const [id, p] of pointsById(data)) {
    const i = pos.get(id)
    if (i !== undefined) index.set(p, i)
  }
  T = { index, minutes: table.minutes, rail: table.rail?.via.length === table.ids.length ? table.rail : null }
}

// 電車・バスの目安（戸口から戸口まで。駅や停留所まで歩く・待つ・乗る・歩く）。md は車の所要時間（分）。
// 京都・浅草・横浜・箱根・日光の時刻表から求めた、場所どうしの目安（歩くと 20 分を超える 1,549 組）に合わせた式。
// どのエリアでも、時刻表の目安より短くなりすぎないようにしてある（エリアごとの比の中央値 0.97〜1.16）
export function transitEstimate(md: number | null, km: number): number {
  if (md != null) return Math.round(md <= 10 ? 12 + 3 * md : 42 + 2 * (md - 10))
  return Math.round(km <= 3 ? 10 + 10 * km : 40 + 3 * (km - 3))
}

// 同じ 2 点の計算を何千回も繰り返すので、点（オブジェクト）ごとに覚えておく
let cache = new WeakMap<Point, WeakMap<Point, Leg>>()

export function route(a: Point, b: Point): Leg {
  let row = cache.get(a)
  if (!row) cache.set(a, (row = new WeakMap()))
  const hit = row.get(b)
  if (hit) return hit
  const pick = P?.get(a)?.get(b)
  const ia = M?.index.get(a)
  const ib = M?.index.get(b)
  const road = M?.walkM && ia !== undefined && ib !== undefined ? M.walkM[ia][ib] : null
  const mw = road != null ? road / ROAD_M_PER_MIN : M && ia !== undefined && ib !== undefined ? M.walk[ia][ib] : null
  const md = M && ia !== undefined && ib !== undefined ? M.drive[ia][ib] : null
  const ha = M && ia !== undefined ? M.heights[ia] : null
  const hb = M && ib !== undefined ? M.heights[ib] : null
  const cutOff = ia !== undefined && ib !== undefined && M !== null && mw == null && distM(a, b) > NO_WALK_ROUTE_M
  const w = mw != null ? Math.max(1, Math.round(mw + (ha != null && hb != null ? climbMin(mw, hb - ha, road ?? undefined) : 0))) : walkMin(a, b)
  const real = pick === 'walk' && !cutOff ? undefined : O?.get(a)?.get(b)
  if (real) {
    const leg: Leg = { mode: 'transit', minutes: real.minutes, label: realLabel(real), from: a, to: b, real, ...(cutOff ? {} : { other: w }), ...(pick === 'transit' && { chosen: true }) }
    row.set(b, leg)
    return leg
  }
  const ta = T?.index.get(a)
  const tb = T?.index.get(b)
  const bus = T && ta !== undefined && tb !== undefined ? T.minutes[ta][tb] : null
  const transit = bus != null ? Math.max(5, Math.round(bus)) : transitEstimate(md, distM(a, b) / 1000)
  const via = bus != null && T?.rail ? T.rail.via[ta!]?.[tb!] : null
  const rail = via != null ? T?.rail?.opts[via] : undefined
  // 本人が選んだ手段があればそれを、無ければ、歩いて 20 分以内か電車・バスの目安の 1.15 倍以内なら歩く。
  // 歩く道の無い 2 点（cutOff）は、選んであっても歩かせず、歩く案（other）も出さない
  const walkPick = pick === 'walk' && !cutOff
  const walk = pick ? walkPick : !cutOff && (w <= 20 || w <= transit * 1.15)
  const chosen = pick && (pick === 'transit' || walkPick) ? { chosen: true } : {}
  const walkOther = cutOff ? {} : { other: w }
  const leg: Leg = walk
    ? { mode: 'walk', minutes: w, label: WORD.walk(w), from: a, to: b, other: transit, ...chosen }
    : rail
      ? { mode: 'transit', minutes: transit, label: WORD.rail(rail.line, transit), from: a, to: b, rail, ...walkOther, ...chosen }
      : { mode: 'transit', minutes: transit, label: WORD.about(transit), from: a, to: b, ...walkOther, ...chosen }
  row.set(b, leg)
  return leg
}

export function mapsDirUrl(leg: Leg): string {
  const mode = leg.mode === 'walk' ? 'walking' : 'transit'
  return `https://www.google.com/maps/dir/?api=1&origin=${leg.from.lat},${leg.from.lng}&destination=${leg.to.lat},${leg.to.lng}&travelmode=${mode}`
}

// Google マップのアプリを直接開く URL
export function mapsAppDirUrl(leg: Leg): string {
  const mode = leg.mode === 'walk' ? 'walking' : 'transit'
  return `comgooglemaps://?saddr=${leg.from.lat},${leg.from.lng}&daddr=${leg.to.lat},${leg.to.lng}&directionsmode=${mode}`
}

export function mapsAppPlaceUrl(name: string, area: string): string {
  return `comgooglemaps://?q=${encodeURIComponent(`${name} ${area}`)}`
}

// Safari 以外の iPhone のブラウザ（Chrome・Firefox・Edge など）か
export function isIosOtherBrowser(): boolean {
  const ua = navigator.userAgent
  return /iPhone|iPad|iPod/.test(ua) && /CriOS|FxiOS|EdgiOS|OPiOS/.test(ua)
}

export function mapsPlaceUrl(name: string, area: string): string {
  return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(`${name} ${area}`)}`
}

// 回る順に Google マップで表示する（経由地は 9 か所まで。end は到着地で、無ければ出発地に戻る）
export function mapsTourUrl(start: Point, stops: Point[], end: Point = start): string {
  const p = (x: Point) => `${x.lat},${x.lng}`
  const way = stops.slice(0, 9).map(p).join('|')
  return `https://www.google.com/maps/dir/?api=1&origin=${p(start)}&destination=${p(end)}&waypoints=${encodeURIComponent(way)}&travelmode=walking`
}
