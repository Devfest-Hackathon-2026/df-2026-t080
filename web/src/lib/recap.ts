// 旅の振り返りの画像（幅 1080・高さ 1920 の縦長）を、Canvas に直接描いて作る。
// - その日の流れ（出発・場所・移動・到着）を、スケジュールと同じ路線図の形（時刻・浅葱の線・番号の札）で全部載せる。
// - 選んだ理由を残した場所と、ミッションの写真を撮った場所は、札を塗って段を広げ、写真と「選んだ理由」「AI の注意点」を並べる。
// - 上には、プランの題と、混雑と推定される時間の滞在を、よくある回り方と比べた 1 行（Compare と同じ値と言い方）を置く。
// - 場所の数と広げる場所の数に合わせて、形（大きな写真・横の写真・文だけ・1 行）と字の大きさを選び、余った高さは写真と線に回す。
// - 写真は、使う人が撮ったミッションの写真か、作者とライセンスの分かる Wikimedia の写真だけを描く（Google の写真は描かない）。
//   Wikimedia の写真の作者とライセンスは、画像の下に書く。ミッションの写真と理由は端末の中だけで扱い、サーバーには送らない。
// - 検索で入れた場所の名前は Google の Places の内容なので、画像には「検索で入れた場所」と書く。
// 図形の出所: 線・円・角の丸い四角と文字は、置き方を AI が生成（Claude）。乗り物のアイコンは lib/modeShape.ts（Lucide）、
// 混雑のペンギンは lib/penguinShape.ts。字は Figtree（SIL Open Font License 1.1）と端末の和文の字
import type { Plan, UsualPlan } from './planner'
import type { OdaiItem } from './odai'
import type { Why } from './why'
import type { Leg } from './geo'
import type { BusTrip } from '../types'
import type { Mode } from './modeShape'
import { FOUND_NAME, isFound, roleText } from './found'
import { licenseLabel, thumbUrl, wikiPhoto } from './photo'
import { LEVEL_LABEL } from './crowd'
import { BEAK, BELLY, BODY, EYE, FEET, FEET_W, FLIPPER, FLIPPER_W, GAP as FLOCK_GAP, H as FLOCK_H, LAYOUT, LEFT, RIGHT } from './penguinShape'
import { fmt, fmtDur } from './time'
import { isEn, tr } from './i18n'
import { CARD_H, CARD_W as W, FONT, INK, INK2, ROUTE, drawModeIcon, fit, loadFonts, newCard, rrect, toPng, wrap } from './cardImage'

// ---- 振り返りの画面の一覧（理由かミッションのある場所） ----

export type RecapRow = {
  spotId: string
  no: number // プランの中の順（地図・スケジュールの番号）
  name: string
  arrive: number
  chips: string[]
  text: string
  downside: string
  hit?: Why['hit']
  odai?: string
  photo?: string
}

// プランの場所ごとに、理由・ミッション・写真を集める。どれも無い場所は載せない（理由が無くてもミッションか写真があれば載せる）
export function buildRows(plan: Plan, whys: Why[], odai: OdaiItem[]): RecapRow[] {
  const w = new Map(whys.map((x) => [x.spotId, x]))
  const rows: RecapRow[] = []
  for (const [i, s] of plan.stops.entries()) {
    const why = w.get(s.spot.id)
    const items = odai.filter((o) => o.spotId === s.spot.id)
    const item = items.find((o) => o.photo) ?? items[0]
    if (!why && !item) continue
    rows.push({
      spotId: s.spot.id,
      no: i + 1,
      name: s.spot.name,
      arrive: s.arrive,
      chips: why?.chips ?? [],
      text: why?.text ?? '',
      downside: why?.downsideSeen || s.spot.downside,
      hit: why?.hit,
      odai: item?.text,
      photo: item?.photo,
    })
  }
  return rows
}

export const pad = (n: number) => String(n)
export const RECAP_WORDS = tr({
  ja: {
    sep: '・',
    none: '理由なし',
    hit: { yes: 'イメージと合っていた', no: 'イメージと違った' } as Record<NonNullable<Why['hit']>, string>,
    title: '旅の振り返り',
    when: (area: string, date: string) => `${area}　${date}`,
    reason: '選んだ理由',
    ai: 'AI の注意点',
    odai: (t: string) => `ミッション：${t}`,
    tagline: 'AI が提案し、人が理由を持って決める旅',
    crowd: '混雑と推定される時間の滞在',
    usual: 'よくある回り方',
    plan: 'このプラン',
    never: 'このプランは、混雑と推定される時間に一度も当たりません',
    depart: '出発',
    arrive: '到着',
    walk: '徒歩',
    bus: 'バス',
    train: '電車',
    transit: '電車・バス',
    mins: (m: number) => `${m}分`,
    credit: (author: string, license: string) => `${author}・${license}`,
    photos: '写真 Wikimedia Commons（トリミングあり）：',
    listSep: '、',
  },
  en: {
    sep: ' · ',
    none: 'No reason',
    hit: { yes: 'As I pictured it', no: 'Not as I pictured it' },
    title: 'Trip Recap',
    when: (area: string, date: string) => `${area} · ${date}`,
    reason: 'Why I Chose It',
    ai: 'AI’s Heads-Up',
    odai: (t: string) => `Mission: ${t}`,
    tagline: 'AI suggests. You decide, with your own reasons.',
    crowd: 'Time at places during estimated crowded hours',
    usual: 'Usual route',
    plan: 'This plan',
    never: 'This plan never hits an estimated crowded hour',
    depart: 'Depart',
    arrive: 'Arrive',
    walk: 'Walk',
    bus: 'Bus',
    train: 'Train',
    transit: 'Transit',
    mins: (m: number) => `${m} min`,
    credit: (author: string, license: string) => `${author}, ${license}`,
    photos: 'Photos from Wikimedia Commons (cropped): ',
    listSep: '; ',
  },
})
const R = RECAP_WORDS
export const rowSummary = (r: RecapRow) => [...r.chips, r.text].filter(Boolean).join(R.sep) || R.none
export const HIT_LABEL = R.hit

// ---- 画像に載せる中身 ----

export type Move = { icon: Mode; word: string; min: number }
export type RecapStop = {
  no: number
  spotId: string
  name: string
  arrive: number
  meta: string // 役割・滞在
  level: number | null // 着く時刻の混雑（推定のある時間帯だけ）
  move: Move // 前の場所（最初は出発地）からの移動
  reason: string // 選んだ理由（定型の理由と一言。無ければ空）
  downside: string // 選んだときに見ていた AI の注意点（理由があるときだけ）
  hit?: 'yes' | 'no'
  odai?: string // ミッションの文（写真を撮ったものだけ）
  shot?: string // ミッションの写真（data URL）
  wiki?: { url: string; credit: string } // 作者とライセンスの分かる Wikimedia の写真
}
// 混雑の 1 行: よくある回り方と、このプランの、混雑と推定される時間の滞在（分）。どちらも当たらなければ 'never'。出さないときは null
export type RecapCrowd = { usual: number; plan: number } | 'never' | null
export type RecapInput = {
  area: string
  date: string // 日付の表示
  title: string[] // プランの題（折り返してよい所で分けた物。無ければ空）
  start: string
  goal: string
  leave: number
  finish: number
  stops: RecapStop[]
  back: Move
  crowd: RecapCrowd
}

