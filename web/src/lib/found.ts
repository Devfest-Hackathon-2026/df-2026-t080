// 「この付近を検索」で見つけた、候補に無い場所をプランに入れるための候補（source: 'search'）。
// 名前と営業時間は Google の Places の内容なので、画面に出している間とプランを組んでいる間だけ持つ。
// 端末とクラウドに取っておく旅には place_id と位置（30 日まで）だけを残し、開き直したら place_id から聞き直して戻す
import type { AreaData, Spot } from '../types'
import type { Found } from './areaSearch'
import { openClose, type Period } from './hours'
import { tr } from './i18n'
import type { PlaceInfo } from './place'
import { ROLE_TEXT, type Stop } from './planner'

const W = tr({
  ja: { name: '検索で入れた場所', role: '自分で見つけた場所', noCrowd: '混雑の推定はありません' },
  en: { name: 'Place from search', role: 'Your find', noCrowd: 'No crowd estimate for this place' },
})
// 名前を聞き直せないとき（Google の地図を出していないときなど）の名前
export const FOUND_NAME = W.name
export const FOUND_NO_CROWD = W.noCrowd

const HOURS = 11 // 混雑の推定の時間帯の数（8〜18 時台）
const STAY: Record<Spot['kind'], number> = { sight: 60, street: 45, food: 60, cafe: 45 }
const DAY = 24 * 60

export const foundId = (placeId: string) => `g_${placeId}`
export const isFound = (s: Pick<Spot, 'source'>) => s.source === 'search'

// 一覧と場所の画面の、場所の役の札（検索で入れた見どころは「人気スポット」「隠れた名所」と呼ばない）
export const roleText = (st: Pick<Stop, 'spot' | 'slot' | 'role'>) => (isFound(st.spot) && st.slot === 'sight' ? W.role : ROLE_TEXT[st.role])
export const FOUND_ROLE = W.role

// その日の営業時間を、候補の開く分と閉まる分にする（分からなければ終日にして、分からない印を付ける）
function withHours(s: Spot, week: Period[] | null, date: string): Spot {
  const oc = openClose(week, date)
  const filled = { ...s.filled }
  if (oc) delete filled.hours
  else filled.hours = true
  return { ...s, week, open: oc?.open ?? 0, close: oc?.close ?? DAY, filled }
}

// 検索の結果から候補を作る。混雑は推定が無いので、どの時間帯もサーバーが埋めたときと同じ「推定なし」の印を付け、
// 値は空いている側に寄せない（ふつうより 1 段上）。理由と欠点は Gemini が出していないので空にする
export function spotOfFound(f: Found, area: AreaData['area'], date: string): Spot {
  const base: Spot = {
    id: foundId(f.id),
    name: f.name,
    kind: f.kind,
    role: 'hidden',
    source: 'search',
    lat: f.lat,
    lng: f.lng,
    placeId: f.id,
    locatedAt: Math.floor(Date.now() / 1000),
    guess: [area.lat, area.lng],
    verified: true,
    stay: STAY[f.kind] ?? 60,
    open: 0,
    close: DAY,
    tags: [],
    crowd: Array(HOURS).fill(2),
    weekdayDrop: 0,
    filled: { crowd: [...Array(HOURS).keys()], weekdayDrop: true, stay: true },
    why: '',
    downside: '',
    basis: '',
  }
  return withHours(base, f.hours, date)
}

// 取っておく形にする（検索で入れた場所の名前と営業時間を外す）。変える所が無ければ同じ配列を返す
export function stripFound(places: Spot[]): Spot[] {
  if (!places.some(isFound)) return places
  return places.map((s) => {
    if (!isFound(s)) return s
    const { week: _week, ...rest } = s
    return { ...rest, name: '', open: 0, close: DAY, filled: { ...s.filled, hours: true } }
  })
}

// 取っておいた旅を読んだとき、名前の無い検索の場所に仮の名前を付ける（聞き直せたら restoreFound で戻す）
export function nameFound(places: Spot[]) {
  for (const s of places) if (isFound(s) && !s.name) s.name = FOUND_NAME
}

// まだ Places から聞き直していない、検索で入れた場所（week が無い）
export const needsRestore = (s: Spot) => isFound(s) && !!s.placeId && s.week === undefined

// Places から聞き直した名前・位置・営業時間を戻す
export function restoreFound(s: Spot, info: PlaceInfo | null, date: string): Spot {
  if (!info) return { ...s, week: null }
  const pos = typeof info.lat === 'number' && typeof info.lng === 'number' ? { lat: info.lat, lng: info.lng, locatedAt: Math.floor(Date.now() / 1000) } : {}
  return withHours({ ...s, ...pos, name: info.name || s.name }, info.periods ?? null, date)
}

// 旅の日付が変わったら、検索で入れた場所の開く分と閉まる分を、その日の営業時間に合わせる。変わらなければ同じ data を返す
export function foundHoursOn(data: AreaData, date: string): AreaData {
  let changed = false
  const places = data.places.map((s) => {
    if (!isFound(s) || s.week === undefined) return s
    const next = withHours(s, s.week, date)
    if (next.open === s.open && next.close === s.close && !!next.filled?.hours === !!s.filled?.hours) return s
    changed = true
    return next
  })
  return changed ? { ...data, places } : data
}
