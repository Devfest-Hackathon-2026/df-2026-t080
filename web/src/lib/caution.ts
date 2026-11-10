// スケジュールの行に赤い 1 行で出す注意（場所のデータから読み取る）
import type { Spot } from '../types'
import { sunsetMin } from './sun'

// 予約のことを書いた文（英語の候補は英語で書いてある）
const RESERVE = /予約|reserv|book(ing|ed)? (ahead|in advance)|advance booking/i
// 「予約不要」「予約不可」など、予約が要らないことを書いた文
const NO_RESERVE =
  /予約(は|が)?(不要|不可|できません|を受け付けていません)|no reservations?|reservations? (are |is )?(not|aren't|isn't) (needed|required|accepted|taken)|without (a )?reservation/i

// 注意点か混雑の説明に、予約のことが書いてある
export function needsReserve(s: Spot): boolean {
  const t = `${s.downside ?? ''} ${s.basis ?? ''}`
  return RESERVE.test(t) && !NO_RESERVE.test(t)
}

// 暗くなると楽しめない屋外の見どころか（建物の中・店・夜に向いた場所は除く）
const NOT_OUTDOOR = ['美術', '温泉', '買い物', '夜景', '屋内', '古着', '雑貨', '工芸', '本', '音楽', '映画', '酒', '夜']
export const isOutdoor = (s: Spot) => (s.kind === 'sight' || s.kind === 'street') && s.best !== 'evening' && !s.tags.some((t) => NOT_OUTDOOR.includes(t))

// 日の入りより後に着く屋外の見どころか（iso はプランの日付）
export function afterSunset(s: Spot, arrive: number, iso: string): boolean {
  if (!isOutdoor(s)) return false
  const set = sunsetMin(iso, s.lat, s.lng)
  return set !== null && arrive > set
}