// 理由・当たったか・ミッションの写真のどれかがある場所は、段を広げて大きく出す
export const isFeatured = (s: RecapStop) => !!s.reason || !!s.hit || !!s.shot

const AUTHOR_MAX = 48

// 区間の手段（入れた経路か、見つけた便があれば、その乗り物。路線名は出さない）
function moveOf(leg: Leg, found: BusTrip | undefined): Move {
  const min = Math.round(leg.minutes)
  const bus: Move = { icon: 'bus', word: R.bus, min }
  const train: Move = { icon: 'train', word: R.train, min }
  if (leg.mode === 'walk') return { icon: 'walk', word: R.walk, min }
  const trip = leg.real ? leg.real.bus : found
  if (trip) return trip.mode === 'train' ? train : bus
  const rides = (leg.real?.steps ?? []).filter((s) => s.mode === 'train' || s.mode === 'bus')
  if (rides.length && rides.every((s) => s.mode === rides[0].mode)) return rides[0].mode === 'train' ? train : bus
  if (leg.rail) return train
  return { icon: 'train', word: R.transit, min }
}

// Compare と同じ決め方: よくある回り方より 10 分以上短いときだけ出す（どちらも当たらなければ、そう言う）
export function crowdLine(plan: Plan, usual: UsualPlan | null): RecapCrowd {
  if (!usual) return null
  if (Math.round(plan.crowded) === 0 && Math.round(usual.crowded) === 0) return 'never'
  return usual.crowded - plan.crowded >= 10 ? { usual: usual.crowded, plan: plan.crowded } : null
}

// buses: 区間ごとの見つけた便（スケジュールの区間の行と同じ物）
export function recapInput(o: { area: string; date: string; title: string[]; start: string; goal: string; plan: Plan; usual: UsualPlan | null; buses: (BusTrip | undefined)[]; whys: Why[]; odai: OdaiItem[] }): RecapInput {
  const w = new Map(o.whys.map((x) => [x.spotId, x]))
  const stops = o.plan.stops.map((s, i): RecapStop => {
    const why = w.get(s.spot.id)
    const shot = o.odai.find((x) => x.spotId === s.spot.id && x.photo)
    const found = isFound(s.spot)
    const wp = found ? null : wikiPhoto(s.spot)
    const reason = why ? [...why.chips, why.text.trim()].filter(Boolean).join(R.sep) : ''
    let credit = ''
    if (wp) {
      const a = (wp.author ?? '').replace(/\s+/g, ' ').trim()
      const author = a.length > AUTHOR_MAX ? `${a.slice(0, AUTHOR_MAX - 1).trimEnd()}…` : a
      credit = author ? R.credit(author, licenseLabel(wp.license)) : licenseLabel(wp.license)
    }
    return {
      no: i + 1,
      spotId: s.spot.id,
      name: found ? FOUND_NAME : s.spot.name,
      arrive: s.arrive,
      meta: [roleText(s), fmtDur(s.stay)].join(R.sep),
      level: s.estimated ? s.level : null,
      move: moveOf(s.leg, o.buses[i]),
      reason,
      downside: reason ? (why?.downsideSeen || s.spot.downside || '').trim() : '',
      hit: why?.hit,
      odai: shot?.text,
      shot: shot?.photo,
      wiki: wp ? { url: wp.url, credit } : undefined,
    }
  })
  return { area: o.area, date: o.date, title: o.title, start: o.start, goal: o.goal, leave: o.plan.leave, finish: o.plan.finish, stops, back: moveOf(o.plan.back, o.buses[o.plan.stops.length]), crowd: crowdLine(o.plan, o.usual) }
}

// 描き直すかどうかを見分ける印（写真は長さだけで見分ける）
export const recapKey = (r: RecapInput) =>
  JSON.stringify({ ...r, stops: r.stops.map((s) => ({ ...s, shot: s.shot ? s.shot.length : 0 })) })

// ---- 描く部品 ----

type Ctx = CanvasRenderingContext2D
const SANS = `Figtree, ${FONT}`
const font = (weight: number, px: number) => `${weight} ${px}px ${SANS}`
const CARD = '#ffffff'
const PANEL = '#f1f4f7'
const RULE = '#d9e0e6'
const SOFT = '#e1f0f1'
const MISS = '#c4421b'
const FLOCK_FILL = ['#2f6fd6', '#2f6fd6', '#e8a800', '#e8711f', '#d93025']
const FLOCK_WORD = [INK2, INK2, '#976500', '#b45411', '#b3261e']
const X0 = 48
const CW = W - X0 * 2
const IN = 28 // スケジュールの札の左右の内側の空き
const LH_NAME = 1.22
const LH_BODY = 1.45
const PHOTO_WAIT = 8000

// 行の箱（上の端 top・行の高さの倍率 lh・字の大きさ size）の、字の並ぶ線（和文と数字の真ん中がそろう位置）
const base = (top: number, size: number, lh: number) => top + size * ((lh - 1) / 2 + 0.88)

// 混雑のペンギンの群れ（画面の印と同じ形・並べ方・色）を、高さ h の小さな Canvas に描く
function flock(level: number, h: number): HTMLCanvasElement {
  const birds = LAYOUT[level] ?? LAYOUT[0]
  const x0 = Math.min(...birds.map(([x, , s]) => x + s * LEFT))
  const w = Math.max(...birds.map(([x, , s]) => x + s * RIGHT)) - x0
  const k = h / FLOCK_H
  const p = 2
  const cv = document.createElement('canvas')
  cv.width = Math.ceil(w * k) + p * 2
  cv.height = Math.ceil(h) + p * 2
  const o = cv.getContext('2d')!
  o.translate(p, p)
  o.scale(k, k)
  o.translate(-x0, 0)
  const body = new Path2D(BODY)
  const belly = new Path2D(BELLY)
  const flip = new Path2D(FLIPPER)
  const beak = new Path2D(BEAK)
  const feet = new Path2D(FEET)
  const fill = FLOCK_FILL[level] ?? FLOCK_FILL[0]
  const bill = level === 2 ? '#c25a12' : '#e8a317'
  birds.forEach(([x, y, s], i) => {
    o.save()
    o.translate(x, y)
    o.scale(s, s)
    o.lineJoin = 'round'
    o.lineCap = 'round'
    o.fillStyle = '#000'
    o.strokeStyle = '#000'
    if (i > 0) {
      o.globalCompositeOperation = 'destination-out'
      o.fill(body)
      o.lineWidth = FLOCK_GAP / s
      o.stroke(body)
    }
    o.globalCompositeOperation = 'source-over'
    o.fillStyle = fill
    o.fill(body)
    o.globalCompositeOperation = 'destination-out'
    o.fillStyle = '#000'
    o.fill(belly)
    o.beginPath()
    o.arc(EYE.x, EYE.y, EYE.r, 0, Math.PI * 2)
    o.fill()
    o.lineWidth = FLIPPER_W
    o.stroke(flip)
    o.globalCompositeOperation = 'source-over'
    o.fillStyle = bill
    o.fill(beak)
    o.strokeStyle = bill
    o.lineWidth = FEET_W
    o.stroke(feet)
    o.restore()
  })
  return cv
}
const flockWidth = (level: number, h: number) => {
  const birds = LAYOUT[level] ?? LAYOUT[0]
  const x0 = Math.min(...birds.map(([x, , s]) => x + s * LEFT))
  return ((Math.max(...birds.map(([x, , s]) => x + s * RIGHT)) - x0) * h) / FLOCK_H
}

