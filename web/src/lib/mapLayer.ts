// 地図の上の札の層。Google マップ版と MapLibre 版の両方が、この 1 つの部品で番号・名前・出発地・所要時間・候補・現在地を描く。
// 地図の部品は「緯度経度を画面の点に直す関数」と「見えている範囲」を渡すだけで、置き方はここで決める。
// - 番号の札は本当の位置に置き、近くの札と重なるときは押し離して、本当の位置に小さな点を打ち細い線で結ぶ
// - 名前は札の右・左・下・上のうち空いている所に置き、どこも空いていなければ出さない
// - 候補は、場所の種類のアイコン（lib/kindIcon。一覧の写真の無い場所と同じ形）を、地図記号のように細い線で小さく描く
// - 所要時間の札は、選んだ場所の前後の区間（区間だけを見ているときはその区間）だけに出す。便か乗換を入れた区間は、歩く所・乗る所ごとの小さな札に分ける
// - 便と電車の目安の区間は、乗る駅・降りる駅に小さな丸い印を置き、名前はほかの札と重ならない所にだけ出す（区間だけを見ているときは、その区間の 2 つを先に置く）
import type { LL } from '../components/mapShared'
import { boardStops, type Piece } from './legPieces'
import { isEn, tr } from './i18n'
import { fmtDur } from './time'
import { laneGap } from './routeLanes'
import { KIND_ICON, type SpotKind } from './kindIcon'

const WORD = tr({
  ja: { cand: (n: string) => `候補: ${n}`, walk: '徒歩', transit: '電車・バス', bus: 'バス', train: '電車', other: '乗り物', me: '現在地', off: (n: string) => `${n}で降りる` },
  en: { cand: (n: string) => `Option: ${n}`, walk: 'Walk', transit: 'Transit', bus: 'Bus', train: 'Train', other: 'Other', me: 'My Location', off: (n: string) => `Get off: ${n}` },
})

export type Pt = { x: number; y: number }
// keepOut: 名前や所要時間を置かない所（地図の左上を原点にした中心と大きさ。右下のボタンや下の端の著作権の表示）
export type View = { x: number; y: number; w: number; h: number; zoom: number; keepOut?: Box[] }
export type Projector = () => { project: (ll: LL) => Pt | null; view: View } | null

export type LayerData = {
  start: { name: string; ll: LL } | null
  // 到着地（出発地に戻らない旅だけ。出発地と同じ印で、名前で見分ける）
  end?: { name: string; ll: LL } | null
  stops: { id: string; name: string; ll: LL }[]
  // idx: 0 が出発地から 1 番目へ、stops.length が最後の場所から到着地（無ければ出発地）へ。pieces: 歩く所と乗る所（便か乗換を入れた区間だけ）。
  // lane: 線を横にずらして描いている車線（lib/routeLanes。正は進む向きの右）。札も同じだけずらす
  legs: { coords: LL[]; mode: 'walk' | 'transit'; minutes: number; idx: number; pieces?: Piece[] | null; lane?: number }[]
  // kind: 場所の種類（印の形）。picked: 行きたい場所に選んである候補（印を浅葱にする）。named: 拡大していなくても名前を出す候補
  cands: { id: string; name: string; ll: LL; kind: SpotKind; picked?: boolean; named?: boolean }[]
  // この付近で検索の結果（Google の地図のときだけ。押すと onFound）
  found?: { id: string; name: string; ll: LL }[]
}
// focus: 選んだ場所の番号（0 から・無ければ -1）。leg: 区間だけを見ている画面の区間の番号（無ければ -1。focus より先に見る）
// hover: スケジュールの行にマウスを乗せている・フォーカスしている場所（札を浅葱で強める）
export type LayerState = { focus: number; leg: number; candId: string | null; changed: Set<string>; me: LL | null; foundId?: string | null; hover?: string | null }

// 濃く描く区間と場所。区間だけを見ているときはその区間とその両端、場所を選んだときはその場所と前後の区間・場所。
// どちらも無いときは、どれも濃く描き（any が false）、所要時間の札は出さない
export function litOf(focus: number, leg: number) {
  if (leg >= 0) return { any: true, on: -1, legLit: (idx: number) => idx === leg, stopLit: (i: number) => i === leg - 1 || i === leg }
  if (focus >= 0) return { any: true, on: focus, legLit: (idx: number) => idx === focus || idx === focus + 1, stopLit: (i: number) => Math.abs(i - focus) <= 1 }
  return { any: false, on: -1, legLit: () => true, stopLit: () => true }
}

// bare: 候補の印と点も置かない所（地図の出典の表示と、地図に重ねたボタン）
export type Box = { x: number; y: number; w: number; h: number; far?: boolean; pin?: boolean; bare?: boolean }
type Side = 'r' | 'l' | 'b' | 't' | 'rb' | 'rt' | 'lb' | 'lt'
const SIDES: Side[] = ['r', 'l', 'b', 't']
const SIDES_ALL: Side[] = [...SIDES, 'rb', 'rt', 'lb', 'lt']

const PIN = 24 // 番号の札の一辺
const PIN_GAP = 3 // 札どうしのすき間
const START = 14 // 出発地の印の一辺
const NAME_GAP = 4 // 札と名前のすき間
const NAME_AWAY = 7 // 名前とほかの札のすき間（となりの札の名前と読み違えないように）
const NEAR_ZOOM = 14 // この拡大から、候補の名前も出す
const CAND = 15 // 候補の印の一辺
const CAND_PICKED = 17 // 行きたい場所に選んである候補の印の一辺
const CAND_ON = 20 // 開いている候補の印の一辺
const FOUND = 14 // この付近で検索の結果の印の一辺
const FOUND_ON = 20 // 開いている結果の印の一辺
const STN = 10 // 乗る駅・降りる駅の印の一辺
const STN_OFF = 13 // 降りる駅の印の一辺（降りてから歩く所を見つけやすく）
// 所要時間の札を置いてみる所（線の長さの割合。真ん中から外へ）
const TRY_ALONG = [0.5, 0.44, 0.56, 0.38, 0.62, 0.32, 0.68, 0.26, 0.74, 0.2, 0.8, 0.14, 0.86]

