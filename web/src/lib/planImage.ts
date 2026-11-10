// プランの画像。地図（OpenFreeMap・OSM の下地に、プランの線と番号の札）とスケジュール（画面の路線図と同じ形）を、
// 幅 1080 の縦長の 1 枚に描く。作りは旅の振り返りカード（lib/recap.ts）と共通（lib/cardImage.ts）。
// - Google マップの地図は画像にできないので、下地は MapLibre で画面の外に描く（MapLibre は画像を作るときだけ読み込む）。届かない・遅いときは、下地なしの図にする。
// - 場所の位置は、Places で照合する前の位置（guess）を使う。Google の位置しか無い場所は、地図に載せない。
// - 名前はエリアのデータの物だけを使い、写真・評価などの Places の内容は入れない。
// - 時刻表の便は、出典の表示で外に出せるライセンス（CC BY・CC0）の物だけ、路線名と路線の色を描く。
//   公共交通オープンデータ基本ライセンスの物は「成果物の外に表示しない」（第 4 条 2 項 (3)）ので、「バス N分」とだけ描く
// - 図形の出所: 線・円・角の丸い四角と文字は、置き方を AI が生成（Claude）。乗り物のアイコンは lib/modeShape.ts（Lucide）。
//   字は M PLUS 2・Barlow Semi Condensed（SIL Open Font License 1.1）
import type { Map as MapLibreMap } from 'maplibre-gl'
import mapLibreWorker from 'maplibre-gl/dist/maplibre-gl-worker.mjs?url'
import type { LL } from '../components/mapShared'
import type { BusTrip, Spot } from '../types'
import type { Leg } from './geo'
import type { Plan } from './planner'
import { roleText } from './found'
import { busName, creditItems, isTrain } from './bus'
import { boardStops, legPieces, shortLine, type Piece } from './legPieces'
import { busColor, lineEdge, railColor, stepColor } from './lineColor'
import { separate, shortName, type Box, type Pt } from './mapLayer'
import type { Mode } from './modeShape'
import { RECAP_WORDS } from './recap'
import { WALK_BACK, WALK_DOT, WALK_EDGE, WALK_STEP, along } from './walkDots'
import { fmt, fmtDur } from './time'
import { isEn, tr } from './i18n'
import { CARD_H, CARD_W as W, FONT, INK, INK2, NUM, ROUTE, drawModeIcon, fit, loadFonts, newCard, rrect, toPng } from './cardImage'

const T = tr({
  ja: {
    depart: '出発',
    arrive: '到着',
    sep: '・',
    span: (a: string, b: string) => `${a}〜${b}`,
    when: (date: string, span: string) => `${date}　${span}`,
    ride: (train: boolean): string => (train ? '電車' : 'バス'),
    mins: (m: number) => `${m}分`,
    about: (m: number) => `約${m}分`,
    ease: (m: number) => `ゆとり ${m}分`,
    wait: (m: number) => `開くまで ${m}分`,
    other: '乗り物',
    finale: '旅の締めくくり',
    timetable: (s: string) => `時刻表: ${s}`,
    rail: '電車の路線と駅: © OpenStreetMap contributors',
  },
  en: {
    depart: 'Depart',
    arrive: 'Arrive',
    sep: ' · ',
    span: (a: string, b: string) => `${a}–${b}`,
    when: (date: string, span: string) => `${date} · ${span}`,
    ride: (train: boolean) => (train ? 'Train' : 'Bus'),
    mins: (m: number) => `${m} min`,
    about: (m: number) => `~${m} min`,
    ease: (m: number) => `${m} min buffer`,
    wait: (m: number) => `${m} min until opening`,
    other: 'Ride',
    finale: 'Trip Finale',
    timetable: (s: string) => `Timetables: ${s}`,
    rail: 'Rail lines and stations: © OpenStreetMap contributors',
  },
})

const CARD = '#ffffff'
const X0 = 48
const CW = W - X0 * 2
const MAX_H = 2340 // 画像の高さの上限（スマホの画面と同じ縦横の比）
const OSM_WAIT = 6000 // 下地の地図を待つ長さ
const OSM_STYLE = 'https://tiles.openfreemap.org/styles/positron'
const OSM_CREDIT = 'OpenFreeMap © OpenMapTiles © OpenStreetMap contributors'

export type PlanImageInput = {
  area: string
  date: string // 日付の表示（dateLabel）
  start: { name: string; ll: LL }
  end?: { name: string; ll: LL } | null // 到着地（出発地に戻らない旅だけ）
  plan: Plan
  buses: (BusTrip | undefined)[] // 区間ごとの見つけた便（スケジュールの区間の行と地図に出している物）
  lines: (LL[] | null)[] // 区間ごとの道に沿った線（ownPlace の位置どうし）
}

