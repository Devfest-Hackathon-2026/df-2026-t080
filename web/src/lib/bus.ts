// 時刻表（GTFS）から、区間の乗換なしのバス・電車の便をサーバーに聞く。
// どの事業者の時刻表を使うかは、サーバーがエリアの範囲で選ぶ。乗換が要る区間・時刻表の無いエリアは、便が無い（今までどおり目安の時間）。
import type { AreaData, BusParts, BusPick, BusSource, BusTrip, Point, TransitRoute } from '../types'
import { hasServer } from './api'
import { fmt } from './time'
import { isEn, lang, tr } from './i18n'
import { licenseLink } from './photo'

// 出典の言葉。ODPT の文はガイドライン 3.1 の例文（英語は日本語の例文に合わせて訳した）
const CREDIT = tr({
  ja: {
    title: (t: string) => `「${t}」`,
    version: (d: string) => `${d}版`,
    repo: 'GTFSデータリポジトリ',
    odpt: '公共交通データの出典は公共交通オープンデータセンターです。公共交通事業者から提供されたデータを元にしており、正確性・完全性は保証されません。',
    contact: (c: string) => `本アプリの内容に関するお問い合わせは公共交通事業者ではなく${c}にお願いします。`,
  },
  en: {
    title: (t: string) => ` “${t}”`,
    version: (d: string) => ` (version of ${d})`,
    repo: 'GTFS Data Repository',
    odpt: 'The source of the public transportation data in this app is the Public Transportation Open Data Center. The data is based on data provided by public transportation operators, and its accuracy and completeness are not guaranteed.',
    contact: (c: string) => ` For questions about this app, please contact ${c}, not the public transportation operators.`,
  },
})

export type { BusSource }
export type BusInfo = { on: boolean; sources: BusSource[]; contact: string | null }
type BusReply = { trips?: BusTrip[]; sources?: BusSource[]; loading?: boolean; off?: boolean; error?: string }

const OFF: BusInfo = { on: false, sources: [], contact: null }

// エリアの範囲（南, 西, 北, 東）。出発地・到着地と候補の場所を囲む
export function areaBox(data: AreaData): string {
  const pts = [data.start, ...(data.end ? [data.end] : []), ...data.places]
  const lat = pts.map((p) => p.lat)
  const lng = pts.map((p) => p.lng)
  return [Math.min(...lat), Math.min(...lng), Math.max(...lat), Math.max(...lng)].map((v) => v.toFixed(4)).join(',')
}

// エリアで便を出せるか・時刻表の版と出典・出典の問い合わせ先。時刻表をまだ取っていなければ、サーバーが取ってから返す
export async function loadBusInfo(date: string, box: string): Promise<BusInfo> {
  if (!hasServer) return OFF
  try {
    const r = await fetch(`/api/bus-info?date=${encodeURIComponent(date)}&box=${encodeURIComponent(box)}`)
    if (!r.ok) return OFF
    const j = (await r.json()) as Partial<BusInfo>
    return { on: !!j.on, sources: j.sources ?? [], contact: j.contact ?? null }
  } catch {
    return OFF
  }
}

const sourceKey = (s: BusSource) => `${s.name ?? s.agency}|${s.title ?? ''}|${s.version}`

// 届いた出典を、今までの出典に足す（同じ時刻表の同じ版は 1 つ）
export function mergeSources(prev: BusSource[], next: BusSource[] | undefined): BusSource[] {
  if (!next?.length) return prev
  const have = new Set(prev.map(sourceKey))
  const add = next.filter((s) => !have.has(sourceKey(s)))
  return add.length ? [...prev, ...add] : prev
}

const ll = (p: Point) => `${p.lat.toFixed(5)},${p.lng.toFixed(5)}`
const asked = new Map<string, Promise<BusReply | null>>()

// 区間の便（着く時刻の早い順に 3 つまで）。同じ区間・日・時刻は 1 回だけ聞く
export function fetchBus(a: Point, b: Point, date: string, after: number): Promise<BusReply | null> {
  const t = Math.max(0, Math.round(after))
  const key = `${ll(a)}>${ll(b)}|${date}|${t}`
  const hit = asked.get(key)
  if (hit) return hit
  const p = fetch(`/api/bus?from=${ll(a)}&to=${ll(b)}&date=${encodeURIComponent(date)}&after=${fmt(t)}&lang=${lang}`)
    .then(async (r) => {
      if (!r.ok) throw new Error(String(r.status))
      const j = (await r.json()) as BusReply
      if (j.loading || j.error) asked.delete(key) // 時刻表を取っている途中・失敗したときは、次の機会にもう一度
      return j
    })
    .catch(() => {
      asked.delete(key)
      return null
    })
  if (asked.size > 300) asked.clear()
  asked.set(key, p)
  return p
}

const hm = (s: string) => {
  const m = /^(\d{1,2}):(\d{2})/.exec(s)
  return m ? Number(m[1]) * 60 + Number(m[2]) : 0
}