// 所要時間の札のアイコン。形の出典: Material Icons（https://fonts.google.com/icons?icon.set=Material+Icons）の
// directions_walk・directions_transit・train。Apache License 2.0（https://github.com/google/material-design-icons）。著作権は Google
const ICON = {
  walk: 'M13.5 5.5c1.1 0 2-.9 2-2s-.9-2-2-2-2 .9-2 2 .9 2 2 2zM9.8 8.9L7 23h2.1l1.8-8 2.1 2v6h2v-7.5l-2.1-2 .6-3C14.8 12 16.8 13 19 13v-2c-1.9 0-3.5-1-4.3-2.4l-1-1.6c-.4-.6-1-1-1.7-1-.3 0-.5.1-.8.1L6 8.3V13h2V9.6l1.8-.7',
  transit:
    'M12 2c-4.42 0-8 .5-8 4v9.5C4 17.43 5.57 19 7.5 19L6 20.5v.5h12v-.5L16.5 19c1.93 0 3.5-1.57 3.5-3.5V6c0-3.5-3.58-4-8-4zM7.5 17c-.83 0-1.5-.67-1.5-1.5S6.67 14 7.5 14s1.5.67 1.5 1.5S8.33 17 7.5 17zm3.5-6H6V6h5v5zm5.5 6c-.83 0-1.5-.67-1.5-1.5s.67-1.5 1.5-1.5 1.5.67 1.5 1.5-.67 1.5-1.5 1.5zm1.5-6h-5V6h5v5z',
  train:
    'M12 2c-4 0-8 .5-8 4v9.5C4 17.43 5.57 19 7.5 19L6 20.5v.5h2.23l2-2H14l2 2h2v-.5L16.5 19c1.93 0 3.5-1.57 3.5-3.5V6c0-3.5-3.58-4-8-4zM7.5 17c-.83 0-1.5-.67-1.5-1.5S6.67 14 7.5 14s1.5.67 1.5 1.5S8.33 17 7.5 17zm3.5-7H6V6h5v4zm2 0V6h5v4h-5zm3.5 7c-.83 0-1.5-.67-1.5-1.5s.67-1.5 1.5-1.5 1.5.67 1.5 1.5-.67 1.5-1.5 1.5z',
}

export const durText = (min: number) => fmtDur(Math.max(1, Math.round(min)))

const partMode = (m: Piece['mode']) => (m === 'walk' || m === 'train' || m === 'bus' ? m : 'other')

// 歩く所・乗る所の小さな札（アイコン・路線の色の印・路線名の短い形・分）。バスでも電車でもない乗り物（ロープウェイ・船など）は、アイコンの代わりに「乗り物」と出す
function partBadge(p: Piece): HTMLElement {
  const mode = partMode(p.mode)
  const e = div(`leg-badge leg-part ${mode}`)
  e.setAttribute('aria-label', [WORD[mode], p.name, durText(p.minutes)].filter(Boolean).join(' '))
  if (mode !== 'other') e.appendChild(icon(mode === 'bus' ? 'transit' : mode))
  if (p.kind === 'ride' && p.color) {
    const mark = div('leg-part-mark')
    mark.style.background = p.color
    e.appendChild(mark)
  }
  if (p.name) e.appendChild(div('leg-part-name', p.name))
  else if (mode === 'other') e.appendChild(div('leg-part-kind', WORD.other))
  const t = document.createElement('span')
  t.textContent = durText(p.minutes)
  e.appendChild(t)
  return e
}

// 地図に出す名前は、2 行まで折り返して出し、それでも長ければ省く（英語は字が細いので長めまで出す）
const NAME_MAX = isEn ? 34 : 16
const CUT = isEn ? '…' : '……'
export const shortName = (s: string) => ([...s].length > NAME_MAX ? [...s].slice(0, NAME_MAX - 1).join('').trimEnd() + CUT : s)

// 名前の大きさを測る。折り返したときは、いちばん長い行の幅に詰め、3 行以上になるなら 2 行に入るまで後ろを省く
function sizeName(e: HTMLElement): [number, number] {
  e.style.visibility = 'hidden'
  e.style.display = ''
  e.style.width = ''
  const line = parseFloat(getComputedStyle(e).lineHeight) || 16
  let r = e.getBoundingClientRect()
  if (r.height > line * 2.5) {
    const full = [...(e.textContent ?? '')]
    let n = full.length
    while (n > 2 && r.height > line * 2.5) {
      n--
      e.textContent = full.slice(0, n).join('').trimEnd() + CUT
      r = e.getBoundingClientRect()
    }
  }
  if (r.height > line * 1.5) {
    const range = document.createRange()
    range.selectNodeContents(e)
    const w = Math.max(...[...range.getClientRects()].map((x) => x.right - r.left))
    if (w > 0 && w < r.width) e.style.width = `${Math.ceil(w)}px`
    r = e.getBoundingClientRect()
  }
  return [Math.ceil(r.width), Math.ceil(r.height)]
}

const hit = (a: Box, b: Box) => Math.abs(a.x - b.x) * 2 < a.w + b.w && Math.abs(a.y - b.y) * 2 < a.h + b.h
const overlap = (a: Box, b: Box) =>
  Math.max(0, Math.min(a.x + a.w / 2, b.x + b.w / 2) - Math.max(a.x - a.w / 2, b.x - b.w / 2)) *
  Math.max(0, Math.min(a.y + a.h / 2, b.y + b.h / 2) - Math.max(a.y - a.h / 2, b.y - b.h / 2))