// 画像に描く場所の位置。Places で照合した場所は照合の前の位置（guess）。Google の位置しか無い場所は null（地図に載せない）
export function ownPlace(s: Spot): LL | null {
  if (Array.isArray(s.guess) && s.guess.length === 2) return [s.guess[1], s.guess[0]]
  return typeof s.locatedAt === 'number' ? null : [s.lng, s.lat]
}

// 画像に描く点の並び（出発地・場所・到着地。到着地が無ければ出発地）
export const imagePoints = (start: LL, plan: Plan, goal: LL = start): (LL | null)[] => [start, ...plan.stops.map((s) => ownPlace(s.spot)), goal]

// 時刻表の便の中身（路線名・色・形）を画像に出してよいか（CC BY・CC0 の時刻表だけ）
const openTrip = (t: BusTrip | undefined | null): t is BusTrip => !!t && !!t.source?.license && t.source.license !== 'odpt'

// 区間ごとの、入れた便（無ければ見つけた便）
function legTrip(leg: Leg, found: BusTrip | undefined): BusTrip | undefined {
  if (leg.real) return leg.real.bus
  return found
}

// ---- 地図 ----

type Rect = { x: number; y: number; w: number; h: number }
type MapLeg = { coords: LL[]; mode: 'walk' | 'transit'; pieces: Piece[] | null; back: boolean; idx: number }

const S = 2 // 画面の地図の 1px が、画像の何 px か
const PIN = 24 * S
const START = 14 * S
const NAME = 13 * S
const STN = 10 * S // 乗る駅・降りる駅の印の一辺
const STN_NAME = 11 * S
const hitBox = (a: Box, b: Box) => Math.abs(a.x - b.x) * 2 < a.w + b.w && Math.abs(a.y - b.y) * 2 < a.h + b.h

// 区間ごとの線。乗換のスクリーンショットから入れた経路と、出せる便は、歩く所・乗る所に分ける（路線の色）
function mapLegs(input: PlanImageInput, pts: (LL | null)[]): MapLeg[] {
  const { plan } = input
  const legs: Leg[] = [...plan.stops.map((s) => s.leg), plan.back]
  const out: MapLeg[] = []
  legs.forEach((leg, i) => {
    const A = pts[i]
    const B = pts[i + 1]
    if (!A || !B) return
    const line = input.lines[i] ?? null
    const coords = line ?? [A, B]
    const trip = legTrip(leg, input.buses[i])
    let pieces: Piece[] | null = null
    if (leg.real && !leg.real.bus) pieces = legPieces(leg.real, A, B, line)
    else if (openTrip(trip)) pieces = legPieces(undefined, A, B, line, trip)
    else if (!leg.real && leg.mode === 'transit' && leg.rail) pieces = legPieces(undefined, A, B, line, null, leg.rail)
    out.push({ coords, mode: leg.mode, pieces, back: i === legs.length - 1, idx: i })
  })
  return out
}

// 下地なしの図の、緯度経度から枠の中の点（経度は緯度に合わせて縮める）
function flatProjector(all: LL[], box: Rect, pad: number) {
  const lat0 = all.reduce((a, p) => a + p[1], 0) / all.length
  const k = Math.cos((lat0 * Math.PI) / 180)
  const xs = all.map((p) => p[0] * k)
  const ys = all.map((p) => -p[1])
  const [x1, x2, y1, y2] = [Math.min(...xs), Math.max(...xs), Math.min(...ys), Math.max(...ys)]
  const s = Math.min(111320 / 1.5, (box.w - pad * 2) / Math.max(1e-9, x2 - x1), (box.h - pad * 2) / Math.max(1e-9, y2 - y1))
  const cx = (x1 + x2) / 2
  const cy = (y1 + y2) / 2
  return (p: LL): Pt => ({ x: box.x + box.w / 2 + (p[0] * k - cx) * s, y: box.y + box.h / 2 + (-p[1] - cy) * s })
}