export const busName = (t: BusTrip) => `${t.agency} ${t.route}`
export const isTrain = (t: BusTrip) => t.mode === 'train'
export const rideMinutes = (t: BusTrip) => hm(t.alight.time) - hm(t.board.time)
export const sameTrip = (a: BusTrip, b: BusTrip) =>
  a.agency === b.agency && a.route === b.route && a.board.time === b.board.time && a.board.name === b.board.name && a.alight.time === b.alight.time

type LL = [number, number]

// 便の線の 3 つの部分。歩く部分の端は、区間の 2 地点 A・B（[経度, 緯度]）にそろえる（サーバーが分けていない便は、乗る線から作る）
export function busParts(t: BusTrip, A: LL, B: LL): BusParts {
  const ride = t.parts?.ride ?? t.line
  const to = t.parts?.walkTo ?? [A, ride[0]]
  const from = t.parts?.walkFrom ?? [ride[ride.length - 1], B]
  return { walkTo: [A, ...to.slice(1)], ride, walkFrom: [...from.slice(0, -1), B] }
}

// 3 つの部分をつないだ 1 本の線（区間の地点 → 乗る線 → 区間の地点。停留所の点は乗る線の端に任せる）
export function joinParts(p: BusParts): LL[] {
  return [...p.walkTo.slice(0, -1), ...p.ride, ...p.walkFrom.slice(1)]
}

// 便を選んだときの区間の経路。出る時刻は前の場所を出る時刻（停留所や駅まで歩く分だけ前）、着く時刻は次の場所に着く時刻
export function busRoute(t: BusTrip, date: string, after: number): TransitRoute {
  const board = hm(t.board.time)
  const alight = hm(t.alight.time)
  const leave = board - t.walkTo
  const arrive = alight + t.walkFrom
  const bus: BusPick = { ...t, date, after: Math.round(after) }
  return {
    origin: t.board.name,
    destination: t.alight.name,
    depart: fmt(leave),
    arrive: fmt(arrive),
    minutes: arrive - leave,
    fare: 0,
    steps: [
      { mode: 'walk', line: '', from: '', to: t.board.name, depart: '', arrive: '', minutes: t.walkTo },
      { mode: isTrain(t) ? 'train' : 'bus', line: busName(t), from: t.board.name, to: t.alight.name, depart: t.board.time, arrive: t.alight.time, minutes: alight - board },
      { mode: 'walk', line: '', from: t.alight.name, to: '', depart: '', arrive: '', minutes: t.walkFrom },
    ],
    bus,
  }
}

const DATE = /^(\d{4})-(\d{2})-(\d{2})(?:T(\d{2}):(\d{2}))?/
const EN_MONTH = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
// 「2026年11月4日」「Nov 4, 2026」
export const jaDate = (s: string, time = false) => {
  const m = DATE.exec(s)
  if (!m) return ''
  const d = isEn ? `${EN_MONTH[Number(m[2]) - 1]} ${Number(m[3])}, ${m[1]}` : `${Number(m[1])}年${Number(m[2])}月${Number(m[3])}日`
  return time && m[4] ? `${d} ${Number(m[4])}:${m[5]}` : d
}

// 出典の 1 行（「京都市交通局「京都市営バス」2026年11月4日版」）。ライセンスの名前と URL は別に出す
export type CreditItem = { text: string; license: string; url: string; via: string }

export function creditItems(sources: BusSource[]): CreditItem[] {
  const out: CreditItem[] = []
  const seen = new Set<string>()
  for (const s of sources) {
    const name = (isEn && s.nameEn) || s.name || s.agency
    const t = (isEn && s.titleEn) || s.title
    const title = t && !t.startsWith(name) && !name.startsWith(t) ? CREDIT.title(t) : ''
    const text = isEn
      ? `${name}${title}${s.version ? CREDIT.version(jaDate(s.version)) : ''}`
      : `${name}${title}${s.version ? `${title ? '' : ' '}${CREDIT.version(jaDate(s.version))}` : ''}`
    if (seen.has(text)) continue
    seen.add(text)
    const odpt = !s.license || s.license === 'odpt'
    out.push({ text, license: odpt ? '' : (s.licenseName ?? s.license ?? ''), url: odpt ? '' : licenseLink(s.licenseUrl ?? ''), via: s.via === 'GTFSデータリポジトリ' ? CREDIT.repo : '' })
  }
  return out
}

// 一番古い取得日時（「2026年11月6日 21:27」）
export function fetchedText(sources: BusSource[]): string {
  const list = sources.map((s) => s.fetched).filter(Boolean).sort()
  return list.length ? jaDate(list[0], true) : ''
}

// 公共交通オープンデータセンターのガイドライン 3.1 の出典の表示。ODPT から取った時刻表があるときだけ。
// 問い合わせ先が無いときは、その一文を出さない
export function odptCredit(sources: BusSource[], contact: string | null): string {
  if (!sources.some((s) => (s.via ?? 'ODPT') === 'ODPT')) return ''
  return contact ? `${CREDIT.odpt}${CREDIT.contact(contact)}` : CREDIT.odpt
}
