// 泊まりの旅を作る画面の、1 行の文から読み取った旅のまとめと、次に聞くこと。
// 日ごとの希望と時刻を、その日の候補の頼みとプランの時刻に使う関数もここに置く
import type { Saved } from './saved'

// 日ごとの希望と時刻（分）。start: その日に出発する時刻、end: その日の観光を終える（宿に着く・帰る）時刻
export type DayWant = { wish?: string; start?: number; end?: number }

// 旅全体の希望と、日ごとの希望と時刻（k 番目が k+1 日目）。旅の全日で 1 つ持つ
export type TripWants = { wish: string; days: DayWant[] }

// 読み取った旅のまとめ。end: 観光を終える場所（null は出発地に戻る・undefined はまだ分からない）、
// stays: 泊ごとの宿（null は前の泊と同じ）、over: 4泊以上を頼まれた
export type Talk = {
  from?: string
  nights?: number
  date?: string
  stays?: (string | null)[]
  end?: string | null
  wish?: string
  days?: DayWant[]
  over?: boolean
}

export const NIGHTS_MAX = 3

// 聞く順（start は最初の問いかけ、done は全部そろったとき）
export type Question = 'start' | 'where' | 'nights' | 'date' | 'stay' | 'wish' | 'time' | 'done'
const ORDER: Question[] = ['where', 'nights', 'date', 'stay', 'wish', 'time']
const OPTIONAL = new Set<Question>(['date', 'stay', 'wish', 'time'])
export const canSkip = (q: Question) => OPTIONAL.has(q)

const okTime = (v: unknown): v is number => typeof v === 'number' && Number.isInteger(v) && v >= 5 * 60 && v <= 23 * 60 + 55
const okText = (v: unknown): v is string => typeof v === 'string' && !!v.trim()

// 日ごとの希望と時刻を、泊数 from から to に変えた形にする。最終日の帰る時刻（end）は新しい最終日へ移し、範囲外の日は捨てる。
// 泊数がどちらか分からなければ、範囲外の日を捨てるだけ
export function fitDays(days: DayWant[] | undefined, from: number | undefined, to: number | undefined): DayWant[] | undefined {
  if (!days || !to) return days
  const out = days.slice(0, to + 1).map((d) => ({ ...(d ?? {}) }))
  if (from && from !== to) {
    const back = days[from]?.end
    if (from < out.length) delete out[from].end
    while (out.length <= to && back !== undefined) out.push({})
    if (out[to]) {
      if (back !== undefined) out[to].end = back
      else delete out[to].end
    }
  }
  while (out.length && !Object.keys(out[out.length - 1]).length) out.pop()
  return out
}

// サーバーが返した差分を、まとめに入れる。差分に無い項目はそのまま。stays は丸ごと入れ替え（空の泊は、今のまとめのその泊の宿で埋める）、
// days は日ごと・項目ごとに上書き。泊数が変わったら、最終日の帰る時刻を新しい最終日へ移す。over は次の差分で消える
export function mergeTalk(t: Talk, d: Partial<Talk>): Talk {
  const out: Talk = { ...t }
  if (okText(d.from)) out.from = d.from.trim()
  if (typeof d.nights === 'number' && Number.isInteger(d.nights) && d.nights >= 1 && d.nights <= NIGHTS_MAX) {
    out.nights = d.nights
    out.over = false
  } else if (d.over === true) out.over = true
  else if (out.over) out.over = false
  if (typeof d.date === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(d.date)) out.date = d.date
  if (Array.isArray(d.stays) && d.stays.some(okText)) out.stays = d.stays.slice(0, NIGHTS_MAX).map((x, k) => (okText(x) ? x.trim() : (t.stays?.[k] ?? null)))
  if (d.end === null) out.end = null
  else if (okText(d.end)) out.end = d.end.trim()
  if (okText(d.wish)) out.wish = d.wish.trim()
  const moved = out.nights !== t.nights ? fitDays(t.days, t.nights, out.nights) : t.days
  if (moved !== t.days) {
    if (moved?.length) out.days = moved
    else delete out.days
  }
  if (Array.isArray(d.days) && d.days.length) {
    const days = (moved ?? []).slice()
    d.days.slice(0, NIGHTS_MAX + 1).forEach((x, k) => {
      if (!x || typeof x !== 'object') return
      const cur: DayWant = { ...(days[k] ?? {}) }
      if (okText(x.wish)) cur.wish = x.wish.trim()
      if (okTime(x.start)) cur.start = x.start
      if (okTime(x.end)) cur.end = x.end
      days[k] = cur
    })
    out.days = Array.from({ length: out.nights ? Math.min(days.length, out.nights + 1) : days.length }, (_, k) => days[k] ?? {})
  }
  return out
}