// OpenFreeMap の下地を画面の外で描いて、枠に写す。届かない・遅いときは null
async function osmBase(c: CanvasRenderingContext2D, box: Rect, all: LL[]): Promise<{ at: (p: LL) => Pt; land: string; credit: string } | null> {
  const el = document.createElement('div')
  el.style.cssText = `position:fixed;left:-30000px;top:0;width:${box.w / S}px;height:${box.h / S}px;pointer-events:none;`
  document.body.appendChild(el)
  let m: MapLibreMap | null = null
  try {
    const maplibregl = await import('maplibre-gl')
    maplibregl.setWorkerUrl(mapLibreWorker)
    const b = new maplibregl.LngLatBounds(all[0], all[0])
    all.forEach((p) => b.extend(p))
    m = new maplibregl.Map({
      container: el,
      style: OSM_STYLE,
      bounds: b,
      fitBoundsOptions: { padding: { top: 56, bottom: 64, left: 56, right: 56 }, maxZoom: 15 },
      pixelRatio: S,
      interactive: false,
      attributionControl: false,
      fadeDuration: 0,
      canvasContextAttributes: { preserveDrawingBuffer: true },
    })
    const map = m
    // タイルが 1 枚でも届かなければ、欠けた下地になるので使わない
    let failed = false
    map.on('error', () => {
      failed = true
    })
    await new Promise<void>((resolve, reject) => {
      const t = window.setTimeout(() => reject(new Error('timeout')), OSM_WAIT)
      map.once('load', () => {
        for (const l of map.getStyle().layers ?? []) if (l.type === 'symbol') map.setLayoutProperty(l.id, 'visibility', 'none')
        map.once('idle', () => {
          window.clearTimeout(t)
          resolve()
        })
        map.triggerRepaint()
      })
    })
    if (failed || !map.areTilesLoaded()) return null
    c.drawImage(map.getCanvas(), box.x, box.y, box.w, box.h)
    const bg = (map.getStyle().layers ?? []).find((l) => l.type === 'background')
    const color = bg && map.getPaintProperty(bg.id, 'background-color')
    const land = typeof color === 'string' ? color : '#f8f4f0'
    const at = (p: LL): Pt => {
      const q = map.project(p)
      return { x: box.x + q.x * S, y: box.y + q.y * S }
    }
    return { at, land, credit: OSM_CREDIT }
  } catch {
    return null
  } finally {
    m?.remove()
    el.remove()
  }
}

function strokeLine(c: CanvasRenderingContext2D, pts: Pt[], color: string, width: number, alpha: number) {
  if (pts.length < 2) return
  c.save()
  c.globalAlpha = alpha
  c.strokeStyle = color
  c.lineWidth = width
  c.lineCap = 'round'
  c.lineJoin = 'round'
  c.beginPath()
  c.moveTo(pts[0].x, pts[0].y)
  for (const p of pts.slice(1)) c.lineTo(p.x, p.y)
  c.stroke()
  c.restore()
}

// 歩く所: 浅葱の丸い点を、地の色で縁取って並べる（画面の地図と同じ大きさと間。lib/walkDots）
function walkDots(c: CanvasRenderingContext2D, pts: Pt[], land: string, back: boolean) {
  const k = (back ? WALK_BACK : 1) * S
  const at = along(pts, WALK_STEP * k)
  c.save()
  c.globalAlpha = back ? 0.55 : 1
  for (const [color, r] of [
    [land, WALK_DOT / 2 + WALK_EDGE],
    [ROUTE, WALK_DOT / 2],
  ] as const) {
    c.fillStyle = color
    c.beginPath()
    for (const p of at) {
      c.moveTo(p.x + r * k, p.y)
      c.arc(p.x, p.y, r * k, 0, Math.PI * 2)
    }
    c.fill()
  }
  c.restore()
}

// 画面の地図と同じ線: 電車・バスは浅葱の実線（地の色で縁取り）、乗る所は路線の色（濃い縁取り）、歩く所は浅葱の丸い点の列。
// 最後に出発地へ戻る区間は、細く薄くして下に敷く。描いた線の点を返す（名前を線に重ねないため）
function drawLegs(c: CanvasRenderingContext2D, legs: MapLeg[], at: (p: LL) => Pt, land: string): Pt[][] {
  const drawn: Pt[][] = []
  for (const l of [...legs].sort((a, b) => Number(b.back) - Number(a.back))) {
    const alpha = l.back ? 0.55 : 1
    const parts = l.pieces ?? [{ kind: l.mode === 'walk' ? ('walk' as const) : ('ride' as const), coords: l.coords, color: null }]
    for (const p of parts) {
      const pts = p.coords.map(at)
      drawn.push(pts)
      if (p.kind === 'walk') {
        walkDots(c, pts, land, l.back)
        continue
      }
      const color = p.color ?? ROUTE
      strokeLine(c, pts, p.color ? lineEdge(color, false, land) : land, (l.back ? 6 : 7) * S, alpha)
      strokeLine(c, pts, color, (l.back ? 3 : 4) * S, alpha)
    }
  }
  return drawn
}

