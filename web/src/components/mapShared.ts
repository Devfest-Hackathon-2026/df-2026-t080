// 地図の部品（MapView・GoogleMapView）とほかの画面が使う、地図の下地によらない物（言葉・型・区間の線の取得と置き場・描き直しの合図）。
// MapLibre は読み込まない（Google マップ版とほかの画面は、こちらだけを読む）
import type { AreaBox, Found } from '../lib/areaSearch'
import { loggedFetch } from '../lib/apiLog'
import type { AreaData, BusTrip, RailOpt, Spot, TransitRoute } from '../types'
import type { Plan } from '../lib/planner'
import { legPieces, type Piece } from '../lib/legPieces'
import { tr } from '../lib/i18n'

export const MAPW = tr({
  ja: {
    noGeo: 'このページでは現在地を利用できません',
    denied: '位置情報の利用が許可されていません',
    failed: '現在地を取得できませんでした',
    map: 'マップ',
    fitPlan: 'プラン全体を表示',
    fitAll: '候補全体を表示',
    searchHere: 'この付近を検索',
  },
  en: {
    noGeo: 'Your location isn’t available on this page',
    denied: 'Location access isn’t allowed',
    failed: 'Couldn’t get your location',
    map: 'Map',
    fitPlan: 'Show Whole Plan',
    fitAll: 'Show All Options',
    searchHere: 'Search This Area',
  },
})

export type LL = [number, number]
// exact: 道に沿った線が届いたか（届くまでは薄い点線の直線）。pieces: 便か乗換を入れた区間の、歩く所と乗る所（無ければ 1 本の線）
export type Seg = { mode: 'walk' | 'transit'; coords: LL[]; exact: boolean; idx: number; minutes: number; pieces: Piece[] | null }

// 写真を選ぶ画面を閉じたときなどに、地図を描き直してもらう合図（TransitSheet から送る）
export const REDRAW_EVENT = 'intentrip:map-redraw'
export const askMapRedraw = () => window.dispatchEvent(new Event(REDRAW_EVENT))

export const lineCache = new Map<string, LL[] | null>()
export const legKey = (a: LL, b: LL, mode: string) => `${mode}:${a.join(',')}>${b.join(',')}`
// 道に沿った線が新しく届いた合図（スケジュールの区間の行が、徒歩の距離を出し直す）
export const LINES_EVENT = 'intentrip:lines'

type LineAsk = { a: LL; b: LL; mode: 'walk' | 'transit' }

// 聞いている途中の区間（同じ区間を続けて聞かず、届くのを待つ）
const flying = new Map<string, Promise<void>>()
// 取れなかった区間の回数と時刻。取れなかった回数が増えるほど、次に聞くまで長くあける
const missed = new Map<string, { n: number; at: number }>()
const MISS_GAP_MS = [3000, 15000, 60000, 300000]
// 1 回の問い合わせを待つ長さ（返事が来ないまま、その区間を聞いている途中のままにしない）
const LINES_WAIT_MS = 90000

// この区間を、今サーバーに聞いてよいか（取ってある・聞いている途中・取れなかったばかりの区間は聞かない）
function askable(k: string): boolean {
  if (lineCache.has(k) || flying.has(k)) return false
  const m = missed.get(k)
  return !m || Date.now() - m.at >= MISS_GAP_MS[Math.min(m.n, MISS_GAP_MS.length) - 1]
}

function miss(k: string) {
  missed.set(k, { n: (missed.get(k)?.n ?? 0) + 1, at: Date.now() })
}

async function askLines(need: LineAsk[]): Promise<void> {
  try {
    const body = JSON.stringify({ legs: need.map((l) => ({ a: l.a, b: l.b, mode: l.mode })) })
    const r = await loggedFetch('/api/legs', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body, signal: AbortSignal.timeout(LINES_WAIT_MS) })
    if (!r.ok) throw new Error(String(r.status))
    const j = (await r.json()) as { lines: (LL[] | null)[] }
    let more = false
    need.forEach((l, i) => {
      const k = legKey(l.a, l.b, l.mode)
      const line = j.lines?.[i]
      if (line && line.length > 1) {
        lineCache.set(k, line)
        missed.delete(k)
        more = true
      } else miss(k)
    })
    if (more) window.dispatchEvent(new Event(LINES_EVENT))
  } catch {
    need.forEach((l) => miss(legKey(l.a, l.b, l.mode)))
  }
}