// 名前を置くときの当たり: 自分の札とはすぐ隣でよく、ほかの札とは NAME_AWAY だけ離す
const hitName = (t: Box, b: Box, own: Box | null) =>
  t !== own && (t.pin ? hit({ ...t, w: t.w + NAME_AWAY * 2, h: t.h + NAME_AWAY * 2 }, b) : hit(t, b))
const inside = (a: Box, v: View) => a.x - a.w / 2 >= v.x - 2 && a.x + a.w / 2 <= v.x + v.w + 2 && a.y - a.h / 2 >= v.y - 2 && a.y + a.h / 2 <= v.y + v.h + 2

// 線の長さで t の割合の所
export function along(c: LL[], t: number): LL {
  if (c.length < 2) return c[0]
  const k = Math.cos((c[0][1] * Math.PI) / 180)
  const len = c.slice(1).map((p, i) => Math.hypot((p[0] - c[i][0]) * k, p[1] - c[i][1]))
  let rest = len.reduce((a, b) => a + b, 0) * t
  for (let i = 0; i < len.length; i++) {
    if (rest <= len[i]) {
      const f = len[i] ? rest / len[i] : 0
      return [c[i][0] + (c[i + 1][0] - c[i][0]) * f, c[i][1] + (c[i + 1][1] - c[i][1]) * f]
    }
    rest -= len[i]
  }
  return c[c.length - 1]
}

// 線の長さで t の割合の所を画面の点にして、進む向きの右へ px だけずらした所（地図は回さないので、画面の向きは緯度経度の向きと同じ）
function shifted(project: (ll: LL) => Pt | null, c: LL[], t: number, px: number): Pt | null {
  const p = project(along(c, t))
  if (!p || !px || c.length < 2) return p
  const k = Math.cos((c[0][1] * Math.PI) / 180)
  const len = c.slice(1).map((q, i) => Math.hypot((q[0] - c[i][0]) * k, q[1] - c[i][1]))
  let rest = len.reduce((a, b) => a + b, 0) * t
  let i = 0
  while (i < len.length - 1 && (rest > len[i] || !len[i])) rest -= len[i++]
  const dx = (c[i + 1][0] - c[i][0]) * k
  const dy = c[i + 1][1] - c[i][1]
  const n = Math.hypot(dx, dy)
  return n ? { x: p.x + (dy / n) * px, y: p.y + (dx / n) * px } : p
}

// 重なった札を押し離す。重なりの浅い向きへ半分ずつ動かし、出発地の印からは札だけを動かす。横に並べるほうを少し優先する
export function separate(anchors: Pt[], fixed: Box[], size = PIN + PIN_GAP): Pt[] {
  const p = anchors.map((a) => ({ ...a }))
  for (let k = 0; k < 48; k++) {
    let moved = false
    for (let i = 0; i < p.length; i++) {
      for (let j = i + 1; j < p.length; j++) {
        const dx = p[j].x - p[i].x
        const dy = p[j].y - p[i].y
        const ox = size - Math.abs(dx)
        const oy = size - Math.abs(dy)
        if (ox <= 0.01 || oy <= 0.01) continue
        moved = true
        if (ox <= oy * 1.3) {
          const s = Math.sign(dx) || 1
          p[i].x -= (s * ox) / 2
          p[j].x += (s * ox) / 2
        } else {
          const s = Math.sign(dy) || 1
          p[i].y -= (s * oy) / 2
          p[j].y += (s * oy) / 2
        }
      }
      for (const f of fixed) {
        const dx = p[i].x - f.x
        const dy = p[i].y - f.y
        const ox = (size + f.w) / 2 - Math.abs(dx)
        const oy = (size + f.h) / 2 - Math.abs(dy)
        if (ox <= 0.01 || oy <= 0.01) continue
        moved = true
        if (ox <= oy * 1.3) p[i].x += (Math.sign(dx) || 1) * ox
        else p[i].y += (Math.sign(dy) || 1) * oy
      }
    }
    if (!moved) break
  }
  return p
}

function nameBox(c: Pt, half: number, w: number, h: number, side: Side): Box {
  if (side.length === 2) {
    const dx = half + NAME_GAP / 2 + w / 2
    const dy = half + h / 2 - 2
    return { x: c.x + (side[0] === 'r' ? dx : -dx), y: c.y + (side[1] === 'b' ? dy : -dy), w, h }
  }
  if (side === 'r') return { x: c.x + half + NAME_GAP + w / 2, y: c.y, w, h }
  if (side === 'l') return { x: c.x - half - NAME_GAP - w / 2, y: c.y, w, h }
  if (side === 'b') return { x: c.x, y: c.y + half + NAME_GAP / 2 + h / 2, w, h }
  return { x: c.x, y: c.y - half - NAME_GAP / 2 - h / 2, w, h }
}

// 下から出る画面（場所や候補の画面）と、全画面の地図の下の札（.map-peek）に隠れる、地図の下の端からの高さ。
// 画面が地図の横に出る広い画面では、下から出る画面の分は 0。地図が 120px は見えるようにする。withPeek: 下の札も数えるか
export function sheetCover(mapEl: HTMLElement | null, withPeek = true): number {
  if (!mapEl) return 0
  const m = mapEl.getBoundingClientRect()
  let top = Infinity
  const sheet = document.querySelector<HTMLElement>('.sheet')
  if (sheet) {
    const s = sheet.getBoundingClientRect()
    if (Math.min(m.right, s.right) - Math.max(m.left, s.left) >= m.width / 2) top = window.innerHeight - (parseFloat(getComputedStyle(sheet).bottom) || 0) - sheet.offsetHeight
  }
  const peek = withPeek ? mapEl.parentElement?.querySelector('.map-peek') : null
  if (peek) top = Math.min(top, peek.getBoundingClientRect().top - 8)
  if (top === Infinity) return 0
  return Math.max(0, Math.min(m.height - 120, m.bottom - top))
}