// 名前の箱が、線に重なるか（線を 6px ごとに見る）
function onLine(b: Box, lines: Pt[][]): boolean {
  const pad = 5 * S
  const x1 = b.x - b.w / 2 - pad
  const x2 = b.x + b.w / 2 + pad
  const y1 = b.y - b.h / 2 - pad
  const y2 = b.y + b.h / 2 + pad
  for (const l of lines)
    for (let i = 1; i < l.length; i++) {
      const a = l[i - 1]
      const d = l[i]
      if (Math.max(a.x, d.x) < x1 || Math.min(a.x, d.x) > x2 || Math.max(a.y, d.y) < y1 || Math.min(a.y, d.y) > y2) continue
      const n = Math.max(1, Math.ceil(Math.hypot(d.x - a.x, d.y - a.y) / 6))
      for (let k = 0; k <= n; k++) {
        const x = a.x + ((d.x - a.x) * k) / n
        const y = a.y + ((d.y - a.y) * k) / n
        if (x >= x1 && x <= x2 && y >= y1 && y <= y2) return true
      }
    }
  return false
}

// 乗る駅・降りる駅の印（画面の地図と同じ: 白い丸に路線の色の縁）。番号の札より先に描く
function drawStations(c: CanvasRenderingContext2D, stations: { at: Pt; color: string }[]) {
  for (const s of stations) {
    c.beginPath()
    c.arc(s.at.x, s.at.y, STN / 2 - 1.25 * S, 0, Math.PI * 2)
    c.fillStyle = '#ffffff'
    c.fill()
    c.lineWidth = 2.5 * S
    c.strokeStyle = s.color
    c.stroke()
  }
}

// 番号の札（画面の地図と同じ: 白地・浅葱の枠・墨の字）と、出発地（と到着地）の印と、名前。
// stations: 乗る駅・降りる駅（名前は場所の名前を置いたあとに、空いている所にだけ小さく出す）
function drawPins(c: CanvasRenderingContext2D, stops: { no: number; at: Pt; name: string }[], ends: { at: Pt; name: string }[], box: Rect, lines: Pt[][], keepOut: Box[], stations: { at: Pt; name: string }[]) {
  const endBoxes: Box[] = ends.map((e) => ({ x: e.at.x, y: e.at.y, w: START + 4 * S, h: START + 4 * S }))
  const placed = separate(
    stops.map((s) => s.at),
    endBoxes,
    PIN + 3 * S,
  )
  placed.forEach((p, i) => {
    const a = stops[i].at
    if (Math.hypot(p.x - a.x, p.y - a.y) < 1) return
    c.save()
    c.strokeStyle = ROUTE
    c.lineWidth = 1.5 * S
    c.beginPath()
    c.moveTo(a.x, a.y)
    c.lineTo(p.x, p.y)
    c.stroke()
    c.beginPath()
    c.arc(a.x, a.y, 3.5 * S, 0, Math.PI * 2)
    c.fillStyle = ROUTE
    c.fill()
    c.restore()
  })
  c.fillStyle = '#ffffff'
  c.strokeStyle = INK
  c.lineWidth = 3 * S
  for (const { at: start } of ends) {
    rrect(c, start.x - START / 2 + 1.5 * S, start.y - START / 2 + 1.5 * S, START - 3 * S, START - 3 * S, 2 * S)
    c.fill()
    c.stroke()
  }
  c.font = `700 ${14 * S}px ${NUM}`
  c.textAlign = 'center'
  placed.forEach((p, i) => {
    const b = 2.5 * S
    const label = String(stops[i].no)
    const w = Math.max(PIN, c.measureText(label).width + 10 * S)
    c.fillStyle = '#ffffff'
    c.strokeStyle = ROUTE
    c.lineWidth = b
    rrect(c, p.x - w / 2 + b / 2, p.y - PIN / 2 + b / 2, w - b, PIN - b, 6 * S - b / 2)
    c.fill()
    c.stroke()
    c.fillStyle = INK
    c.fillText(label, p.x, p.y + 5 * S)
  })
  c.textAlign = 'left'
  // 名前は札の右・左・下・上・斜めのうち、札・ほかの名前・線・出典と重ならず、枠からはみ出さない所に置く（無ければ出さない）
  const pins: Box[] = placed.map((p) => ({ x: p.x, y: p.y, w: PIN + 8 * S, h: PIN + 8 * S }))
  const taken: Box[] = [...endBoxes, ...pins, ...keepOut]
  const stnBoxes: Box[] = stations.map((s) => ({ x: s.at.x, y: s.at.y, w: STN + 2 * S, h: STN + 2 * S }))
  const label = (text: string, at: Pt, half: number, own: Box, small = false) => {
    const size = small ? STN_NAME : NAME
    c.font = small ? `600 ${size}px ${FONT}` : `700 ${size}px ${FONT}`
    const w = c.measureText(text).width
    const h = size * 1.3
    const g = 5 * S
    const tries: Box[] = [
      { x: at.x + half + g + w / 2, y: at.y, w, h },
      { x: at.x - half - g - w / 2, y: at.y, w, h },
      { x: at.x, y: at.y + half + g + h / 2, w, h },
      { x: at.x, y: at.y - half - g - h / 2, w, h },
      { x: at.x + half + g + w / 2, y: at.y - half - h / 2, w, h },
      { x: at.x + half + g + w / 2, y: at.y + half + h / 2, w, h },
      { x: at.x - half - g - w / 2, y: at.y - half - h / 2, w, h },
      { x: at.x - half - g - w / 2, y: at.y + half + h / 2, w, h },
    ]
    const inside = (t: Box) => t.x - w / 2 >= box.x + 16 && t.x + w / 2 <= box.x + box.w - 16 && t.y - h / 2 >= box.y + 12 && t.y + h / 2 <= box.y + box.h - 12
    // ほかの札のほうが近くなる所には置かない（どの札の名前か読み違えないように）
    const gap = (t: Box, p: Pt) => Math.hypot(Math.max(0, Math.abs(p.x - t.x) - t.w / 2), Math.max(0, Math.abs(p.y - t.y) - t.h / 2))
    const mine = (t: Box) => {
      const d = gap(t, at)
      return pins.every((o) => o === own || gap(t, o) > d + 4 * S)
    }
    const ok = tries.find((t) => inside(t) && mine(t) && !taken.some((o) => o !== own && hitBox(o, t)) && !(small ? stnBoxes : []).some((o) => o !== own && hitBox(o, t)) && !onLine(t, lines))
    if (!ok) return
    taken.push({ ...ok, w: ok.w + 8 * S, h: ok.h + 4 * S })
    const x = ok.x - w / 2
    const y = ok.y + size * 0.36
    c.lineJoin = 'round'
    c.lineWidth = (small ? 4 : 5) * S
    c.strokeStyle = '#ffffff'
    c.strokeText(text, x, y)
    c.fillStyle = small ? INK2 : INK
    c.fillText(text, x, y)
  }
  placed.forEach((p, i) => label(shortName(stops[i].name), p, PIN / 2, pins[i]))
  ends.forEach((e, i) => label(shortName(e.name), e.at, START / 2, endBoxes[i]))
  stations.forEach((s, i) => label(shortName(s.name), s.at, STN / 2, stnBoxes[i], true))
}