// 区間の道に沿った線（取れなかった区間は null）。聞いている途中の区間は、その答えを待つ
export async function fetchLines(legs: LineAsk[]): Promise<(LL[] | null)[]> {
  const keys = legs.map((l) => legKey(l.a, l.b, l.mode))
  const need = new Map<string, LineAsk>()
  legs.forEach((l, i) => {
    if (!need.has(keys[i]) && askable(keys[i])) need.set(keys[i], l)
  })
  if (need.size) {
    const job = askLines([...need.values()])
    for (const k of need.keys()) flying.set(k, job)
    void job.then(() => {
      for (const k of need.keys()) if (flying.get(k) === job) flying.delete(k)
    })
  }
  const wait = new Set(keys.flatMap((k) => flying.get(k) ?? []))
  await Promise.all(wait)
  return keys.map((k) => lineCache.get(k) ?? null)
}

export type LegIn = { a: LL; b: LL; mode: 'walk' | 'transit'; minutes: number; real?: TransitRoute; rail?: RailOpt }

// 区間の線と、歩く所・乗る所の切れ端（found: その区間に見つけた便）
export const toSeg = (l: LegIn, idx: number, found?: BusTrip | null): Seg => {
  const line = lineCache.get(legKey(l.a, l.b, l.mode)) ?? null
  const pieces = legPieces(l.real, l.a, l.b, line, found, l.mode === 'transit' ? l.rail : undefined)
  return { mode: l.mode, coords: line ?? [l.a, l.b], exact: !!line, idx, minutes: l.minutes, pieces: pieces && pieces.map(walkAlongRoad) }
}

const roughM = (a: LL, b: LL) => Math.hypot((a[0] - b[0]) * 111320 * Math.cos((a[1] * Math.PI) / 180), (a[1] - b[1]) * 110540)
const roughLen = (c: LL[]) => c.reduce((m, p, i) => (i ? m + roughM(c[i - 1], p) : 0), 0)

// 駅や停留所まで歩く所の道の線が、直線のこの倍より長く、かつこの m より遠回りなら使わない。
// 歩く分は直線の距離から出しているので、駅の構内の点に寄せた線などで大きく回るときは、直線のほうが合う
const DETOUR_MAX = 3
const DETOUR_MIN_M = 150

// 駅や停留所まで歩く所は、2 点の直線で来る。道に沿った線が取れていれば、それに置き換える
function walkAlongRoad(p: Piece): Piece {
  if (p.kind !== 'walk' || p.coords.length !== 2) return p
  const road = lineCache.get(legKey(p.coords[0], p.coords[1], 'walk'))
  if (!road || road.length < 2) return p
  const coords: LL[] = [p.coords[0], ...road, p.coords[1]]
  const direct = roughM(p.coords[0], p.coords[1])
  const len = roughLen(coords)
  return len > direct * DETOUR_MAX && len - direct > DETOUR_MIN_M ? p : { ...p, coords }
}

// これより短い歩く所は、直線のままにする（道の線を聞かない）
const WALK_LINE_MIN_M = 80
// 1 回に聞く数（残りは次の描き直しで聞く）
const WALK_ASK_MAX = 24

// 区間の中の、駅や停留所まで歩く所で、道の線を聞く所
function walkAsks(segs: Seg[]): { a: LL; b: LL; mode: 'walk'; k: string }[] {
  const out: { a: LL; b: LL; mode: 'walk'; k: string }[] = []
  for (const s of segs)
    for (const p of s.pieces ?? []) {
      if (p.kind !== 'walk' || p.coords.length !== 2) continue
      const [a, b] = p.coords
      if (roughM(a, b) < WALK_LINE_MIN_M) continue
      out.push({ a, b, mode: 'walk', k: legKey(a, b, 'walk') })
    }
  return out
}

// 駅や停留所まで歩く所に、まだ道の線が無い所があるか（取れなかった所を聞き直すかを決める）
export const walkPending = (segs: Seg[]) => walkAsks(segs).some((w) => !lineCache.has(w.k))

// 区間の中の、駅や停留所まで歩く所の道の線を聞く（取ってある所・聞いている途中の所・取れなかったばかりの所は聞かない）。
// 新しく線が届いたら true（描き直す合図）
export async function fetchWalkPieces(segs: Seg[]): Promise<boolean> {
  const ask = walkAsks(segs)
    .filter((w, i, all) => askable(w.k) && all.findIndex((x) => x.k === w.k) === i)
    .slice(0, WALK_ASK_MAX)
  if (!ask.length) return false
  const got = await fetchLines(ask)
  return got.some((x) => !!x)
}

// 取れなかった線があるときに、聞き直すまでの間（1 回目・2 回目・3 回目）
const RETRY_MS = [4000, 20000, 60000]