// 地図を場所に合わせて映すときの余白。左下の凡例（たたんであればそのボタン）と、その下の出典の表示に場所が隠れないように、
// 下の余白を凡例の上の端まで広げる（地図の高さの半分まで）。右上の「この付近を検索」があれば、上の余白をその下の端まで広げる
export function fitPad<P extends { top: number; bottom: number; left: number; right: number }>(mapEl: HTMLElement | null, base: P): P {
  if (!mapEl) return base
  const m = mapEl.getBoundingClientRect()
  const legend = mapEl.parentElement?.querySelector('.map-legend')?.getBoundingClientRect()
  const search = mapEl.parentElement?.querySelector('.map-search')?.getBoundingClientRect()
  const bottom = legend?.height ? Math.max(base.bottom, Math.min(m.height * 0.5, m.bottom - legend.top + 12)) : base.bottom
  const top = search?.height ? Math.max(base.top, search.bottom - m.top + 12) : base.top
  return { ...base, top: Math.round(top), bottom: Math.round(bottom) }
}

// 地図の出典の表示（Google マップのロゴ・地図データ・利用規約と、MapLibre の出典）
const CREDITS = '.gm-style-cc, a[href*="maps.google.com/maps"], .maplibregl-ctrl-attrib, .maplibregl-ctrl-logo'

// 地図の要素から、名前や所要時間を置かない所を測る（地図の下の端の帯と、地図に重ねたボタンと凡例と、下から出る画面に隠れる所）。
// 出典の表示とボタンは、実際の要素の大きさで測り、候補の印と点も置かない
export function keepOutOf(mapEl: HTMLElement | null): Box[] {
  if (!mapEl) return []
  const mb = mapEl.getBoundingClientRect()
  const cover = Math.max(26, sheetCover(mapEl))
  const out: Box[] = [{ x: mb.width / 2, y: mb.height - cover / 2, w: mb.width, h: cover }]
  const boxOf = (e: Element, pad: number): Box | null => {
    const r = e.getBoundingClientRect()
    if (!r.width || !r.height) return null
    return { x: r.left - mb.left + r.width / 2, y: r.top - mb.top + r.height / 2, w: r.width + pad * 2, h: r.height + pad * 2, bare: true }
  }
  const over = [...(mapEl.parentElement?.querySelectorAll('.map-tools, .map-search, .map-legend') ?? [])]
  const found = [...over.map((e) => boxOf(e, 4)), ...[...mapEl.querySelectorAll(CREDITS)].map((e) => boxOf(e, 3))]
  out.push(...found.filter((b): b is Box => !!b))
  return out
}

const div = (cls: string, text?: string) => {
  const d = document.createElement('div')
  d.className = cls
  if (text !== undefined) d.textContent = text
  return d
}
const place = (e: HTMLElement | SVGElement, x: number, y: number) => {
  e.style.transform = `translate(${Math.round(x * 2) / 2}px, ${Math.round(y * 2) / 2}px) translate(-50%, -50%)`
}
const SVG = 'http://www.w3.org/2000/svg'
const icon = (name: keyof typeof ICON) => {
  const svg = document.createElementNS(SVG, 'svg')
  svg.setAttribute('viewBox', '0 0 24 24')
  svg.setAttribute('aria-hidden', 'true')
  const path = document.createElementNS(SVG, 'path')
  path.setAttribute('d', ICON[name])
  svg.appendChild(path)
  return svg
}

// 候補の印。下に地図の地の色の太い線を敷いて縁取り、その上に細い線で形を描く
const kindIcon = (kind: SpotKind) => {
  const svg = document.createElementNS(SVG, 'svg')
  svg.setAttribute('viewBox', '0 0 24 24')
  svg.setAttribute('aria-hidden', 'true')
  for (const cls of ['halo', 'line']) {
    const g = document.createElementNS(SVG, 'g')
    g.setAttribute('class', cls)
    for (const d of KIND_ICON[kind]) {
      const path = document.createElementNS(SVG, 'path')
      path.setAttribute('d', d)
      g.appendChild(path)
    }
    svg.appendChild(g)
  }
  return svg
}

type Badge = { e: HTMLElement; coords: LL[]; w: number; lane: number; ride?: boolean }
type StopEl = { id: string; key: string; pin: HTMLElement; name: HTMLElement; ll: LL; w: number; h: number; side: Side | null }
type EndEl = { key: string; mark: HTMLElement; name: HTMLElement; ll: LL; w: number; h: number; side: Side | null }
// 乗る駅・降りる駅。legs: その駅で乗るか降りる区間の番号。coords・end・lane: 印を線と同じだけ横にずらすための、最初の区間の乗る線とその端（0 か 1）と車線
// offs: その駅で降りる区間の番号。text: 今出している名前（降りる所の名前は「〜で降りる」にする）
type StationEl = { key: string; mark: HTMLElement; name: HTMLElement; ll: LL; legs: number[]; offs: number[]; coords: LL[]; end: 0 | 1; lane: number; w: number; h: number; side: Side | null; text: string }

export class MapLayer {
  readonly root: HTMLDivElement
  private lead: SVGSVGElement
  private stops: StopEl[] = []
  // 出発地と到着地の印（到着地の無い旅は出発地だけ）
  private ends: EndEl[] = []
  private legs: { e: HTMLElement; coords: LL[]; idx: number; w: number; lane: number; parts: Badge[] }[] = []
  private cands: { id: string; dot: HTMLElement; name: HTMLElement; ll: LL; w: number; h: number; named: boolean }[] = []
  private stations: StationEl[] = []
  private found: { id: string; dot: HTMLElement; name: HTMLElement; ll: LL; w: number; h: number }[] = []
  private me: HTMLElement | null = null
  private state: LayerState = { focus: -1, leg: -1, candId: null, changed: new Set(), me: null }
  private projector: Projector
  private onStop: (id: string) => void
  private onCand: (id: string) => void
  private onFound: (id: string) => void
  private onLeg: ((idx: number) => void) | null