async function drawMap(c: CanvasRenderingContext2D, input: PlanImageInput, box: Rect) {
  const pts = imagePoints(input.start.ll, input.plan, input.end?.ll)
  const legs = mapLegs(input, pts)
  const all = [...pts.filter((p): p is LL => !!p), ...legs.flatMap((l) => l.coords)]
  c.save()
  rrect(c, box.x, box.y, box.w, box.h, 28)
  c.fillStyle = CARD
  c.fill()
  c.clip()
  const osm = await osmBase(c, box, all)
  const at = osm?.at ?? flatProjector(all, box, 48 * S)
  const lines = drawLegs(c, legs, at, osm?.land ?? CARD)
  // 出典（地図の右下の隅）
  const keepOut: Box[] = []
  if (osm) {
    c.font = `400 22px ${FONT}`
    const w = c.measureText(osm.credit).width
    const bx = box.x + box.w - w - 28
    const by = box.y + box.h - 44
    c.fillStyle = 'rgba(255,255,255,0.85)'
    rrect(c, bx, by, w + 28, 44, 0)
    c.fill()
    c.fillStyle = INK2
    c.fillText(osm.credit, bx + 14, by + 30)
    keepOut.push({ x: bx + (w + 28) / 2, y: by + 22, w: w + 28, h: 44 })
  }
  const stops = input.plan.stops.flatMap((s, i) => {
    const p = pts[i + 1]
    return p ? [{ no: i + 1, at: at(p), name: s.spot.name }] : []
  })
  const ends = [input.start, ...(input.end ? [input.end] : [])].map((e) => ({ at: at(e.ll), name: e.name }))
  const stations = boardStops(legs)
    .map((b) => ({ at: at(b.ll), name: b.name, color: b.color ?? ROUTE }))
    .filter((s) => !keepOut.some((k) => hitBox(k, { x: s.at.x, y: s.at.y, w: STN, h: STN })))
  drawStations(c, stations)
  drawPins(c, stops, ends, box, lines, keepOut, stations)
  c.restore()
}

// ---- スケジュール（画面の路線図と同じ形） ----
// 強さは 3 段: 主役は着く時刻と場所の名前、中は区間（手段のアイコン・路線の色の印と路線名・分）、補足は役割・滞在・ゆとり

type Bit = { icon?: Mode; color?: string | null; text: string; note?: boolean }