// 画像を、枠いっぱいに（はみ出す分は切る）描く
function cover(c: Ctx, img: HTMLImageElement, x: number, y: number, w: number, h: number, r: number) {
  const k = Math.max(w / img.naturalWidth, h / img.naturalHeight)
  const sw = w / k
  const sh = h / k
  c.save()
  rrect(c, x, y, w, h, r)
  c.clip()
  c.drawImage(img, (img.naturalWidth - sw) / 2, (img.naturalHeight - sh) / 2, sw, sh, x, y, w, h)
  c.restore()
}

function loadImage(src: string, cors: boolean): Promise<HTMLImageElement | null> {
  const img = new Image()
  if (cors) img.crossOrigin = 'anonymous'
  img.decoding = 'async'
  img.src = src
  const wait = new Promise<null>((resolve) => window.setTimeout(() => resolve(null), PHOTO_WAIT))
  return Promise.race([img.decode().then(() => img, () => null), wait])
}

type Pic = { img: HTMLImageElement; wiki: boolean }

// 場所ごとの写真を読む（ミッションの写真を先に。無ければ Wikimedia の写真。余った高さで幅いっぱいに広げることがあるので、どの場所も大きい版を読み、無ければ元の大きさ）。読めなかった写真は描かない
async function loadPhotos(stops: RecapStop[], wiki: boolean): Promise<Map<number, Pic>> {
  const got = await Promise.all(
    stops.map(async (s): Promise<[number, Pic | null]> => {
      if (s.shot) {
        const img = await loadImage(s.shot, false)
        if (img) return [s.no, { img, wiki: false }]
      }
      if (!wiki || !s.wiki) return [s.no, null]
      const big = thumbUrl(s.wiki.url, 960)
      const img = (await loadImage(big, true)) ?? (big !== s.wiki.url ? await loadImage(s.wiki.url, true) : null)
      return [s.no, img ? { img, wiki: true } : null]
    }),
  )
  return new Map(got.filter((g): g is [number, Pic] => !!g[1]))
}

// ---- 組み方 ----

// 字と札の大きさ（z は倍率。1 が基本）
function sizes(z: number) {
  return {
    z,
    time: 40 * z,
    name: 36 * z,
    endTime: 32 * z,
    endName: 29 * z,
    endWord: 24 * z,
    meta: 24 * z,
    leg: 23 * z,
    icon: 24 * z,
    body: 29 * z,
    label: 22 * z,
    note: 25 * z,
    hit: 24 * z,
    cap: 23 * z,
    badge: 50 * z,
    term: 26 * z,
    rail: 8 * z,
    dot: 4.4 * z,
    dotGap: 16 * z,
    rowPad: 15 * z,
    endH: 60 * z,
    rowGap: 16 * z,
    gapMax: 44 * z,
    gap: 12 * z,
    pp: 18 * z,
    colGap: 32 * z,
    flock: 27 * z,
    thumb: 104 * z,
    side: 216 * z,
    heroMin: 230 * z,
    wideMin: 180 * z,
    padY: 14 * z,
  }
}
type S = ReturnType<typeof sizes>
type Cols = { timeR: number; railX: number; bodyX: number; bodyR: number; bw: number }

const legText = (m: Move) => R.mins(m.min)

// 時刻の列（区間の分も、この列の行と行の間に置く）・線・本文の左右の端
function columns(c: Ctx, input: RecapInput, s: S): Cols {
  c.font = font(700, s.time)
  const stopW = Math.max(...input.stops.map((x) => c.measureText(fmt(x.arrive)).width))
  c.font = font(700, s.endTime)
  const endW = Math.max(...[input.leave, input.finish].map((t) => c.measureText(fmt(t)).width))
  c.font = font(500, s.leg)
  const legW = Math.max(...[...input.stops.map((x) => x.move), input.back].map((m) => c.measureText(legText(m)).width)) + s.icon + 6 * s.z
  const tw = Math.max(stopW, endW, legW)
  const timeR = X0 + IN + tw
  const railX = timeR + 20 * s.z + s.badge / 2
  const bodyX = railX + s.badge / 2 + 20 * s.z
  const bodyR = X0 + CW - IN
  return { timeR, railX, bodyX, bodyR, bw: bodyR - bodyX }
}

// 大きく出す場所の形: hero（幅いっぱいの写真と、理由・注意点の 2 列）・side（横に写真）・text（文だけ・写真は小さく）・line（1 行ずつ）
// ほかの場所の形: wide（幅いっぱいの写真）・thumb（右に小さな写真）・plain（名前と役割）・flat（名前と混雑だけの 1 行）
type Kind = 'hero' | 'side' | 'text' | 'line' | 'wide' | 'thumb' | 'plain' | 'flat'
type Sec = { label: string; color: string; lines: string[]; size: number; weight: number; ink: string; inline: boolean }
type Panel = { w: number; two: boolean; colW: number; pp: number; secs: Sec[]; tail: { text: string; color: string; size: number; weight: number }[]; h: number }
type Block = {
  st: RecapStop
  feat: boolean
  kind: Kind
  pic: Pic | null
  name: string[]
  headH: number
  thumb: number
  big: { min: number; max: number; h: number } | null
  cap: string
  panel: Panel | null
  h: number
}