  // onLeg: 所要時間の札を押した（その区間の便・経路・手段の画面を開く）。無ければ札は押せない
  constructor(projector: Projector, onStop: (id: string) => void, onCand: (id: string) => void, onFound: (id: string) => void = () => {}, onLeg: ((idx: number) => void) | null = null) {
    this.projector = projector
    this.onStop = onStop
    this.onCand = onCand
    this.onFound = onFound
    this.onLeg = onLeg
    this.root = div('mlayer')
    this.lead = document.createElementNS(SVG, 'svg')
    this.lead.setAttribute('class', 'mlayer-lead')
    this.lead.setAttribute('aria-hidden', 'true')
    this.root.appendChild(this.lead)
  }

  setData(d: LayerData) {
    // 前に置いた名前の向きは引き継ぐ（描き直しで名前が跳ねないように）
    const oldStops = new Map(this.stops.map((s) => [s.key, s]))
    const oldEnds = new Map(this.ends.map((e) => [e.key, e]))
    const oldStations = new Map(this.stations.map((s) => [s.key, s]))
    ;[...this.root.children].forEach((c) => c !== this.lead && c.remove())
    this.cands = d.cands.map((c) => {
      const dot = div(c.picked ? 'mcand picked' : 'mcand')
      dot.setAttribute('aria-hidden', 'true')
      dot.setAttribute('aria-label', WORD.cand(c.name))
      dot.title = c.name
      dot.appendChild(kindIcon(c.kind))
      const name = div('mcand-name', shortName(c.name))
      name.setAttribute('aria-hidden', 'true')
      for (const e of [dot, name])
        e.addEventListener('click', (ev) => {
          ev.stopPropagation()
          this.onCand(c.id)
        })
      this.root.append(dot, name)
      return { id: c.id, dot, name, ll: c.ll, w: 0, h: 0, named: !!c.named }
    })
    this.found = (d.found ?? []).map((f) => {
      const dot = div('mfound')
      dot.setAttribute('aria-hidden', 'true')
      dot.title = f.name
      const name = div('mfound-name', shortName(f.name))
      name.setAttribute('aria-hidden', 'true')
      for (const e of [dot, name])
        e.addEventListener('click', (ev) => {
          ev.stopPropagation()
          this.onFound(f.id)
        })
      this.root.append(dot, name)
      return { id: f.id, dot, name, ll: f.ll, w: 0, h: 0 }
    })
    // 乗る駅・降りる駅（同じ駅は 1 つにまとめてある）
    const lanes = new Map(d.legs.map((l) => [l.idx, l.lane ?? 0]))
    this.stations = boardStops(d.legs).map((b) => {
      const mark = div('mstn')
      mark.setAttribute('aria-hidden', 'true')
      mark.style.borderColor = b.color ?? 'var(--route)'
      const name = div('mstn-name', shortName(b.name))
      name.setAttribute('aria-hidden', 'true')
      const key = shortName(b.name)
      const old = oldStations.get(key)
      return { key, mark, name, ll: b.ll, legs: b.legs, offs: b.offs, coords: b.coords, end: b.end, lane: lanes.get(b.idx) ?? 0, w: 0, h: 0, side: old?.side ?? null, text: key }
    })
    this.root.append(...this.stations.map((s) => s.mark))
    this.legs = d.legs.map((l) => {
      const e = div('leg-badge')
      e.setAttribute('aria-label', `${l.mode === 'walk' ? WORD.walk : WORD.transit} ${durText(l.minutes)}`)
      const t = document.createElement('span')
      t.textContent = durText(l.minutes)
      e.append(icon(l.mode), t)
      this.root.appendChild(e)
      const tap = (el: HTMLElement) => {
        const go = this.onLeg
        if (!go) return
        el.classList.add('tap')
        el.addEventListener('click', (ev) => {
          ev.stopPropagation()
          go(l.idx)
        })
      }
      tap(e)
      // 乗る所を先に置く（歩く所の札は、空きが無ければ出さない）
      const pieces = (l.pieces?.length ?? 0) > 1 ? l.pieces!.filter((p) => p.minutes > 0) : []
      pieces.sort((a, b) => (a.kind === b.kind ? 0 : a.kind === 'ride' ? -1 : 1))
      const parts = pieces.map((p) => {
        const pe = partBadge(p)
        pe.style.display = 'none'
        tap(pe)
        this.root.appendChild(pe)
        return { e: pe, coords: p.coords, w: 0, lane: l.lane ?? 0, ride: p.kind === 'ride' }
      })
      return { e, coords: l.coords, idx: l.idx, w: 0, lane: l.lane ?? 0, parts }
    })
    this.ends = [d.start, d.end ?? null].flatMap((e) => {
      if (!e) return []
      const mark = div('mstart')
      mark.setAttribute('aria-hidden', 'true')
      const name = div('mstart-name', e.name)
      this.root.append(name, mark)
      const old = oldEnds.get(e.name)
      return [{ key: e.name, mark, name, ll: e.ll, w: 0, h: 0, side: old?.side ?? null }]
    })
    const names: HTMLElement[] = []
    const pins: HTMLElement[] = []
    this.stops = d.stops.map((s, i) => {
      const pin = div('pin mstop')
      const num = document.createElement('span')
      num.textContent = String(i + 1)
      pin.appendChild(num)
      pin.setAttribute('aria-hidden', 'true')
      pin.setAttribute('aria-label', `${i + 1}. ${s.name}`)
      pin.title = s.name
      const name = div('mstop-name', shortName(s.name))
      name.setAttribute('aria-hidden', 'true')
      for (const e of [pin, name])
        e.addEventListener('click', (ev) => {
          ev.stopPropagation()
          this.onStop(s.id)
        })
      names.push(name)
      pins.push(pin)
      const key = s.id + shortName(s.name)
      const old = oldStops.get(key)
      return { id: s.id, key, pin, name, ll: s.ll, w: 0, h: 0, side: old?.side ?? null }
    })
    // 重なる順: 候補 < 引き出し線 < 駅の印 < 所要時間 < 駅の名前 < 名前 < 出発地 < 番号（後ろの番号ほど下）
    this.root.append(...this.stations.map((s) => s.name), ...names, ...pins.reverse())
    if (this.me) this.root.appendChild(this.me)
    this.applyState()
    this.draw()
  }

