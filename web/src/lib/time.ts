import { isEn } from './i18n'

export const fmt = (m: number) => `${Math.floor(m / 60)}:${String(Math.round(m) % 60).padStart(2, '0')}`

export function fmtDur(m: number): string {
  const h = Math.floor(m / 60)
  const r = Math.round(m % 60)
  if (isEn) {
    if (!h) return `${r} min`
    return r ? `${h} hr ${r} min` : `${h} hr`
  }
  if (!h) return `${r}分`
  return r ? `${h}時間${r}分` : `${h}時間`
}

// 2026〜2028 年の祝日（振替休日・国民の休日を含む）
const HOLIDAYS = new Set([
  '2026-01-01', '2026-01-12', '2026-02-11', '2026-02-23', '2026-03-20', '2026-04-29', '2026-05-03', '2026-05-04',
  '2026-05-05', '2026-05-06', '2026-07-20', '2026-08-11', '2026-09-21', '2026-09-22', '2026-09-23', '2026-10-12',
  '2026-11-03', '2026-11-23',
  '2027-01-01', '2027-01-11', '2027-02-11', '2027-02-23', '2027-03-21', '2027-03-22', '2027-04-29', '2027-05-03',
  '2027-05-04', '2027-05-05', '2027-07-19', '2027-08-11', '2027-09-20', '2027-09-23', '2027-10-11', '2027-11-03',
  '2027-11-23',
  // 2028 年の春分の日（03-20）と秋分の日（09-22）は国立天文台の推算の日（官報の暦要項で決まるのは 2027 年 2 月 1 日）
  '2028-01-01', '2028-01-10', '2028-02-11', '2028-02-23', '2028-03-20', '2028-04-29', '2028-05-03', '2028-05-04',
  '2028-05-05', '2028-07-17', '2028-08-11', '2028-09-18', '2028-09-22', '2028-10-09', '2028-11-03', '2028-11-23',
])

export function isHoliday(iso: string): boolean {
  const d = new Date(`${iso}T00:00:00`)
  return d.getDay() === 0 || d.getDay() === 6 || HOLIDAYS.has(iso)
}

export function isoDate(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

export function nextSaturday(from = new Date()): string {
  const d = new Date(from)
  d.setDate(d.getDate() + ((6 - d.getDay() + 7) % 7 || 7))
  return isoDate(d)
}

const EN_DAY = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']
const EN_MONTH = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']

// 「11月7日（土）」「Sat, Nov 7」
export function dateLabel(iso: string): string {
  const d = new Date(`${iso}T00:00:00`)
  if (isEn) return `${EN_DAY[d.getDay()]}, ${EN_MONTH[d.getMonth()]} ${d.getDate()}`
  return `${d.getMonth() + 1}月${d.getDate()}日（${'日月火水木金土'[d.getDay()]}）`
}
