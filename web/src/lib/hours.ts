// Google の Places の曜日ごとの営業時間（サーバーが periods を詰めた形）から、旅の日の営業時間と、その時刻に開いているかを出す。
// Places の内容なので取っておかない（画面に出している間と、プランを組んでいる間だけ持つ）
import { fmt } from './time'
import { tr } from './i18n'

// [開く曜日, 開く分, 閉まる曜日, 閉まる分]。曜日は日曜が 0。閉まる側が null なら 24 時間営業
export type Period = [number, number, number | null, number | null]

const DAY = 24 * 60

const weekday = (iso: string) => new Date(`${iso}T00:00:00`).getDay()

// その日（YYYY-MM-DD）に開いている時間（0 時からの分。日をまたぐ所は 24 時より先の分）。休みの日は []、分からなければ null。
// carry: 前の日に開いて、日をまたいでこの日に閉まる分も入れる
export function dayHours(periods: Period[] | null | undefined, iso: string, carry = true): [number, number][] | null {
  if (!periods?.length) return null
  const d = weekday(iso)
  const prev = (d + 6) % 7
  if (periods.some(([, , cd]) => cd === null)) return [[0, DAY]]
  const out: [number, number][] = []
  for (const [od, om, cd, cm] of periods) {
    if (cd === null || cm === null) continue
    const span = ((cd - od + 7) % 7) * DAY + cm - om
    if (od === d) out.push([om, om + (span > 0 ? span : 7 * DAY)])
    // 前の日に開いて、日をまたいでこの日に閉まる分
    else if (carry && od === prev && om + span > DAY) out.push([0, om + span - DAY])
  }
  return out.sort((a, b) => a[0] - b[0])
}

export const openAt = (spans: [number, number][], minute: number) => spans.some(([a, b]) => minute >= a && minute < b)

// 予定の時間（from〜to）のどこかで開いているか
export const openDuring = (spans: [number, number][], from: number, to: number) => spans.some(([a, b]) => a < to && b > from)

const T = tr({
  ja: {
    day: (iso: string) => `${'日月火水木金土'[weekday(iso)]}曜`,
    span: (a: number, b: number) => (a === 0 && b >= DAY ? '24時間営業' : `${fmt(a)}〜${b > DAY ? '翌' : ''}${fmt(b % DAY)}`),
    sep: '、',
    shut: (iso: string) => `${'日月火水木金土'[weekday(iso)]}曜は定休日`,
  },
  en: {
    day: (iso: string) => ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'][weekday(iso)],
    span: (a: number, b: number) => (a === 0 && b >= DAY ? 'Open 24 hours' : `${fmt(a)}–${fmt(b % DAY)}${b > DAY ? ' (next day)' : ''}`),
    sep: ', ',
    shut: (iso: string) => `Closed ${['Sundays', 'Mondays', 'Tuesdays', 'Wednesdays', 'Thursdays', 'Fridays', 'Saturdays'][weekday(iso)]}`,
  },
})

// 「土曜 8:30〜17:00」「土曜 18:00〜翌1:00」「土曜は定休日」（前の日から続いて開いている分は書かない）。分からなければ null
export function dayHoursText(periods: Period[] | null | undefined, iso: string): string | null {
  const own = dayHours(periods, iso, false)
  if (!own) return null
  if (!own.length) return T.shut(iso)
  return `${T.day(iso)} ${own.map(([a, b]) => T.span(a, b)).join(T.sep)}`
}

// プランを組むための、その日の開く分と閉まる分（いくつかに分かれていれば、最初に開く分と最後に閉まる分）。
// 休みの日は開く分と閉まる分が同じ。分からなければ null
export function openClose(periods: Period[] | null | undefined, iso: string): { open: number; close: number } | null {
  const spans = dayHours(periods, iso)
  if (!spans) return null
  if (!spans.length) return { open: 0, close: 0 }
  return { open: spans[0][0], close: Math.min(DAY, Math.max(...spans.map(([, b]) => b))) }
}