// 区間の行の中身（1 行に収める）
function legBits(leg: Leg, found: BusTrip | undefined, ease: number, wait: number): Bit[][] {
  const notes: Bit[] = []
  if (ease > 0) notes.push({ text: T.sep + T.ease(ease), note: true })
  if (wait > 0) notes.push({ text: T.sep + T.wait(wait), note: true })
  const real = leg.real
  const trip = legTrip(leg, found)
  const tripIcon = (t: BusTrip): Mode => (isTrain(t) ? 'train' : 'bus')
  // 縮め方の順に並べた候補（長い名前 → 短い名前 → 名前なし）
  if (real && !real.bus) {
    const rides = real.steps.filter((s) => s.mode !== 'walk')
    const total = { text: ` ${T.mins(leg.minutes)}` }
    const make = (name: (line: string) => string): Bit[] => [
      ...rides.flatMap((s, i) => [
        ...(i ? [{ text: ' → ' }] : []),
        { icon: s.mode === 'bus' || s.mode === 'train' ? (s.mode as Mode) : undefined, color: stepColor(s, real), text: name(s.line.trim()) || T.other },
      ]),
      total,
      ...notes,
    ]
    if (!rides.length) return [[{ icon: 'walk', text: T.mins(leg.minutes) }, ...notes]]
    return [make((l) => l), make((l) => shortLine(l) || l), make(() => ''), [{ icon: 'train', text: leg.label }, ...notes]]
  }
  if (real?.bus || (trip && openTrip(trip))) {
    const t = real?.bus ?? trip!
    if (openTrip(t)) {
      const mins = { text: ` ${T.mins(leg.minutes)}` }
      return [
        [{ icon: tripIcon(t), color: busColor(t), text: busName(t) }, mins, ...notes],
        [{ icon: tripIcon(t), color: busColor(t), text: shortLine(t.route) || t.route }, mins, ...notes],
      ]
    }
    return [[{ icon: tripIcon(t), text: `${T.ride(isTrain(t))} ${T.mins(leg.minutes)}` }, ...notes]]
  }
  const rail = !real && !trip && leg.mode === 'transit' ? leg.rail : undefined
  if (rail) {
    const mins = { text: ` ${T.about(leg.minutes)}` }
    return [
      [{ icon: 'train', color: railColor(rail), text: rail.line }, mins, ...notes],
      [{ icon: 'train', color: railColor(rail), text: shortLine(rail.line) || rail.line }, mins, ...notes],
      [{ icon: 'train', text: leg.label }, ...notes],
    ]
  }
  return [[{ icon: leg.mode === 'walk' ? 'walk' : 'train', text: leg.label }, ...notes]]
}

type Row =
  | { kind: 'end'; time: number; name: string; meta: string }
  | { kind: 'stop'; no: number; time: number; name: string; meta: string; finale: boolean }
  | { kind: 'leg'; mode: 'walk' | 'transit'; choices: Bit[][] }

function scheduleRows(input: PlanImageInput): Row[] {
  const { plan, start } = input
  const rows: Row[] = [{ kind: 'end', time: plan.leave, name: start.name, meta: T.depart }]
  plan.stops.forEach((s, i) => {
    rows.push({ kind: 'leg', mode: s.leg.mode, choices: legBits(s.leg, input.buses[i], s.ease, s.wait) })
    rows.push({ kind: 'stop', no: i + 1, time: s.arrive, name: s.spot.name, meta: [roleText(s), fmtDur(s.stay)].join(T.sep), finale: s.finale })
  })
  rows.push({ kind: 'leg', mode: plan.back.mode, choices: legBits(plan.back, input.buses[plan.stops.length], 0, 0) })
  rows.push({ kind: 'end', time: plan.finish, name: (input.end ?? start).name, meta: T.arrive })
  return rows
}

// 字の大きさの段（幅 1080 の画像。本文は 32px より小さくしない）。compact: 場所が多いときの詰めた形（役割・滞在を名前の行に置く）
const sizes = (compact: boolean) => ({
  compact,
  main: compact ? 40 : 44, // 主役: 時刻と名前
  mid: 32, // 中: 区間
  note: 28, // 補足: 役割・滞在・ゆとり
  icon: 32,
  mark: 20,
  stop: compact ? 72 : 108,
  end: compact ? 72 : 100,
  leg: compact ? 52 : 62,
  pad: 24,
  badge: compact ? 52 : 58,
  terminal: 30,
  rail: 10,
  dot: 4.7,
  dotGap: 18,
})
type Size = ReturnType<typeof sizes>

const TIME_R = X0 + 150
const RAIL_X = TIME_R + 50
const BODY_X = RAIL_X + 50
const BODY_R = X0 + CW - 32
const BODY_W = BODY_R - BODY_X
const MORE = isEn ? '…' : '……'

