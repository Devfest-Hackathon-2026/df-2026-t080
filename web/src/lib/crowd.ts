// 混雑状況。
// 混雑は Gemini の推定（休日の 1 時間ごと・平日は weekdayDrop 段下げる）。
import type { Spot } from '../types'
import { tr } from './i18n'

export type Day = 'holiday' | 'weekday'

// 記号に添える短い言葉。1 は短く「ふつう」、ほかは Google マップの「混雑する時間帯」の言い方に合わせる
export const LEVEL_LABEL: readonly string[] = tr({
  ja: ['空いている', 'ふつう', 'やや混雑', '混雑', '非常に混雑'],
  en: ['Not busy', 'Usual', 'A little busy', 'Busy', 'Very busy'],
})
// 文の形（「11時台は……」に続ける）。Google マップの言い方に合わせる
export const LEVEL_PRED: readonly string[] = tr({
  ja: ['空いています', 'あまり混雑していません', 'やや混雑しています', '混雑しています', '非常に混雑しています'],
  en: ['not busy', 'not too busy', 'a little busy', 'busy', 'very busy'],
})
export const FIRST_HOUR = 8
export const LAST_HOUR = 18

const hourOf = (minute: number) => Math.min(LAST_HOUR, Math.max(FIRST_HOUR, Math.floor(minute / 60)))

export function levelAt(s: Spot, minute: number, day: Day): number {
  const v = s.crowd[hourOf(minute) - FIRST_HOUR] ?? 1
  return day === 'weekday' ? Math.max(0, v - s.weekdayDrop) : v
}

// その時刻の混雑が、Gemini の推定ではなくサーバーが埋めた値か（プランの組み方には使わず、画面で推定として出さないため）
export const crowdGap = (s: Spot, minute: number) => !!s.filled?.crowd?.includes(hourOf(minute) - FIRST_HOUR)

export function hourly(s: Spot, day: Day): number[] {
  const out: number[] = []
  for (let h = FIRST_HOUR; h <= LAST_HOUR; h++) out.push(levelAt(s, h * 60, day))
  return out
}

// 混雑する時間帯（3 以上。サーバーが埋めた時間帯は除く）を「11時〜15時」の形で
export function peakRange(s: Spot, day: Day): string | null {
  const hs = hourly(s, day)
    .map((v, i) => (v >= 3 && !s.filled?.crowd?.includes(i) ? i + FIRST_HOUR : -1))
    .filter((h) => h >= 0)
  if (!hs.length) return null
  return tr({ ja: `${hs[0]}時〜${hs[hs.length - 1] + 1}時`, en: `${hs[0]}:00–${hs[hs.length - 1] + 1}:00` })
}

// 候補の一覧に添える、空いている時間帯の一言（その日の推定から。開いている時間だけを見て、サーバーが埋めた時間帯は使わない）
export function quietHint(s: Spot, day: Day): string | null {
  const shut = s.close <= s.open
  const known = hourly(s, day)
    .map((v, i) => ({ h: i + FIRST_HOUR, v, i }))
    .filter(({ h, i }) => !s.filled?.crowd?.includes(i) && (shut || (h * 60 < s.close && (h + 1) * 60 > s.open)))
  if (!known.length) return null
  if (known.every((k) => k.v <= 1)) return tr({ ja: '一日空いています', en: 'Quiet all day' })
  const morning = known[0].v <= 1 ? known[0].h : null
  const lastBusy = known.reduce((m, k) => (k.v >= 2 ? k.h : m), -1)
  const after = known.find((k) => k.h > lastBusy)?.h ?? null
  const am = morning === null ? '' : morning <= 9 ? tr({ ja: '朝', en: 'early' }) : tr({ ja: `${morning}時台`, en: `at ${morning}:00` })
  if (morning !== null && after !== null) return tr({ ja: `${am}と${after}時から空いています`, en: `Quiet ${am} & from ${after}:00` })
  if (morning !== null) return morning <= 9 ? tr({ ja: '朝が空いています', en: 'Quiet in the morning' }) : tr({ ja: `${am}が空いています`, en: `Quiet ${am}` })
  if (after !== null) return tr({ ja: `${after}時から空きます`, en: `Quiet from ${after}:00` })
  const peak = peakRange(s, day)
  return peak ? tr({ ja: `${peak}が混雑します`, en: `Busy ${peak}` }) : null
}
