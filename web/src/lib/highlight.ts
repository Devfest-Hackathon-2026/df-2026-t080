// その日の楽しみを 1 行の言葉にする（場所の種類・タグ・時刻から。Gemini は使わない）
import type { Stop } from './planner'
import { sunsetMin } from './sun'
import { isoDate } from './time'
import { isEn, tr } from './i18n'

// 食事のタグと、添える言葉（日本語・英語）
const MEAL: [string, string, string][] = [
  ['そば', 'そば', 'soba at'],
  ['ラーメン', 'ラーメン', 'ramen at'],
  ['魚', '魚料理', 'seafood at'],
  ['肉', '肉料理', 'meat dishes at'],
  ['洋食', '洋食', 'Western food at'],
  ['和食', '和食', 'Japanese food at'],
  ['甘味', '甘味', 'sweets at'],
]
// 見どころのタグと、添える言葉と、名前にこの字（英語の名前はこの語）があれば言葉を添えない字
const SIGHT: [string, string, string, string[]][] = [
  ['竹', '竹林', 'the bamboo grove at', ['竹', 'bamboo']],
  ['庭', '庭', 'the garden at', ['庭', '園', 'garden']],
  ['海', '海', 'the sea at', ['海', '浜', 'beach', 'sea']],
  ['景色', '眺め', 'the view from', ['展望', '眺', 'view', 'observ']],
  ['温泉', '温泉', 'hot springs at', ['温泉', '湯', 'onsen', 'hot spring']],
]
const STREET_FOOD = ['市場', '甘味']
// 食事の希望の札（「郷土料理」の札の「たこ焼き」）の言葉を、店の言葉にしてよいタグ
const MEAL_WISH = ['そば', 'ラーメン', '魚', '肉', '洋食', '和食', '甘味', '郷土料理', '中華', 'カレー']
export type WishLabel = { tag: string; label: string }
const MAX_LEN = isEn ? 66 : 26

const W = tr({
  ja: { lunch: 'での昼食', dinner: 'での夕食', sweets: 'の甘味', rest: 'でのひと休み', night: 'の夜景', streetFood: 'の食べ歩き', shopping: 'での買い物', stroll: 'の散策' },
  en: { lunch: 'lunch at', dinner: 'dinner at', sweets: 'sweets at', rest: 'a break at', night: 'the night view at', streetFood: 'street food at', shopping: 'shopping at', stroll: 'a stroll through' },
})
const has = (name: string, words: string[]) => words.some((x) => name.toLowerCase().includes(x))
const meal = (m: [string, string, string]) => (isEn ? m[2] : `の${m[1]}`)
const sight = (m: [string, string, string, string[]]) => (isEn ? m[2] : `の${m[1]}`)

// [場所の名前, 添える言葉]。言葉が無いときは名前だけ
function phrase(s: Stop, date: string, wish: string[], labels: WishLabel[]): [string, string] {
  const { name, tags } = s.spot
  if (s.slot === 'lunch' || s.slot === 'dinner') {
    const asked = labels.find((c) => MEAL_WISH.includes(c.tag) && tags.includes(c.tag) && c.label.trim() && c.label.length <= (isEn ? 24 : 10))
    if (asked) return [name, isEn ? `${asked.label.charAt(0).toLowerCase()}${asked.label.slice(1)} at` : `の${asked.label}`]
    const hit = MEAL.find(([t]) => wish.includes(t) && tags.includes(t)) ?? MEAL.find(([t]) => tags.includes(t))
    return [name, hit ? meal(hit) : s.slot === 'lunch' ? W.lunch : W.dinner]
  }
  if (s.slot === 'cafe') return [name, tags.includes('甘味') ? W.sweets : W.rest]
  const set = sunsetMin(date, s.spot.lat, s.spot.lng)
  if (tags.includes('夜景') && set !== null && s.arrive >= set && !has(name, ['夜', 'night'])) return [name, W.night]
  if (s.spot.kind === 'street') {
    if (tags.some((t) => STREET_FOOD.includes(t))) return [name, W.streetFood]
    if (tags.includes('買い物')) return [name, W.shopping]
    return [name, tags.includes('散策') ? W.stroll : '']
  }
  const hit = SIGHT.find(([t, , , skip]) => tags.includes(t) && !has(name, skip))
  return [name, hit ? sight(hit) : '']
}

// 名前と言葉をつなぐ（日本語は「錦市場の食べ歩き」、英語は「the garden at Nanzen-ji Tenju-an」）。
// 日本語で名前に空白があるときは、名前を「」でくくる（高徳院と「海沿いの キコリ食堂」の魚料理）
const said = ([name, word]: [string, string]) => (isEn ? (word ? `${word} ${name}` : name) : `${/[\s\u3000]/.test(name.trim()) ? `「${name.trim()}」` : name}${word}`)
const capital = (s: string) => s.charAt(0).toUpperCase() + s.slice(1)

// ['南禅寺 天授庵の庭と', '錦市場の食べ歩き']（つなげると 1 行の文。折り返すときは区切りで折る）。
// 同じ言葉は 2 度添えない。長すぎるときは 1 つだけ。labels: 条件の札（食事の希望に合う店は、札の言葉で書く）
export function highlightParts(stops: Stop[], date: string, wish: string[], labels: WishLabel[] = []): string[] {
  const parts = stops.map((s) => phrase(s, date, wish, labels))
  if (!parts.length) return []
  const first = capital(said(parts[0]))
  if (parts.length < 2) return [first]
  const [name, word] = parts[1]
  const second = said([name, word && word !== parts[0][1] ? word : ''])
  if (first.length + 1 + second.length > MAX_LEN) return [first]
  return isEn ? [`${first} and`, second] : [`${first}と`, second]
}

// プランの日まであと何日か（今日は 0）
export function daysUntil(date: string, today = new Date()): number {
  const a = new Date(`${date}T00:00:00`).getTime()
  const b = new Date(`${isoDate(today)}T00:00:00`).getTime()
  return Math.round((a - b) / 86400000)
}