// 幅に収まるように折り返す（行数を超えたら、最後に「……」）。英語は単語で、日本語は 1 字ずつ折り返すが、
// 日本語の中の英数字のひと続き（人の名前・ライセンスの名前など）は切らない。閉じかっこと句読点は行の頭に置かず、前の行の最後の字と一緒に次の行へ送る
const MORE = isEn ? '…' : '……'
const TAIL = /^[、。，．）」』】〕・ー…!?！？:：;；,.)]/
const WORD = /[A-Za-z0-9.,:'’+\-/]/
function wrapText(c: Ctx, text: string, width: number, max: number): string[] {
  if (isEn) return wrap(c, text, width, max)
  const tokens = text.match(/[A-Za-z0-9][A-Za-z0-9.,:'’+\-/]*\s*|\s+|./gsu) ?? []
  const lines: string[] = []
  let cur = ''
  let i = 0
  for (; i < tokens.length; i++) {
    const t = tokens[i]
    if (cur && TAIL.test(t) && c.measureText(cur + t).width > width) {
      const chars = Array.from(cur.trimEnd())
      let carry = ''
      const inWord = () => WORD.test(carry[0]) && WORD.test(chars[chars.length - 1])
      while (chars.length > 1 && (!carry || TAIL.test(carry) || inWord())) carry = chars.pop()! + carry
      lines.push(chars.join(''))
      cur = carry + t
      if (lines.length === max) break
      continue
    }
    if (!cur || c.measureText(cur + t).width <= width) {
      if (!cur && c.measureText(t).width > width) {
        for (const ch of t) {
          if (cur && c.measureText(cur + ch).width > width) {
            lines.push(cur)
            cur = ''
            if (lines.length === max) break
          }
          cur += ch
        }
        if (lines.length === max) break
        continue
      }
      cur += t
      continue
    }
    lines.push(cur.trimEnd())
    cur = t.trimStart()
    if (lines.length === max) break
  }
  if (lines.length < max && cur) lines.push(cur.trimEnd())
  if (lines.join('').replace(/\s/g, '').length < text.replace(/\s/g, '').length && lines.length) {
    let last = lines[lines.length - 1]
    while (last && c.measureText(last + MORE).width > width) last = last.slice(0, -1)
    lines[lines.length - 1] = last.trimEnd() + MORE
  }
  return lines
}

// 折り返しの結果を覚えておく（形と倍率を何通りも試すので、同じ字・幅の計算を繰り返さない）
const wrapMemo = new Map<string, string[]>()
function wrapped(c: Ctx, text: string, width: number, max: number): string[] {
  const key = `${c.font}|${Math.round(width)}|${max}|${text}`
  let got = wrapMemo.get(key)
  if (!got) {
    got = wrapText(c, text, width, max)
    if (wrapMemo.size > 2000) wrapMemo.clear()
    wrapMemo.set(key, got)
  }
  return got
}

function secHeight(sec: Sec, s: S) {
  if (sec.inline) return sec.lines.length * sec.size * LH_BODY
  return s.label * 1.35 + 4 * s.z + sec.lines.length * sec.size * LH_BODY
}

// 理由と注意点の欄。mode: two（理由と注意点を左右に並べる）・stack（上下に並べる）・inline（見出しを行の頭に置く）
function makePanel(c: Ctx, st: RecapStop, w: number, s: S, mode: 'two' | 'stack' | 'inline', maxR: number, maxN: number, cap: string): Panel | null {
  const secs: Sec[] = []
  const tail: Panel['tail'] = []
  const two = mode === 'two' && !!st.reason && !!st.downside
  const pp = mode === 'inline' ? s.pp * 0.75 : s.pp
  const inner = w - pp * 2
  const colW = two ? (inner - s.colGap) / 2 : inner
  const lines = (text: string, weight: number, size: number, width: number, max: number) => {
    c.font = font(weight, size)
    return wrapped(c, text, width, max)
  }
  const inlineW = (label: string) => {
    c.font = font(700, s.label)
    return colW - c.measureText(label).width - 12 * s.z
  }
  if (st.reason) {
    const width = mode === 'inline' ? inlineW(R.reason) : colW
    secs.push({ label: R.reason, color: ROUTE, lines: lines(st.reason, 500, s.body, width, maxR), size: s.body, weight: 500, ink: INK, inline: mode === 'inline' })
  }
  if (st.downside && maxN > 0) {
    const width = mode === 'inline' ? inlineW(R.ai) : colW
    secs.push({ label: R.ai, color: INK2, lines: lines(st.downside, 400, s.note, width, maxN), size: s.note, weight: 400, ink: INK2, inline: mode === 'inline' })
  }
  if (cap) {
    c.font = font(500, s.cap)
    tail.push({ text: fit(c, cap, inner), color: INK2, size: s.cap, weight: 500 })
  }
  if (st.hit) tail.push({ text: R.hit[st.hit], color: st.hit === 'yes' ? ROUTE : MISS, size: s.hit, weight: 700 })
  if (!secs.length && !tail.length) return null
  let h = pp * 2
  if (two) h += Math.max(...secs.map((x) => secHeight(x, s)))
  else h += secs.reduce((a, x) => a + secHeight(x, s), 0) + Math.max(0, secs.length - 1) * (mode === 'inline' ? 4 * s.z : s.gap)
  if (tail.length) h += (secs.length ? s.gap * 0.7 : 0) + tail.reduce((a, t) => a + t.size * 1.4, 0)
  return { w, two, colW, pp, secs, tail, h }
}

// 広げて出す場所か（ミッションの写真は、読めたときだけ数える）
const featuredWith = (st: RecapStop, pic: Pic | null) => !!st.reason || !!st.hit || (!!st.shot && !!pic && !pic.wiki)

// 混雑の印と言葉の幅（推定の無い時間帯は 0）
function crowdWidth(c: Ctx, st: RecapStop, s: S) {
  if (st.level === null) return 0
  c.font = font(st.level >= 4 ? 700 : 500, s.meta)
  return flockWidth(st.level, s.flock) + 6 * s.z + c.measureText(LEVEL_LABEL[st.level] ?? LEVEL_LABEL[0]).width
}

const metaH = (s: S) => Math.max(s.meta * 1.35, s.flock)

function makeBlock(c: Ctx, st: RecapStop, want: Kind, pic: Pic | null, s: S, cols: Cols, roomy: boolean): Block {
  const featured = featuredWith(st, pic)
  let kind = want
  if (!pic && (kind === 'wide' || kind === 'thumb')) kind = 'plain'
  const thumb = pic && (kind === 'thumb' || kind === 'text') ? s.thumb : 0
  const nameW = cols.bw - (thumb ? thumb + 18 * s.z : 0)
  c.font = font(700, s.name)
  const flat = kind === 'flat'
  const name = flat ? [fit(c, st.name, nameW - (st.level !== null ? crowdWidth(c, st, s) + 20 * s.z : 0))] : kind === 'line' ? [fit(c, st.name, nameW)] : wrapped(c, st.name, nameW, 2)
  c.font = font(700, s.name)
  const headH = name.length * s.name * LH_NAME + (flat ? 0 : 4 * s.z + metaH(s))
  const caption = featured && st.shot && pic && !pic.wiki && st.odai ? R.odai(st.odai) : ''
  const b: Block = { st, feat: featured, kind, pic, name, headH, thumb, big: null, cap: '', panel: null, h: 0 }
  if (kind === 'hero') {
    if (pic) {
      const min = roomy ? Math.min(cols.bw * 0.56, 420 * s.z) : s.heroMin
      b.big = { min, max: Math.max(min, Math.min(cols.bw * 0.75, 560 * s.z)), h: min }
      b.cap = caption
    }
    b.panel = makePanel(c, st, cols.bw, s, 'two', pic ? 4 : 5, pic ? 4 : 5, '')
  } else if (kind === 'side') {
    const pw = pic ? cols.bw - s.side - 16 * s.z : cols.bw
    b.panel = makePanel(c, st, pw, s, pic ? 'stack' : 'inline', 3, 3, caption)
    if (pic) {
      const min = Math.max(s.side, b.panel?.h ?? 0)
      b.big = { min, max: Math.max(min, s.side * 1.5), h: min }
    }
  } else if (kind === 'text') {
    b.panel = makePanel(c, st, cols.bw, s, 'inline', 2, 2, '')
  } else if (kind === 'line') {
    b.panel = makePanel(c, st, cols.bw, s, 'inline', 1, 1, '')
  } else if (kind === 'wide' && pic) {
    b.big = { min: s.wideMin, max: Math.max(s.wideMin, cols.bw * 0.5), h: s.wideMin }
  }
  b.h = blockHeight(b, s)
  return b
}

function blockHeight(b: Block, s: S): number {
  let h = s.rowPad + Math.max(b.headH, b.thumb)
  if (b.kind === 'side') {
    const body = Math.max(b.big?.h ?? 0, b.panel?.h ?? 0)
    if (body) h += s.gap + body
  } else {
    if (b.big) h += s.gap + b.big.h + (b.cap ? 8 * s.z + s.cap * 1.35 : 0)
    if (b.panel) h += s.gap + b.panel.h
  }
  return h + s.rowPad
}

// gap: 行と行の間（区間の分を置く所。余った高さで伸ばす）
type Layout = { s: S; cols: Cols; blocks: Block[]; gap: number; h: number }

const timelineHeight = (l: Pick<Layout, 's' | 'blocks' | 'gap'>) => l.s.padY * 2 + l.s.endH * 2 + l.gap * (l.blocks.length + 1) + l.blocks.reduce((a, b) => a + b.h, 0)

// 広げる場所のうち、いちばん大きく出す 1 か所（ミッションの写真 → 理由と写真 → 理由。同じなら先の場所）
function leadOf(stops: RecapStop[], pics: Map<number, Pic>): RecapStop | undefined {
  const own = (s: RecapStop) => !!s.shot && !!pics.get(s.no) && !pics.get(s.no)!.wiki
  const rank = (s: RecapStop) => (own(s) ? 0 : s.reason && pics.get(s.no) ? 1 : s.reason ? 2 : 3)
  return stops.filter((s) => featuredWith(s, pics.get(s.no) ?? null)).sort((a, b) => rank(a) - rank(b) || a.no - b.no)[0]
}

// 形の組み合わせ（豊かな順）。lead: いちばん大きく出す場所・rest: ほかの広げる場所・other: 広げない場所
type Pattern = { lead: Kind; rest: Kind; other: Kind }
const PATTERNS: Pattern[] = [
  { lead: 'hero', rest: 'hero', other: 'thumb' },
  { lead: 'hero', rest: 'side', other: 'thumb' },
  { lead: 'side', rest: 'side', other: 'thumb' },
  { lead: 'hero', rest: 'text', other: 'thumb' },
  { lead: 'side', rest: 'text', other: 'thumb' },
  { lead: 'side', rest: 'side', other: 'plain' },
  { lead: 'side', rest: 'text', other: 'plain' },
  { lead: 'side', rest: 'text', other: 'flat' },
  { lead: 'text', rest: 'text', other: 'flat' },
  { lead: 'text', rest: 'line', other: 'flat' },
  { lead: 'line', rest: 'line', other: 'flat' },
]
// ここより前の形なら、高さを伸ばしてでも使う（ここから後は、1920 に収まるときだけ）
const GOOD = 8
const ZOOMS = [1.15, 1.1, 1.05, 1, 0.95]
const MAX_H = 2340 // 画像の高さの上限（スマホの画面と同じ縦横の比）
const ZOOMS_UP = [1.45, 1.4, 1.35, 1.3, 1.25, 1.2]
const ROOMY_LEFT = 80 // これより多く余ったら、字を大きくして収め直す

function layout(c: Ctx, input: RecapInput, pics: Map<number, Pic>, p: Pattern, z: number, roomy: boolean): Layout {
  const s = sizes(z)
  const cols = columns(c, input, s)
  const lead = leadOf(input.stops, pics)
  const blocks = input.stops.map((st) => {
    const pic = pics.get(st.no) ?? null
    return makeBlock(c, st, featuredWith(st, pic) ? (st === lead ? p.lead : p.rest) : p.other, pic, s, cols, roomy)
  })
  const l: Layout = { s, cols, blocks, gap: s.rowGap, h: 0 }
  l.h = timelineHeight(l)
  return l
}

// 画像に描く Wikimedia の写真の作者とライセンス（札の番号つき）。1 枚ぶん（番号・作者・ライセンス）の途中では折り返さない
const drawsPhoto = (b: Block) => !!b.pic && (!!b.big || b.thumb > 0)
const creditMemo = new Map<string, string[]>()
function creditLines(c: Ctx, blocks: Block[]): string[] {
  const items = blocks.filter((b) => b.pic?.wiki && b.st.wiki && drawsPhoto(b)).map((b) => `${b.st.no} ${b.st.wiki!.credit}`)
  if (!items.length) return []
  const key = items.join('\n')
  const memo = creditMemo.get(key)
  if (memo) return memo
  c.font = font(400, CREDIT)
  const width = W - 128
  const sep = R.listSep.trimEnd()
  const lines: string[] = []
  let cur = R.photos
  items.forEach((it, i) => {
    const piece = (i ? R.listSep : '') + it
    if (c.measureText(cur + piece).width <= width) {
      cur += piece
      return
    }
    lines.push(i ? cur + sep : cur.trimEnd())
    const parts = wrapped(c, it, width, 3)
    lines.push(...parts.slice(0, -1))
    cur = parts[parts.length - 1] ?? ''
  })
  if (cur) lines.push(cur)
  creditMemo.set(key, lines)
  return lines
}

// 「……」で切った文の数（名前・理由・注意点・ミッション）。字を大きくして切れる文が増えるなら、大きくしない
const cuts = (l: Layout) =>
  l.blocks.reduce((a, b) => a + [...b.name, ...(b.panel?.secs.flatMap((x) => x.lines) ?? []), ...(b.panel?.tail.map((t) => t.text) ?? []), b.cap].filter((t) => t.endsWith(MORE)).length, 0)

// 余った高さを配る: 大きな写真 → ほかの場所の写真を幅いっぱいに → 写真をさらに大きく → 行と行の間。配り切れなかった分を返す
function spread(c: Ctx, l: Layout, slack: number, roomy: boolean, room: () => number): number {
  const grow = (pick: (b: Block) => boolean) => {
    for (let round = 0; round < 6 && slack > 0.5; round++) {
      const open = l.blocks.filter((b) => b.big && pick(b) && b.big.h < b.big.max - 0.5)
      if (!open.length) break
      const share = slack / open.length
      for (const b of open) {
        const add = Math.min(share, b.big!.max - b.big!.h)
        b.big!.h += add
        b.h = blockHeight(b, l.s)
        slack -= add
      }
    }
    l.h = timelineHeight(l)
  }
  grow((b) => b.kind === 'hero' || b.kind === 'side')
  if (roomy)
    for (const [i, b] of l.blocks.entries()) {
      if (b.kind !== 'thumb' || !b.pic) continue
      const next = makeBlock(c, b.st, 'wide', b.pic, l.s, l.cols, roomy)
      if (next.h - b.h > slack) continue
      l.blocks[i] = next
      l.h = timelineHeight(l)
      slack = room() - l.h
    }
  grow(() => true)
  const rows = l.blocks.length + 1
  const add = Math.max(0, Math.min(slack / rows, l.s.gapMax - l.gap))
  l.gap += add
  slack -= add * rows
  l.h = timelineHeight(l)
  return slack
}

// ---- 描く ----

function drawRail(c: Ctx, x: number, y1: number, y2: number, walk: boolean, s: S) {
  c.fillStyle = ROUTE
  if (!walk) {
    c.fillRect(x - s.rail / 2, y1, s.rail, y2 - y1)
    return
  }
  for (let y = y1 + s.dotGap / 2; y < y2; y += s.dotGap) {
    c.beginPath()
    c.arc(x, y, s.dot, 0, Math.PI * 2)
    c.fill()
  }
}

function drawBadge(c: Ctx, no: number, x: number, cy: number, s: S, filled: boolean) {
  const b = 5 * s.z
  const size = s.badge
  c.fillStyle = filled ? ROUTE : '#ffffff'
  c.strokeStyle = ROUTE
  c.lineWidth = b
  rrect(c, x - size / 2 + b / 2, cy - size / 2 + b / 2, size - b, size - b, size * 0.26 - b / 2)
  c.fill()
  c.stroke()
  c.fillStyle = filled ? '#ffffff' : ROUTE
  c.font = font(700, size * 0.5)
  c.textAlign = 'center'
  c.fillText(String(no), x, cy + size * 0.18)
  c.textAlign = 'left'
}

function drawTerminal(c: Ctx, x: number, cy: number, s: S) {
  c.beginPath()
  c.arc(x, cy, s.term / 2, 0, Math.PI * 2)
  c.fillStyle = '#ffffff'
  c.fill()
  c.strokeStyle = ROUTE
  c.lineWidth = 6 * s.z
  c.stroke()
}

// 混雑の印と言葉（左の端 x・縦の真ん中 cy）
function drawCrowd(c: Ctx, level: number, x: number, cy: number, s: S) {
  const fw = flockWidth(level, s.flock)
  c.drawImage(flock(level, s.flock), x - 2, cy - s.flock / 2 - 2)
  c.font = font(level >= 4 ? 700 : 500, s.meta)
  c.fillStyle = FLOCK_WORD[level] ?? INK2
  c.fillText(LEVEL_LABEL[level] ?? LEVEL_LABEL[0], x + fw + 6 * s.z, base(cy - (s.meta * 1.35) / 2, s.meta, 1.35))
}

// 名前の下の 1 行（役割・滞在と、着く時刻の混雑のペンギン）
function drawMeta(c: Ctx, st: RecapStop, x: number, top: number, width: number, s: S) {
  const lh = metaH(s)
  const cy = top + lh / 2
  const cw = crowdWidth(c, st, s)
  c.font = font(500, s.meta)
  const meta = fit(c, st.meta, width - (cw ? cw + 18 * s.z : 0))
  c.fillStyle = INK2
  c.fillText(meta, x, base(cy - (s.meta * 1.35) / 2, s.meta, 1.35))
  if (st.level !== null) drawCrowd(c, st.level, x + c.measureText(meta).width + (meta ? 18 * s.z : 0), cy, s)
}

function drawPanel(c: Ctx, p: Panel, x: number, y: number, h: number, s: S) {
  const inline = p.secs.some((sec) => sec.inline)
  c.fillStyle = PANEL
  rrect(c, x, y, p.w, h, 18 * s.z)
  c.fill()
  let cy = y + p.pp
  const sec = (one: Sec, sx: number, top: number) => {
    let ty = top
    let tx = sx
    c.font = font(700, s.label)
    c.fillStyle = one.color
    if (!one.inline) {
      c.fillText(one.label, sx, base(ty, s.label, 1.35))
      ty += s.label * 1.35 + 4 * s.z
    } else {
      c.fillText(one.label, sx, base(ty, one.size, LH_BODY))
      tx = sx + c.measureText(one.label).width + 12 * s.z
    }
    c.font = font(one.weight, one.size)
    c.fillStyle = one.ink
    one.lines.forEach((l, i) => c.fillText(l, tx, base(ty + i * one.size * LH_BODY, one.size, LH_BODY)))
  }
  if (p.two) {
    const [a, b] = p.secs
    const tall = Math.max(secHeight(a, s), secHeight(b, s))
    sec(a, x + p.pp, cy)
    sec(b, x + p.pp + p.colW + s.colGap, cy)
    c.fillStyle = RULE
    c.fillRect(x + p.pp + p.colW + s.colGap / 2 - 1, cy + 2 * s.z, 2, tall - 4 * s.z)
    cy += tall
  } else {
    p.secs.forEach((one, i) => {
      if (i) cy += inline ? 4 * s.z : s.gap
      sec(one, x + p.pp, cy)
      cy += secHeight(one, s)
    })
  }
  if (p.tail.length) {
    if (p.secs.length) cy += s.gap * 0.7
    for (const t of p.tail) {
      c.font = font(t.weight, t.size)
      c.fillStyle = t.color
      c.fillText(t.text, x + p.pp, base(cy, t.size, 1.4))
      cy += t.size * 1.4
    }
  }
}

// 場所の段の、番号の札の真ん中の高さ（名前の 1 行目の真ん中）
const badgeY = (top: number, s: S) => top + s.rowPad + (s.name * LH_NAME) / 2

function drawBlock(c: Ctx, b: Block, top: number, s: S, cols: Cols) {
  const y0 = top + s.rowPad
  const first = badgeY(top, s)
  // 時刻（主役）
  c.textAlign = 'right'
  c.fillStyle = INK
  c.font = font(700, s.time)
  c.fillText(fmt(b.st.arrive), cols.timeR, base(first - (s.time * LH_NAME) / 2, s.time, LH_NAME))
  c.textAlign = 'left'
  // 名前（主役）と、役割・滞在・混雑（補足）。1 行の形では、混雑を名前の行の右に置く
  c.font = font(700, s.name)
  c.fillStyle = INK
  b.name.forEach((l, i) => c.fillText(l, cols.bodyX, base(y0 + i * s.name * LH_NAME, s.name, LH_NAME)))
  const nameW = cols.bw - (b.thumb ? b.thumb + 18 * s.z : 0)
  if (b.kind === 'flat') {
    if (b.st.level !== null) drawCrowd(c, b.st.level, cols.bodyR - crowdWidth(c, b.st, s), first, s)
  } else drawMeta(c, b.st, cols.bodyX, y0 + b.name.length * s.name * LH_NAME + 4 * s.z, nameW, s)
  if (b.thumb && b.pic) cover(c, b.pic.img, cols.bodyR - b.thumb, y0, b.thumb, b.thumb, 16 * s.z)
  let y = y0 + Math.max(b.headH, b.thumb)
  if (b.kind === 'side') {
    y += s.gap
    const body = Math.max(b.big?.h ?? 0, b.panel?.h ?? 0)
    if (b.big && b.pic) cover(c, b.pic.img, cols.bodyR - s.side, y, s.side, body, 18 * s.z)
    if (b.panel) drawPanel(c, b.panel, cols.bodyX, y, body, s)
  } else {
    if (b.big && b.pic) {
      y += s.gap
      cover(c, b.pic.img, cols.bodyX, y, cols.bw, b.big.h, 18 * s.z)
      y += b.big.h
      if (b.cap) {
        y += 8 * s.z
        c.font = font(500, s.cap)
        c.fillStyle = INK2
        c.fillText(fit(c, b.cap, cols.bw), cols.bodyX, base(y, s.cap, 1.35))
        y += s.cap * 1.35
      }
    }
    if (b.panel) {
      y += s.gap
      drawPanel(c, b.panel, cols.bodyX, y, b.panel.h, s)
    }
  }
  drawBadge(c, b.st.no, cols.railX, first, s, b.feat)
}

function drawEnd(c: Ctx, time: number, name: string, word: string, cy: number, s: S, cols: Cols) {
  c.textAlign = 'right'
  c.fillStyle = INK
  c.font = font(700, s.endTime)
  c.fillText(fmt(time), cols.timeR, base(cy - (s.endTime * LH_NAME) / 2, s.endTime, LH_NAME))
  c.textAlign = 'left'
  c.font = font(500, s.endWord)
  const ww = c.measureText(word).width
  c.font = font(700, s.endName)
  const n = fit(c, name, cols.bw - ww - 14 * s.z)
  c.fillStyle = INK
  c.fillText(n, cols.bodyX, base(cy - (s.endName * LH_NAME) / 2, s.endName, LH_NAME))
  const nx = cols.bodyX + c.measureText(n).width + 14 * s.z
  c.font = font(500, s.endWord)
  c.fillStyle = INK2
  c.fillText(word, nx, base(cy - (s.endName * LH_NAME) / 2, s.endName, LH_NAME))
}

// 区間の手段と分（時刻の列の、行と行の間。右をそろえる）
function drawLeg(c: Ctx, m: Move, cy: number, s: S, cols: Cols) {
  c.font = font(500, s.leg)
  const text = legText(m)
  const tw = c.measureText(text).width
  c.fillStyle = INK2
  c.textAlign = 'right'
  c.fillText(text, cols.timeR, base(cy - (s.leg * 1.3) / 2, s.leg, 1.3))
  c.textAlign = 'left'
  drawModeIcon(c, m.icon, cols.timeR - tw - 6 * s.z - s.icon, cy, s.icon, INK2)
}

function drawTimeline(c: Ctx, input: RecapInput, l: Layout, y0: number) {
  const { s, cols } = l
  c.fillStyle = CARD
  rrect(c, X0, y0, CW, l.h, 28)
  c.fill()
  // 行の上の端（出発地・場所・到着地）と、線をつなぐ高さ
  const tops: number[] = []
  let y = y0 + s.padY
  tops.push(y)
  y += s.endH
  for (const b of l.blocks) {
    y += l.gap
    tops.push(y)
    y += b.h
  }
  y += l.gap
  tops.push(y)
  const last = l.blocks.length + 1
  const anchor = (i: number) => (i === 0 || i === last ? tops[i] + s.endH / 2 : badgeY(tops[i], s))
  const bottom = (i: number) => (i === 0 ? tops[0] + s.endH : tops[i] + l.blocks[i - 1].h)
  const moves = [...input.stops.map((x) => x.move), input.back]
  moves.forEach((m, i) => drawRail(c, cols.railX, anchor(i), anchor(i + 1), m.icon === 'walk', s))
  moves.forEach((m, i) => drawLeg(c, m, (bottom(i) + tops[i + 1]) / 2, s, cols))
  drawEnd(c, input.leave, input.start, R.depart, anchor(0), s, cols)
  drawTerminal(c, cols.railX, anchor(0), s)
  l.blocks.forEach((b, i) => drawBlock(c, b, tops[i + 1], s, cols))
  drawEnd(c, input.finish, input.goal, R.arrive, anchor(last), s, cols)
  drawTerminal(c, cols.railX, anchor(last), s)
}

// ---- 見出し・混雑の帯・奥付 ----

const TOP = 54
const EYEBROW = 27
const TITLE = 54
const TITLE_MIN = 44
const HEAD_GAP = 24
const STRIP_GAP = 22
const FOOT_GAP = 22
const CREDIT = 22
const BRAND = 32
const BOTTOM = 46

type Title = { lines: string[]; size: number }

// プランの題: 1 行に収まる大きさ（54〜44）で 1 行。収まらなければ 2 行（折り返してよい所で分ける）
function titleOf(c: Ctx, input: RecapInput): Title {
  const width = W - 128
  const parts = input.title.length ? input.title : [input.area]
  const full = parts.join(isEn ? ' ' : '')
  for (let size = TITLE; size >= TITLE_MIN; size -= 2) {
    c.font = font(700, size)
    if (c.measureText(full).width <= width) return { lines: [full], size }
  }
  const size = 48
  c.font = font(700, size)
  if (parts.length === 2 && parts.every((x) => c.measureText(x).width <= width)) return { lines: parts, size }
  return { lines: wrapped(c, full, width, 2), size }
}

const headerHeight = (t: Title) => TOP + EYEBROW * 1.3 + 10 + t.lines.length * t.size * 1.2

function drawHeader(c: Ctx, input: RecapInput, t: Title) {
  let y = TOP
  c.font = font(700, EYEBROW)
  c.fillStyle = ROUTE
  c.fillText(R.title, 64, base(y, EYEBROW, 1.3))
  const tw = c.measureText(R.title).width
  c.font = font(500, EYEBROW)
  c.fillStyle = INK2
  const where = input.title.length ? R.when(input.area, input.date) : input.date
  c.fillText(fit(c, where, W - 128 - tw - 24), 64 + tw + 24, base(y, EYEBROW, 1.3))
  y += EYEBROW * 1.3 + 10
  c.font = font(700, t.size)
  c.fillStyle = INK
  t.lines.forEach((l, i) => c.fillText(l, 64, base(y + i * t.size * 1.2, t.size, 1.2)))
}

const STRIP_PAD = 18
const STRIP_LABEL = 23

// 混雑の帯の値の行（よくある回り方 X → このプラン Y）。値は大きく、このプランの値は浅葱。入らなければ字を小さくする
function stripSpans(c: Ctx, crowd: { usual: number; plan: number }) {
  for (const [word, value] of [
    [27, 38],
    [24, 32],
    [22, 28],
  ]) {
    const spans: { text: string; font: string; color: string }[] = [
      { text: `${R.usual} `, font: font(500, word), color: INK2 },
      { text: fmtDur(crowd.usual), font: font(700, value), color: INK },
      { text: ' → ', font: font(400, value), color: INK2 },
      { text: `${R.plan} `, font: font(600, word), color: INK },
      { text: fmtDur(crowd.plan), font: font(700, value), color: ROUTE },
    ]
    const w = spans.reduce((a, x) => ((c.font = x.font), a + c.measureText(x.text).width), 0)
    if (w <= CW - 64 || value === 28) return { spans, value }
  }
  return { spans: [], value: 0 }
}

function stripHeight(c: Ctx, input: RecapInput): number {
  if (!input.crowd) return 0
  if (input.crowd === 'never') return STRIP_PAD * 2 + 27 * 1.4
  return STRIP_PAD * 2 + STRIP_LABEL * 1.3 + 2 + stripSpans(c, input.crowd).value * 1.2
}

function drawStrip(c: Ctx, input: RecapInput, y: number) {
  const h = stripHeight(c, input)
  if (!h || !input.crowd) return
  c.fillStyle = SOFT
  rrect(c, X0, y, CW, h, 24)
  c.fill()
  const x = X0 + 32
  if (input.crowd === 'never') {
    c.font = font(600, 27)
    c.fillStyle = INK
    c.fillText(fit(c, R.never, CW - 64), x, base(y + STRIP_PAD, 27, 1.4))
    return
  }
  c.font = font(500, STRIP_LABEL)
  c.fillStyle = INK2
  c.fillText(fit(c, R.crowd, CW - 64), x, base(y + STRIP_PAD, STRIP_LABEL, 1.3))
  const { spans, value } = stripSpans(c, input.crowd)
  const bl = base(y + STRIP_PAD + STRIP_LABEL * 1.3 + 2, value, 1.2)
  let sx = x
  for (const sp of spans) {
    c.font = sp.font
    c.fillStyle = sp.color
    c.fillText(sp.text, sx, bl)
    sx += c.measureText(sp.text).width
  }
}

const footHeight = (credits: number) => (credits ? credits * CREDIT * 1.45 + 12 : 0) + BRAND * 1.3 + BOTTOM

function drawFoot(c: Ctx, credits: string[], height: number) {
  const brandTop = height - BOTTOM - BRAND * 1.3
  if (credits.length) {
    c.font = font(400, CREDIT)
    c.fillStyle = INK2
    const top = brandTop - 12 - credits.length * CREDIT * 1.45
    credits.forEach((l, i) => c.fillText(l, 64, base(top + i * CREDIT * 1.45, CREDIT, 1.45)))
  }
  const ph = 38
  c.drawImage(flock(0, ph), 64 - 2, brandTop + (BRAND * 1.3 - ph) / 2 - 2)
  const bx = 64 + flockWidth(0, ph) + 12
  c.font = font(700, BRAND)
  c.fillStyle = ROUTE
  c.fillText('IntenTrip', bx, base(brandTop, BRAND, 1.3))
  const used = bx + c.measureText('IntenTrip').width + 32
  c.font = font(500, 24)
  c.fillStyle = INK2
  c.textAlign = 'right'
  c.fillText(fit(c, R.tagline, W - 64 - used), W - 64, base(brandTop, BRAND, 1.3))
  c.textAlign = 'left'
}

// ---- 全体 ----

async function loadSans() {
  await loadFonts()
  try {
    await Promise.all([400, 500, 600, 700].map((w) => document.fonts.load(`${w} 40px Figtree`)))
  } catch {
    /* 読めなくても、端末の字で描く */
  }
}

type Chosen = { l: Layout; p: Pattern; roomy: boolean; height: number }

// 形と倍率を、豊かな物から順に試す。
// 1. 1920 に収まる、ふつうの形（写真はほどよい大きさ → いちばん小さい大きさ）
// 2. 高さを 2340 まで伸ばして、ふつうの形
// 3. 1920 に収まる、詰めた形（字を小さくしてもよい）
// 4. 詰めた形のまま、高さを伸ばす
function choose(c: Ctx, input: RecapInput, pics: Map<number, Pic>, above: number): Chosen {
  const foot = (l: Layout) => FOOT_GAP + footHeight(creditLines(c, l.blocks).length)
  const steps: { ps: Pattern[]; zs: number[]; roomy: boolean; grow: boolean }[] = [
    { ps: PATTERNS.slice(0, GOOD), zs: ZOOMS, roomy: true, grow: false },
    { ps: PATTERNS.slice(0, GOOD), zs: ZOOMS, roomy: false, grow: false },
    { ps: PATTERNS.slice(0, GOOD), zs: [1, 0.95], roomy: false, grow: true },
    { ps: PATTERNS.slice(GOOD), zs: [1, 0.95, 0.9, 0.85], roomy: false, grow: false },
    { ps: PATTERNS.slice(GOOD), zs: [0.95, 0.9, 0.85], roomy: false, grow: true },
  ]
  for (const st of steps)
    for (const p of st.ps)
      for (const z of st.zs) {
        const l = layout(c, input, pics, p, z, st.roomy)
        const need = Math.ceil(above + l.h + foot(l))
        const height = st.grow ? Math.max(CARD_H, need) : CARD_H
        if (need <= height && height <= MAX_H) return { l, p, roomy: st.roomy, height }
      }
  const p = PATTERNS[PATTERNS.length - 1]
  const l = layout(c, input, pics, p, 0.85, false)
  return { l, p, roomy: false, height: Math.max(CARD_H, Math.ceil(above + l.h + foot(l))) }
}

function paint(input: RecapInput, pics: Map<number, Pic>): Promise<Blob> {
  const probe = newCard(1).c
  const title = titleOf(probe, input)
  const head = headerHeight(title)
  const strip = stripHeight(probe, input)
  const above = head + HEAD_GAP + (strip ? strip + STRIP_GAP : 0)
  const pick = choose(probe, input, pics, above)
  const { p, roomy, height } = pick
  const roomOf = (x: Layout) => height - above - FOOT_GAP - footHeight(creditLines(probe, x.blocks).length)
  let l = pick.l
  let left = roomOf(l) - l.h
  if (left > 0) left = spread(probe, l, left, roomy, () => roomOf(l))
  // 写真と行の間に配っても大きく余るとき（場所が少なく写真も無いとき）は、同じ形のまま字を大きくして収め直す
  if (height === CARD_H && left > ROOMY_LEFT)
    for (const z of ZOOMS_UP) {
      if (z <= l.s.z) break
      const big = layout(probe, input, pics, p, z, roomy)
      if (big.h > roomOf(big) || cuts(big) > cuts(l)) continue
      l = big
      left = spread(probe, big, roomOf(big) - big.h, roomy, () => roomOf(big))
      break
    }
  const credits = creditLines(probe, l.blocks)
  const { cv, c } = newCard(height)
  drawHeader(c, input, title)
  // 配り切れなかった高さは、見出しと帯の間・帯と札の間・札と奥付の間に分けて置く
  const extra = Math.max(0, left)
  const lift = Math.min(extra / 3, 32)
  let y = head + HEAD_GAP + lift
  if (strip) {
    drawStrip(c, input, y)
    y += strip + STRIP_GAP
  }
  y += Math.max(0, (extra - lift) / 2)
  drawTimeline(c, input, l, y)
  drawFoot(c, credits, height)
  return toPng(cv)
}

export async function drawRecap(input: RecapInput): Promise<Blob> {
  await loadSans()
  const pics = await loadPhotos(input.stops, true)
  try {
    return await paint(input, pics)
  } catch (e) {
    // 外の写真で Canvas から画像を取り出せないときは、Wikimedia の写真を外して描き直す
    if (!(e instanceof DOMException && e.name === 'SecurityError')) throw e
    return paint(input, new Map([...pics].filter(([, p]) => !p.wiki)))
  }
}