  setState(s: Partial<LayerState>) {
    this.state = { ...this.state, ...s }
    if (s.me !== undefined) {
      if (s.me && !this.me) {
        this.me = div('me-dot mme')
        this.me.setAttribute('aria-label', WORD.me)
        this.root.appendChild(this.me)
      }
    }
    this.applyState()
    this.draw()
  }

  private applyState() {
    const { changed, candId } = this.state
    const { on, stopLit: near } = litOf(this.state.focus, this.state.leg)
    this.stops.forEach((s, i) => {
      s.pin.classList.toggle('on', i === on)
      s.pin.classList.toggle('changed', changed.has(s.id))
      s.pin.classList.toggle('far', !near(i))
      s.name.classList.toggle('far', !near(i))
      s.name.classList.toggle('on', i === on)
      s.pin.classList.toggle('hover', s.id === this.state.hover)
      s.name.classList.toggle('hover', s.id === this.state.hover)
    })
    this.cands.forEach((c) => {
      c.dot.classList.toggle('on', c.id === candId)
      c.name.classList.toggle('on', c.id === candId)
    })
    this.found.forEach((f) => {
      f.dot.classList.toggle('on', f.id === this.state.foundId)
      f.name.classList.toggle('on', f.id === this.state.foundId)
    })
    // 区間だけを見ているときは、その区間の所要時間の札を浅葱の塗りにする（場所を選んだときの前後の区間は白い札のまま）
    this.legs.forEach((l) => {
      const on = l.idx === this.state.leg
      l.e.classList.toggle('on', on)
      l.parts.forEach((p) => p.e.classList.toggle('on', on))
    })
  }