// 区間の道の線と、駅や停留所まで歩く所の道の線を聞き、新しく届いたら描き直す（paint）。
// 取れなかった線があれば、RETRY_MS の間をあけて聞き直す。settled: 全部届いたか、1 回聞き直し終えた。戻り値: やめる関数
export function followLines(legs: LineAsk[], segsNow: () => Seg[], paint: () => void, settled: () => void = () => {}): () => void {
  let alive = true
  let timer: number | null = null
  let tries = 0
  let had = legs.length ? -1 : 0
  const round = () => {
    const walk = fetchWalkPieces(segsNow()).then((more) => {
      if (more && alive) paint()
    })
    const main = fetchLines(legs).then((got) => {
      const n = got.filter(Boolean).length
      if (alive && n !== had) paint()
      had = n
      return got
    })
    void Promise.all([main, walk]).then(([got]) => {
      if (!alive) return
      const short = got.some((x) => !x) || walkPending(segsNow())
      if (!short || tries >= 1) settled()
      if (short && tries < RETRY_MS.length) timer = window.setTimeout(round, RETRY_MS[tries++])
    })
  }
  round()
  return () => {
    alive = false
    if (timer !== null) window.clearTimeout(timer)
  }
}

export type MapProps = {
  data: AreaData
  plan: Plan | null
  focusId: string | null
  candidates: Spot[]
  // 開いている候補（地図の印を大きくする）
  candId?: string | null
  // 選んだ場所と一緒に映す候補（入れ替えを考えている候補）
  showId?: string | null
  // 区間ごとの、時刻表から見つけた便（スケジュールの区間の行に出している便。便も乗換も入れていない区間だけ）。その便の形と路線の色で描く
  buses?: (BusTrip | undefined)[]
  // 区間だけを見ている画面（便を選ぶ・乗換を入れる）の区間の番号。0 が出発地から 1 か所目へ、plan.stops.length が出発地へ戻る区間
  legIdx?: number | null
  // 行きたい場所に選んである候補（地図の印を浅葱にする）
  picked?: string[]
  // 手を入れたあとに、新しく入った・動いた場所（数秒だけ番号に印を付ける）
  changed?: Set<string>
  onOpen: (id: string) => void
  onCandidate: (id: string) => void
  // 地図の所要時間の札を押した（区間の番号。スケジュールの区間の行を押したときと同じ画面を開く）
  onLeg?: (idx: number) => void
  onNotice: (text: string) => void
  // この付近で検索（Google の地図だけ）。onAreaSearch があれば地図に「この付近を検索」を出し、押すと見えている範囲を渡す。
  // found: 結果（地図に印を出す）、foundId: 開いている結果、onFound: 結果の印を押した
  onAreaSearch?: () => void
  // 今見えている範囲を測る関数を入れてもらう入れ物（下から出る画面に隠れる所は除く。Google の地図だけが入れる）
  areaBox?: { current: (() => AreaBox | null) | null }
  // 探している間（地図のボタンを押せなくする）
  searching?: boolean
  found?: Found[]
  foundId?: string | null
  onFound?: (id: string) => void
}

// 選んである候補・見つけた便が無いときの、いつも同じ空の並び
export const NO_PICKS: string[] = []
export const NO_BUSES: (BusTrip | undefined)[] = []
export const NO_FOUND: Found[] = []
// 候補の点が映っているとみなす、地図の端からの距離
export const SEEN = 24

// 区間の両端と、描いている線（便か乗換を入れた区間は歩く所・乗る所の線）の点。place: 地図に出す場所の位置。
// goal: 到着地（無い旅は出発地）
export function legPoints(plan: Plan, start: LL, goal: LL, segs: Seg[], k: number, place: (s: Spot) => LL = (s) => [s.lng, s.lat]): LL[] {
  const at = (i: number): LL => (i < 0 ? start : i >= plan.stops.length ? goal : place(plan.stops[i].spot))
  const s = segs.find((x) => x.idx === k)
  const line = s ? (s.pieces ? s.pieces.flatMap((p) => p.coords) : s.coords) : []
  return [at(k - 1), at(k), ...line]
}

// 下から出る画面の大きさが変わったら知らせる（区間の画面は、便が届くと高くなる）
export function watchSheet(on: () => void): () => void {
  let ro: ResizeObserver | null = null
  const raf = window.requestAnimationFrame(() => {
    const el = document.querySelector('.sheet')
    if (!el) return
    let h = el.getBoundingClientRect().height
    ro = new ResizeObserver(() => {
      const now = el.getBoundingClientRect().height
      if (Math.abs(now - h) < 8) return
      h = now
      on()
    })
    ro.observe(el)
  })
  return () => {
    window.cancelAnimationFrame(raf)
    ro?.disconnect()
  }
}