function bitFont(b: Bit, z: Size) {
  return b.note ? `400 ${z.note}px ${FONT}` : `500 ${z.mid}px ${FONT}`
}
function bitsWidth(c: CanvasRenderingContext2D, bits: Bit[], z: Size) {
  let w = 0
  for (const b of bits) {
    if (b.icon) w += z.icon + 6
    if (b.color) w += z.mark + 8
    c.font = bitFont(b, z)
    w += c.measureText(b.text).width
  }
  return w
}
// 1 行に入る候補を選ぶ（どれも入らなければ、最後の候補の字を「……」で切る）
function pickBits(c: CanvasRenderingContext2D, choices: Bit[][], z: Size): Bit[] {
  for (const ch of choices) if (bitsWidth(c, ch, z) <= BODY_W) return ch
  const last = choices[choices.length - 1]
  const out: Bit[] = []
  let w = 0
  for (const b of last) {
    const bw = bitsWidth(c, [b], z)
    if (w + bw <= BODY_W) {
      out.push(b)
      w += bw
      continue
    }
    c.font = bitFont(b, z)
    const head = bitsWidth(c, [{ ...b, text: '' }], z)
    const text = fit(c, b.text, BODY_W - w - head)
    if (text && text !== MORE) out.push({ ...b, text })
    break
  }
  return out
}

// 線路（札と札の間の線）。電車・バスは実線、徒歩は点の線
function drawRail(c: CanvasRenderingContext2D, y1: number, y2: number, mode: 'walk' | 'transit', z: Size) {
  c.fillStyle = ROUTE
  if (mode === 'transit') {
    c.fillRect(RAIL_X - z.rail / 2, y1, z.rail, y2 - y1)
    return
  }
  for (let y = y1 + z.dotGap / 2; y < y2; y += z.dotGap) {
    c.beginPath()
    c.arc(RAIL_X, y, z.dot, 0, Math.PI * 2)
    c.fill()
  }
}

const rowH = (r: Row, z: Size) => (r.kind === 'leg' ? z.leg : r.kind === 'end' ? z.end : z.stop + (r.finale && !z.compact ? z.note * 1.3 : 0))
const scheduleHeight = (rows: Row[], z: Size) => rows.reduce((a, r) => a + rowH(r, z), 0) + z.pad * 2

function drawSchedule(c: CanvasRenderingContext2D, rows: Row[], y0: number, z: Size) {
  const total = scheduleHeight(rows, z)
  c.fillStyle = CARD
  rrect(c, X0, y0, CW, total, 28)
  c.fill()
  const tops: number[] = []
  let y = y0 + z.pad
  for (const r of rows) {
    tops.push(y)
    y += rowH(r, z)
  }
  const mid = (i: number) => tops[i] + rowH(rows[i], z) / 2
  rows.forEach((r, i) => {
    if (r.kind === 'leg') drawRail(c, mid(i - 1), mid(i + 1), r.mode, z)
  })
  rows.forEach((r, i) => {
    const cy = mid(i)
    if (r.kind === 'leg') {
      let x = BODY_X
      for (const b of pickBits(c, r.choices, z)) {
        if (b.icon) {
          drawModeIcon(c, b.icon, x, cy, z.icon, INK)
          x += z.icon + 6
        }
        if (b.color) {
          c.fillStyle = b.color
          rrect(c, x, cy - z.mark / 2, z.mark, z.mark, 4)
          c.fill()
          x += z.mark + 8
        }
        c.font = bitFont(b, z)
        c.fillStyle = b.note ? INK2 : INK
        c.fillText(b.text, x, cy + (b.note ? z.note : z.mid) * 0.36)
        x += c.measureText(b.text).width
      }
      return
    }
    // 時刻（主役）
    c.textAlign = 'right'
    c.fillStyle = INK
    c.font = `700 ${z.main}px ${NUM}`
    c.fillText(fmt(r.time), TIME_R, cy + z.main * 0.36)
    c.textAlign = 'left'
    // 札（出発地と到着は丸、場所は番号の札）
    if (r.kind === 'end') {
      c.beginPath()
      c.arc(RAIL_X, cy, (z.terminal - 7) / 2, 0, Math.PI * 2)
      c.fillStyle = '#ffffff'
      c.fill()
      c.strokeStyle = ROUTE
      c.lineWidth = 7
      c.stroke()
    } else {
      const b = 5.5
      c.fillStyle = '#ffffff'
      c.strokeStyle = ROUTE
      c.lineWidth = b
      rrect(c, RAIL_X - z.badge / 2 + b / 2, cy - z.badge / 2 + b / 2, z.badge - b, z.badge - b, z.badge * 0.25 - b / 2)
      c.fill()
      c.stroke()
      c.fillStyle = ROUTE
      c.font = `700 ${z.badge * 0.54}px ${NUM}`
      c.textAlign = 'center'
      c.fillText(String(r.no).padStart(2, '0'), RAIL_X, cy + z.badge * 0.19)
      c.textAlign = 'left'
    }
    // 名前（主役）と、役割・滞在（補足）。詰めた形では、補足を名前の行の右に置く
    const extra = r.kind === 'stop' && r.finale ? T.finale : ''
    if (z.compact) {
      c.font = `400 ${z.note}px ${FONT}`
      const meta = r.kind === 'stop' ? (extra ? `${r.meta}${T.sep}${extra}` : r.meta) : r.meta
      const mw = c.measureText(meta).width
      c.fillStyle = INK2
      c.textAlign = 'right'
      c.fillText(meta, BODY_R, cy + z.note * 0.36)
      c.textAlign = 'left'
      c.font = `700 ${z.main}px ${FONT}`
      c.fillStyle = INK
      c.fillText(fit(c, r.name, BODY_W - mw - 24), BODY_X, cy + z.main * 0.36)
      return
    }
    const lines = 1 + (extra ? 1 : 0)
    const block = z.main * 1.2 + z.note * 1.35 * lines
    const top = cy - block / 2
    c.font = `700 ${z.main}px ${FONT}`
    c.fillStyle = INK
    c.fillText(fit(c, r.name, BODY_W), BODY_X, top + z.main * 0.95)
    c.font = `400 ${z.note}px ${FONT}`
    c.fillStyle = INK2
    c.fillText(fit(c, r.meta, BODY_W), BODY_X, top + z.main * 1.2 + z.note * 1.05)
    if (extra) c.fillText(extra, BODY_X, top + z.main * 1.2 + z.note * 2.4)
  })
  return total
}