  // 置き直す（地図が動くたび・中身が変わるたびに呼ぶ）
  draw() {
    const pr = this.projector()
    if (!pr || !this.root.isConnected) return
    const { project, view } = pr
    const lit = litOf(this.state.focus, this.state.leg)
    const taken: Box[] = []
    const lead: string[] = []
    const guard: Box[] = (view.keepOut ?? []).map((b) => ({ ...b, x: b.x + view.x, y: b.y + view.y }))

    // 名前の幅は、出しておいた状態で 1 度だけ測る
    const measure = (e: HTMLElement) => {
      e.style.visibility = 'hidden'
      e.style.display = ''
      return Math.ceil(e.getBoundingClientRect().width)
    }

    // 出発地と到着地
    const endBoxes = this.ends.map((st): Box | null => {
      const p = project(st.ll)
      if (!p) {
        st.mark.style.display = 'none'
        return null
      }
      place(st.mark, p.x, p.y)
      st.mark.style.display = ''
      return { x: p.x, y: p.y, w: START + 4, h: START + 4, pin: true }
    })
    const startBoxes = endBoxes.filter((b): b is Box => !!b)

    // 番号の札
    const anchors = this.stops.map((s) => project(s.ll))
    const okIdx = anchors.map((a, i) => (a ? i : -1)).filter((i) => i >= 0)
    const moved = separate(
      okIdx.map((i) => anchors[i]!),
      startBoxes,
    )
    const at = new Map<number, Pt>()
    const pinBox = new Map<number, Box>()
    okIdx.forEach((i, k) => at.set(i, moved[k]))
    this.stops.forEach((s, i) => {
      const p = at.get(i)
      const a = anchors[i]
      if (!p || !a) {
        s.pin.style.display = 'none'
        s.name.style.display = 'none'
        return
      }
      s.pin.style.display = ''
      place(s.pin, p.x, p.y)
      const own = { x: p.x, y: p.y, w: PIN + 2, h: PIN + 2, far: s.pin.classList.contains('far'), pin: true }
      pinBox.set(i, own)
      taken.push(own)
      if (Math.hypot(p.x - a.x, p.y - a.y) > 4) {
        const cls = s.pin.classList.contains('far') ? ' class="far"' : ''
        lead.push(`<line${cls} x1="${a.x}" y1="${a.y}" x2="${p.x}" y2="${p.y}"/><circle${cls} cx="${a.x}" cy="${a.y}" r="3.5"/>`)
      }
    })
    taken.push(...startBoxes)
    taken.push(...guard)

    // 名前: 出発地 → 選んだ場所とその前後 → 所要時間の札 → ほかの名前の順に、空いている所へ置く
    // overFar: どこにも空きが無ければ、灰色の札（選んだ場所の前後でない札）と重なる面積がいちばん小さい所に置く
    const putName = (e: HTMLElement, c: Pt, half: number, w: number, h: number, prev: Side | null, overFar = false, own: Box | null = null, sides = SIDES): Side | null => {
      const tries = prev && sides.includes(prev) ? [prev, ...sides.filter((x) => x !== prev)] : sides
      const put = (b: Box, side: Side) => {
        taken.push(b)
        e.style.textAlign = side[0] === 'r' ? 'left' : side[0] === 'l' ? 'right' : 'center'
        place(e, b.x, b.y)
        e.style.visibility = ''
        e.style.display = ''
        return side
      }
      let best: { b: Box; side: Side; cost: number } | null = null
      for (const side of tries) {
        const b = nameBox(c, half, w, h, side)
        if (!inside(b, view)) continue
        if (!taken.some((t) => hitName(t, b, own))) return put(b, side)
        if (!overFar || taken.some((t) => !t.far && hitName(t, b, own))) continue
        const cost = taken.filter((t) => t.far).reduce((a, t) => a + overlap({ ...t, w: t.w + NAME_AWAY * 2, h: t.h + NAME_AWAY * 2 }, b), 0)
        if (!best || cost < best.cost) best = { b, side, cost }
      }
      if (best) return put(best.b, best.side)
      e.style.display = 'none'
      return null
    }
    const stopName = (i: number, overFar = false) => {
      const s = this.stops[i]
      const p = at.get(i)
      if (!p) return
      if (!s.w) [s.w, s.h] = sizeName(s.name)
      s.side = putName(s.name, p, PIN / 2, s.w, s.h, s.side, overFar, pinBox.get(i) ?? null)
    }
    // 乗る駅・降りる駅の印: 出典の表示とボタンと下の画面の所に掛からなければいつも置く。名前と所要時間の札より先に置き、名前と札に印を避けさせる。
    // 濃く描く区間で降りる駅は、印を少し大きくする
    const offLeg = this.state.leg >= 0 ? this.state.leg : this.state.focus
    const stnAt = new Map<StationEl, Box>()
    const stnMark = (s: StationEl) => {
      let p = project(s.ll)
      const px = s.lane * laneGap(view.zoom)
      if (p && px) {
        const a = project(along(s.coords, s.end))
        const b = shifted(project, s.coords, s.end, px)
        if (a && b) p = { x: p.x + b.x - a.x, y: p.y + b.y - a.y }
      }
      const dim = lit.any && !s.legs.some(lit.legLit)
      const off = s.offs.some(lit.legLit)
      const size = off ? STN_OFF : STN
      const box = p ? { x: p.x, y: p.y, w: size + 2, h: size + 2 } : null
      if (!box || !inside(box, view) || guard.some((g) => hit(g, box))) {
        s.mark.style.display = 'none'
        s.name.style.display = 'none'
        return
      }
      s.mark.classList.toggle('far', dim)
      s.mark.classList.toggle('off', off)
      // 選んだ場所へ向かう区間（区間だけを見ているときはその区間）で降りる駅は、名前を「〜で降りる」にする
      const text = offLeg >= 0 && s.offs.includes(offLeg) ? WORD.off(s.key) : s.key
      if (text !== s.text) {
        s.text = text
        s.name.textContent = text
        s.w = 0
      }
      place(s.mark, box.x, box.y)
      s.mark.style.display = ''
      const own = { ...box, far: dim }
      stnAt.set(s, own)
      taken.push(own)
    }
    this.stations.forEach(stnMark)

    this.ends.forEach((st, i) => {
      const b = endBoxes[i]
      if (!b) {
        st.name.style.display = 'none'
        return
      }
      if (!st.w) [st.w, st.h] = sizeName(st.name)
      st.side = putName(st.name, b, START / 2, st.w, st.h, st.side, false, b)
    })

    // 開いている候補: 大きな印と名前を、札の名前より先に置く（どこにも空きが無ければ下に置き、ほかの名前のほうを隠す）
    // 出典の表示とボタンに重なる候補は、印も点も描かない（寄せれば出る）
    const bare = guard.filter((b) => b.bare)
    const offLimits = (p: Pt, size: number) => bare.some((t) => hit(t, { x: p.x, y: p.y, w: size, h: size }))
    const open = this.cands.find((c) => c.id === this.state.candId)
    const openPt = open ? project(open.ll) : null
    const openAt = openPt && !offLimits(openPt, CAND_ON) ? openPt : null
    if (open && openAt) {
      taken.push({ x: openAt.x, y: openAt.y, w: CAND_ON + 2, h: CAND_ON + 2 })
      if (!open.w) [open.w, open.h] = sizeName(open.name)
      const sides: Side[] = ['b', 't', 'r', 'l']
      const boxes = sides.map((side) => nameBox(openAt, CAND_ON / 2, open.w, open.h, side))
      const b = boxes.find((x) => inside(x, view) && !taken.some((t) => hitName(t, x, null))) ?? boxes[0]
      taken.push(b)
      place(open.name, b.x, b.y)
      open.name.style.visibility = ''
      open.name.style.display = ''
    }

    const near = (i: number) => lit.any && lit.stopLit(i)
    const first = this.stops.map((_, i) => i).filter(near)
    if (lit.on >= 0) first.sort((a, b) => Math.abs(a - lit.on) - Math.abs(b - lit.on) || a - b)
    // 選んだ場所の名前は下の画面の見出しにも出るので、空きが無ければ出さない。前後の名前（区間だけを見ているときは両端の名前）は灰色の札に重ねてでも出す
    first.forEach((i) => stopName(i, i !== lit.on))

    const stnName = (s: StationEl, must: boolean) => {
      const b = stnAt.get(s)
      if (!b || b.far) {
        s.name.style.display = 'none'
        return
      }
      if (!s.w) [s.w, s.h] = sizeName(s.name)
      s.side = putName(s.name, b, b.w / 2 - 1, s.w, s.h, s.side, must, b, must ? SIDES_ALL : SIDES)
    }
    // 区間だけを見ているときは、その区間の 2 つの名前を、場所を選んだときは、その場所へ向かう区間で降りる駅の名前を、
    // 所要時間の札とほかの場所の名前より先に、斜めの向きも試して置く（灰色の札には重ねてよい）
    const legOn = this.state.leg
    const mine = this.stations.filter((s) => (legOn >= 0 && s.legs.includes(legOn)) || (offLeg >= 0 && s.offs.includes(offLeg)))
    mine.forEach((s) => stnName(s, true))

    // 所要時間: 選んだ場所の前後の区間（区間だけを見ているときはその区間）だけ。線の真ん中が埋まっていれば、線に沿って前か後ろへずらす。
    // 灰色の札（選んだ場所の前後でない札）の上には重ねてよい。便か乗換を入れた区間は、歩く所・乗る所ごとの札にする
    const putBadge = (b: Badge, h: number): boolean => {
      if (!b.w) b.w = measure(b.e)
      // 線の上のどこにも置けない短い区間は、線の真ん中のすぐ横に置く
      const px = b.lane * laneGap(view.zoom)
      const on = (t: number) => shifted(project, b.coords, t, px)
      const mid = on(0.5)
      const spots: Pt[] = TRY_ALONG.map(on).filter((p): p is Pt => !!p)
      if (mid) {
        const dx = b.w / 2 + 8
        const dy = h - 2
        spots.push(
          { x: mid.x + dx, y: mid.y },
          { x: mid.x - dx, y: mid.y },
          { x: mid.x, y: mid.y - dy },
          { x: mid.x, y: mid.y + dy },
          { x: mid.x + dx, y: mid.y - dy },
          { x: mid.x - dx, y: mid.y - dy },
          { x: mid.x + dx, y: mid.y + dy },
          { x: mid.x - dx, y: mid.y + dy },
        )
      }
      const p = spots.find((q) => {
        const box = { x: q.x, y: q.y, w: b.w + 4, h }
        return inside(box, view) && !taken.some((x) => !x.far && hit(x, box))
      })
      if (!p) {
        b.e.style.display = 'none'
        return false
      }
      taken.push({ x: p.x, y: p.y, w: b.w + 4, h })
      place(b.e, p.x, p.y)
      b.e.style.visibility = ''
      b.e.style.display = ''
      return true
    }
    for (const l of this.legs) {
      const show = lit.any && lit.legLit(l.idx)
      if (!show) {
        l.e.style.display = 'none'
        l.parts.forEach((p) => (p.e.style.display = 'none'))
        continue
      }
      // 乗る所の札を全部置けたときだけ、手段ごとの札にする。置けなかったら区間全体の札に戻す
      const mark = taken.length
      const put = l.parts.map((p) => putBadge(p, 22))
      if (put.some(Boolean) && l.parts.every((p, k) => put[k] || !p.ride)) {
        l.e.style.display = 'none'
        continue
      }
      taken.length = mark
      l.parts.forEach((p) => (p.e.style.display = 'none'))
      putBadge(l, 24)
    }

    this.stops.forEach((_, i) => {
      if (!near(i)) stopName(i)
    })

    // ほかの駅の名前: 濃く描く区間の駅だけを、空いている所に、候補より先に置く
    this.stations.filter((s) => !mine.includes(s)).forEach((s) => stnName(s, false))

    // この付近で検索の結果: 候補より先に置く（探した物なので、候補の印の方が点になる）。開いている結果を先に、名前は空いている所に
    const foundOrder = [...this.found].sort((a, b) => Number(b.id === this.state.foundId) - Number(a.id === this.state.foundId))
    for (const f of foundOrder) {
      const p = project(f.ll)
      const on = f.id === this.state.foundId
      const size = on ? FOUND_ON : FOUND
      if (!p || offLimits(p, size)) {
        f.dot.style.display = 'none'
        f.name.style.display = 'none'
        continue
      }
      f.dot.style.display = ''
      place(f.dot, p.x, p.y)
      const b = { x: p.x, y: p.y, w: size + 2, h: size + 2 }
      taken.push(b)
      if (!f.w) [f.w, f.h] = sizeName(f.name)
      const nb = nameBox(p, size / 2, f.w, f.h, 'r')
      if (!inside(nb, view) || (!on && taken.some((t) => t !== b && hit(t, nb))) || guard.some((t) => hit(t, nb))) {
        f.name.style.display = 'none'
        continue
      }
      taken.push(nb)
      place(f.name, nb.x, nb.y)
      f.name.style.visibility = ''
      f.name.style.display = ''
    }

    // 候補: 印はいつも。番号の札・名前・所要時間の札か、先に置いた印と重なる印は、小さな点にする（行きたい場所に選んである印を先に置く）。
    // 名前は拡大したときだけ、印を全部置いたあとで空いている所に（開いている候補の名前は上で置いた）
    const showNames = view.zoom >= NEAR_ZOOM
    const marks = taken.filter((t) => !guard.includes(t))
    const order = [...this.cands].sort((a, b) => Number(b.dot.classList.contains('picked')) - Number(a.dot.classList.contains('picked')))
    const own = new Map<(typeof this.cands)[number], { p: Pt; b: Box }>()
    for (const c of order) {
      const p = project(c.ll)
      if (!p) {
        c.dot.style.display = 'none'
        c.name.style.display = 'none'
        continue
      }
      const size = c.dot.classList.contains('picked') ? CAND_PICKED : CAND
      if (offLimits(p, c === open ? CAND_ON : size)) {
        c.dot.style.display = 'none'
        c.name.style.display = 'none'
        continue
      }
      c.dot.style.display = ''
      place(c.dot, p.x, p.y)
      if (c === open && openAt) {
        c.dot.classList.remove('dot')
        continue
      }
      const b = { x: p.x, y: p.y, w: size + 2, h: size + 2 }
      const crowded = marks.some((t) => hit(t, b))
      c.dot.classList.toggle('dot', crowded)
      if (crowded) continue
      marks.push(b)
      taken.push(b)
      own.set(c, { p, b })
    }
    // 名前を出す候補（named）を先に置く
    const nameOrder = [...this.cands].sort((a, b) => Number(b.named) - Number(a.named))
    for (const c of nameOrder) {
      if (c === open && openAt) continue
      const at = own.get(c)
      if (!at || !(showNames || c.named)) {
        c.name.style.display = 'none'
        continue
      }
      const { p } = at
      if (!c.w) [c.w, c.h] = sizeName(c.name)
      const b = nameBox(p, CAND / 2, c.w, c.h, 'b')
      if (!inside(b, view) || taken.some((t) => hitName(t, b, at.b))) {
        c.name.style.display = 'none'
        continue
      }
      taken.push(b)
      place(c.name, b.x, b.y)
      c.name.style.visibility = ''
      c.name.style.display = ''
    }

    // 現在地
    if (this.me && this.state.me) {
      const p = project(this.state.me)
      if (p) place(this.me, p.x, p.y)
    }

    this.lead.innerHTML = lead.join('')
  }

  destroy() {
    this.root.remove()
  }
}