// 旅の日数（泊数＋1）。泊数がまだ分からなければ 0
export const talkDays = (t: Talk) => (t.nights ? t.nights + 1 : 0)

// まとめに、その問いの答えが入っているか
function answered(t: Talk, q: Question): boolean {
  const days = t.days ?? []
  if (q === 'where') return !!t.from
  if (q === 'nights') return !!t.nights
  if (q === 'date') return !!t.date
  if (q === 'stay') return !!t.stays?.some(Boolean)
  if (q === 'wish') return !!t.wish || days.some((d) => !!d.wish)
  if (q === 'time') return days[0]?.start !== undefined || (!!t.nights && days[t.nights]?.end !== undefined)
  return true
}

// 次に聞くこと（足りない物を 1 つだけ）。passed: もう聞いた（答えたかスキップした）任意の問い。sent: 1 度でも文を送ったか
export function nextQuestion(t: Talk, passed: Question[], sent: boolean): Question {
  if (!sent) return 'start'
  for (const q of ORDER) {
    if (answered(t, q)) continue
    if (OPTIONAL.has(q) && passed.includes(q)) continue
    return q
  }
  return 'done'
}

// 候補を検索できるか（行き先と泊数がそろったら）
export const talkReady = (t: Talk) => !!t.from && !!t.nights

// 宿の並びを、同じ宿が続く泊ごとにまとめる（先頭の宿の無い泊は出さない）。nights: 泊数
export function stayRuns(stays: (string | null)[] | undefined, nights: number): { from: number; to: number; name: string }[] {
  const out: { from: number; to: number; name: string }[] = []
  let cur: string | null = null
  for (let k = 0; k < Math.max(nights, 1); k++) {
    const v = stays?.[k]
    if (v) cur = v
    if (!cur) continue
    const last = out[out.length - 1]
    if (last && last.name === cur && last.to === k) last.to = k + 1
    else out.push({ from: k + 1, to: k + 1, name: cur })
  }
  return out
}

// 宿の欄に入れる形（毎晩同じ宿か、泊ごとの欄の文字。空の欄は前の泊と同じ）
export function stayFieldsOf(stays: (string | null)[]): { same: boolean; texts: string[] } {
  const first = stays.find(Boolean) ?? null
  const same = stays.every((x, k) => (k === 0 ? x === first : !x || x === first))
  return same ? { same, texts: [first ?? ''] } : { same, texts: stays.map((x) => x ?? '') }
}

// 旅全体の希望とその日の希望をつないだ、その日の候補を頼む文
export function joinWish(a: string | undefined, b: string | undefined): string {
  const x = (a ?? '').trim()
  const y = (b ?? '').trim()
  if (!x || !y) return x || y
  return /[。．.!！?？]$/.test(x) ? `${x}${/[.!?]$/.test(x) ? ' ' : ''}${y}` : `${x}${/[A-Za-z0-9]$/.test(x) ? '. ' : '。'}${y}`
}

// n 日目（1 始まり）の候補を頼む希望と、その日の出発・観光を終える時刻（まとめに無い時刻は省く）。旅に日ごとの希望が無ければ null
export function dayWants(s: Pick<Saved, 'wants'>, n: number): { wish: string; start?: number; end?: number } | null {
  const w = s.wants
  if (!w) return null
  const d = w.days[n - 1] ?? {}
  return { wish: joinWish(w.wish, d.wish), ...(okTime(d.start) && { start: d.start }), ...(okTime(d.end) && { end: d.end }) }
}

// 旅の保存に持つ形（希望も日ごとの物も無ければ undefined）。n: 旅の日数（これより後の日は捨てる）
export function wantsOf(wish: string, days: DayWant[] | undefined, n = NIGHTS_MAX + 1): TripWants | undefined {
  const list = (days ?? []).slice(0, n).map((d) => ({ ...(okText(d.wish) && { wish: d.wish.trim() }), ...(okTime(d.start) && { start: d.start }), ...(okTime(d.end) && { end: d.end }) }))
  while (list.length && !Object.keys(list[list.length - 1]).length) list.pop()
  return list.length ? { wish: wish.trim(), days: list } : undefined
}

// 出発に合わせた、観光を終える時刻（出発から 1 時間より前なら 1 時間後に。23:55 まで）
export const fitEnd = (start: number, end: number) => Math.min(23 * 60 + 55, Math.max(end, start + 60))