// ---- 全体 ----

const HEAD = 250 // 見出しの下の端
const FOOT = 96 // 奥付の高さ
const GAP = 24
const MAP_MIN = 440
const MAP_GOOD = 760
const MAP_MAX = 960
const COMPACT_FROM = 7 // この数の場所からは、行を詰める

// 画像に出す時刻表の出典（路線名・色を出した便の物だけ）
function tripCredit(input: PlanImageInput): string {
  const legs = [...input.plan.stops.map((s) => s.leg), input.plan.back]
  const sources = legs.flatMap((l, i) => {
    const t = legTrip(l, input.buses[i])
    return openTrip(t) && t.source ? [t.source] : []
  })
  const items = creditItems(sources)
  const rail = legs.some((l, i) => !l.real && l.mode === 'transit' && l.rail && !legTrip(l, input.buses[i]))
  const parts = [
    ...(items.length ? [T.timetable(items.map((x) => (x.license ? `${x.text}（${x.license}）` : x.text)).join(T.sep))] : []),
    ...(rail ? [T.rail] : []),
  ]
  return parts.join(T.sep)
}

export async function drawPlanImage(input: PlanImageInput): Promise<Blob> {
  await loadFonts()
  const { plan } = input
  const rows = scheduleRows(input)
  const z = sizes(plan.stops.length >= COMPACT_FROM)
  const sched = scheduleHeight(rows, z)
  const credit = tripCredit(input)
  const foot = FOOT + (credit ? 40 : 0)
  // 高さは 1920 から、地図がほどよい大きさになるまで伸ばす（上限 2340）
  const fixed = HEAD + GAP * 2 + sched + foot
  const H = Math.min(MAX_H, Math.max(CARD_H, fixed + MAP_GOOD))
  const mapH = Math.min(MAP_MAX, Math.max(MAP_MIN, H - fixed))
  const { cv, c } = newCard(Math.max(H, fixed + mapH))
  const height = cv.height
  // 見出し
  c.fillStyle = ROUTE
  c.font = `700 28px ${FONT}`
  c.fillText('IntenTrip', 64, 92)
  c.fillStyle = INK
  c.font = `800 64px ${FONT}`
  c.fillText(fit(c, input.area, W - 128), 64, 168)
  c.fillStyle = INK2
  c.font = `500 32px ${FONT}`
  c.fillText(fit(c, T.when(input.date, T.span(fmt(plan.leave), fmt(plan.finish))), W - 128), 64, 220)

  const mapY = HEAD
  await drawMap(c, input, { x: X0, y: mapY, w: CW, h: mapH })
  const schedY = mapY + mapH + GAP
  drawSchedule(c, rows, schedY, z)

  // 奥付（時刻表の出典があれば、その上に）
  if (credit) {
    c.fillStyle = INK2
    c.font = `400 22px ${FONT}`
    c.fillText(fit(c, credit, W - 128), 64, height - foot + 40)
  }
  c.fillStyle = INK2
  c.font = `400 26px ${FONT}`
  c.fillText(RECAP_WORDS.tagline, 64, height - 44)
  c.fillStyle = ROUTE
  c.font = `700 28px ${FONT}`
  c.textAlign = 'right'
  c.fillText('IntenTrip', W - 64, height - 44)
  c.textAlign = 'left'
  return toPng(cv)
}
