// スケジュールを組む。時刻の計算と回る順番は Gemini にさせない（間に合わないスケジュールを作るため）。
//
// 組み方（初めて組むとき・日時や条件を変えたとき）
//   1. 行きたい人気スポット・選び直した場所・昼食（・夕食）を、いちばん損の少ない位置に入れる。
//   2. 残りの候補から「行く値打ち − 増える損（移動・待ち・混雑・遅れ・余る時間）」がいちばん大きい場所を足す。得がなくなるまで、到着の時刻まで繰り返す。
//   最後の区間は到着地（data.end）へ向かう。到着地が無い旅は、出発地に戻る。
//   3. 順番を入れ替えて損が減るなら入れ替える。
//   4. それでも到着の時刻より早く終わるときは、滞在を長めにとる。
// 1 か所だけ変えたとき（base があるとき）は、前のプランの並びを土台にして、変えた所の前後だけを直す
// （ほかの場所まで入れ替わると、何が変わったのか分からなくなるため）。
// 本番では Cloud Run で動かし、Gemini には「なぜこの順か」の説明だけを書かせる。
import type { AreaData, Condition, Point, Spot, TransitRoute, TransitTable } from '../types'
import { distM, route, walkMin, type Leg, type LegMode } from './geo'
import { crowdGap, FIRST_HOUR, LAST_HOUR, levelAt, LEVEL_PRED, peakRange, type Day } from './crowd'
import { isEn, tr } from './i18n'
import { isOutdoor } from './caution'

export type Slot = 'sight' | 'lunch' | 'dinner' | 'cafe'
export type Pace = 'slow' | 'normal' | 'many'

export type PlanInput = {
  conds: Condition[]
  must: string[]
  day: Day
  start: number
  end: number
  pinned: { id: string; slot: Slot }[]
  banned: string[]
  overrides: Record<string, TransitRoute> // 区間の実際の経路（legKey ごと）
  modes?: Record<string, LegMode> // 本人が選んだ区間の手段（legKey ごと。無い区間は自動）
  stayFix: Record<string, number> // 本人が決めた滞在の長さ（分）。組み直しても変えない
  focus: string[] // 「この近くの場所を足す」と選んだ場所
  skipDistricts: string[] // 回らない地区
  base: BaseItem[] | null // 前のプランの並び。あるときは並びを保ったまま直す
  loose?: string[] // 必ず入れる場所のうち、到着の時刻に入りきらないときは外してよい場所（調整の頼みで名前の出なかった場所）
  pace?: Pace // 回り方。見どころの滞在を、ゆっくり（長め）・たくさん（短め）にする
  moveLess?: boolean // 移動を少なくする（移動の損を重く見る）
  calm?: boolean // 混雑をもっと避ける（混雑の損を重く見る）
  busTable?: TransitTable // 時刻表から作った、バスで戸口から戸口までの目安（あれば電車・バスの時間に使う）
  sunset?: number | null // その日のエリアの日の入り（0 時からの分）。屋外の見どころを暗くなってから入れない
  fill?: boolean // 空いた時間に、選んでいない見どころ・休憩も足すか（false のときは、選んだ場所と食事だけで組む）
  leeway?: number // 到着の時刻より早く終わってもよい時間（分）。この分までは、早く終わっても損にしない
}

export type BaseItem = { id: string; slot: Slot }
export type TimeNote = 'missed' | 'other' | null

// 役割（値は中で使う印。画面に出すときは roleText で言語に合わせる）
export type RoleLabel = '人気スポット' | '隠れた名所' | '昼食' | '夕食' | '休憩'
export const ROLE_TEXT: Record<RoleLabel, string> = tr({
  ja: { 人気スポット: '人気スポット', 隠れた名所: '隠れた名所', 昼食: '昼食', 夕食: '夕食', 休憩: '休憩' },
  en: { 人気スポット: 'Popular', 隠れた名所: 'Hidden gem', 昼食: 'Lunch', 夕食: 'Dinner', 休憩: 'Break' },
})

export type Stop = {
  spot: Spot
  slot: Slot
  leg: Leg
  arrive: number
  depart: number
  stay: number
  wait: number
  ease: number // 前の場所から着くまでの、移動のほかのゆとり（分）
  level: number
  estimated: boolean // 混雑の推定がある時間帯（8〜18 時台で、サーバーが埋めた値でない）か
  closeOver: boolean // 閉まる時刻を過ぎても滞在する
  timeNote: TimeNote // 入れた経路の時刻を使えなかったとき（間に合わない・時刻が離れすぎ）
  role: RoleLabel
  reason: string
  fits: string[] // 理由に「希望の〜に合います」と書いた、合った希望（条件の言葉）。合わなければ空
  finale: boolean // 一日の最後に向いた場所で終えるか（最後の場所だけ）
}

export type Plan = {
  stops: Stop[]
  back: Leg
  backTimeNote: TimeNote
  leave: number // 出発地を出る時刻（入れた経路の出発に合わせて遅らせることがある）
  finish: number
  crowded: number // 混雑（3 以上）の場所にいる分
  moving: number
  ease: number // 場所と場所の間のゆとりの合計（分）
  backEase: number // 最後の場所から戻る区間の、移動のほかのゆとり（分。選んだ便を待つ分）
  score: number
  dropped: string[] // 前のプランから、時間が足りずに外した場所
  added: string[] // 前のプランに無く、空いた時間に足した場所
}

type Item = { spot: Spot; slot: Slot; extra: number; from?: number } // from: この時刻より前には着かない（よくある回り方の食事の時刻）

const CROWD_COST = [0, 2, 5, 10, 16] // 1 時間あたり（人混みの疲れ）
// 混雑すると、行く値打ちがこの割合だけ下がる（行列・人混みで楽しめない）
const CROWD_LOSS = [0, 0.05, 0.15, 0.45, 0.7]
const TRAVEL_COST = 0.9 // 1 分あたり
const TRANSIT_COST = 8 // 乗り物に乗るたび（待ち・乗り換えの手間）
const WAIT_COST = 0.8
const LATE_COST = 12
const IDLE_COST = 0.5 // 到着の時刻より早く終わる 1 分あたり（時間が余るのも損）
const MEAL_DRIFT_COST = 3
// 食事の希望（そばなど）に合う店だけを昼食・夕食に選ぶ
const GENERIC_TAGS = new Set(['有名', '静か'])
// 名前や滞在から朝食・軽食の店とみなす物は、昼食・夕食にしない
const NOT_MEAL = /朝食|モーニング|breakfast|bakery|ベーカリー|パン屋/i
const MEAL_MIN_STAY = 30
// 混む時間を避けたい場所（希望で名指しした場所・人気スポット。「混雑を避けたい」ときは強める）と食事の店（食事の時間帯の中で）を、その日いちばん空く時間より混む時間に入れる損の重み（行く値打ちに掛ける）
const TIMING_MUST = 0.9
const TIMING_FAMOUS = 0.6
const TIMING_FAMOUS_ANY = 0.35
const TIMING_MEAL = 0.5
// 日の入りより後に屋外の見どころに着く損（暗くて楽しめない）
const DARK_COST = 60
// 「移動を少なく」のときは、1 区間のうち NEAR 分を超えた分をこの倍だけ重く見る（近い場所をつなぎ、時間いっぱい回る）
const NEAR = 12
const FAR_COST = 4
const WINDOWS: Record<Exclude<Slot, 'sight'>, [number, number, number]> = {
  lunch: [11 * 60, 13 * 60 + 30, 12 * 60 + 15],
  dinner: [17 * 60 + 30, 19 * 60 + 30, 18 * 60 + 30],
  cafe: [14 * 60, 16 * 60 + 30, 15 * 60],
}
// 一日の最後の場所の値打ち（endFit が 1 のとき）と、その日いちばんの見どころ（山場）が空いているときの値打ち
const END_VALUE = 25
const PEAK_VALUE = 20
const PEAK_CALM = [1, 1, 0.6, 0, -0.5]
const CALM_TAGS = ['庭', '景色', '夜景', '竹', '海', '温泉', '水辺', '自然', '花']
// 場所と場所の間に入れるゆとり（分。出発地からの区間と戻りの区間には入れない）
const EASE: Record<Pace, number> = { slow: 15, normal: 10, many: 0 }
const MAX_STOPS = 12
export const TUNING = { iterations: 6000, restarts: 2, theme: 18, themeRepeat: 8 }
const FORCED = 1000

export const isSight = (s: Spot) => s.kind === 'sight' || s.kind === 'street'
const capStay = (s: Spot) => Math.min(s.stay, s.kind === 'food' ? 70 : s.kind === 'cafe' ? 45 : 90)
let stayFix: Record<string, number> = {}
let paceK = 1
const baseStay = (s: Spot) => Math.max(5, stayFix[s.id] ?? (isSight(s) && paceK !== 1 ? Math.min(120, Math.round((capStay(s) * paceK) / 5) * 5) : capStay(s)))
const isMeal = (slot: Slot) => slot !== 'sight'

const travelCost = (min: number, c: { moveLess: boolean }) => min * TRAVEL_COST + (c.moveLess ? Math.max(0, min - NEAR) * TRAVEL_COST * FAR_COST : 0)

type Ctx = {
  data: AreaData
  input: PlanInput
  tags: string[]
  quiet: number
  fame: boolean
  focus: Spot[]
  moveLess: boolean
  ease: number
  taste: Set<string>
  mealWish: string[]
  sunset: number | null
  bestLevel: Map<string, number>
  onlyChosen: boolean
}

function ctxOf(data: AreaData, input: PlanInput): Ctx {
  const tags = input.conds.map((c) => c.tag)
  stayFix = input.stayFix ?? {}
  paceK = input.pace === 'slow' ? 1.4 : input.pace === 'many' ? 0.65 : 1
  const focus = data.places.filter((p) => (input.focus ?? []).includes(p.id))
  const quiet = (tags.includes('静か') ? 1.3 : 1) * (input.calm ? 1.7 : 1)
  // 自分で選んだ場所（行きたい場所・選んだ店）のタグ。空いた時間に足す場所を、選んだ場所に近い物にする
  const chosen = new Set([...input.must, ...input.pinned.map((p) => p.id)])
  const taste = new Set(data.places.filter((p) => chosen.has(p.id)).flatMap((p) => p.tags.filter((x) => !TASTE_SKIP.has(x))))
  // 食事の希望: 有名・静か 以外の条件で、そのタグの付いた店が候補にある物（「昼はおいしいそば」のそば）
  const mealWish = tags.filter((t) => !GENERIC_TAGS.has(t) && data.places.some((p) => p.kind === 'food' && p.tags.includes(t)))
  return {
    data,
    input,
    tags,
    quiet,
    fame: tags.includes('有名'),
    focus,
    moveLess: !!input.moveLess,
    ease: EASE[input.pace ?? 'normal'],
    taste,
    mealWish,
    sunset: input.sunset ?? null,
    bestLevel: new Map(),
    onlyChosen: input.fill === false,
  }
}

// 通れない・入れないと書かれた場所（自分で選んでいなければプランに足さない）
const CLOSED = /通行止め|通り抜け(禁止|でき(ない|ません))|立ち?入り?(禁止|でき(ない|ません))|閉鎖|近づ(け|くことができ)(ない|ません)|接近(禁止|でき(ない|ません))|closed to the public|no entry|off[- ]limits/i
const closedLike = (s: Spot) => CLOSED.test(`${s.why ?? ''} ${s.downside ?? ''} ${s.basis ?? ''}`)
// 同じ施設を別の名前で 2 つ持つ候補（「竹寺 報国寺」と「報国寺」）。名前の片方がもう片方を含み、400 m 以内
const bare = (n: string) => n.replace(/[（(][^）)]*[）)]/g, '').replace(/[\s・　]/g, '')
function sameFacility(a: Spot, b: Spot): boolean {
  const x = bare(a.name)
  const y = bare(b.name)
  return x.length >= 2 && y.length >= 2 && (x.includes(y) || y.includes(x)) && distM(a, b) < 400
}
// 足さない場所: 通れない場所と、選んだ場所（なければ先に出た候補）と同じ施設の候補
function notToAdd(data: AreaData, keep: Set<string>): string[] {
  const out: string[] = []
  const seen: Spot[] = data.places.filter((p) => keep.has(p.id))
  for (const p of data.places) {
    if (keep.has(p.id)) continue
    if (closedLike(p) || seen.some((q) => sameFacility(p, q))) out.push(p.id)
    else seen.push(p)
  }
  return out
}

// 昼食・夕食に向いた店か（朝食・軽食の店と、滞在の短い店は除く）
const mealShop = (s: Spot) => s.kind === 'food' && s.stay >= MEAL_MIN_STAY && !NOT_MEAL.test(s.name) && !s.tags.some((t) => NOT_MEAL.test(t))
// その枠に入れてよい店か。食事の希望があり、合う店がその枠で開いているときは、合う店だけにする
function mealOk(s: Spot, slot: Slot, c: Ctx): boolean {
  if (slot === 'cafe') return s.kind === 'cafe'
  if (slot === 'sight' || !mealShop(s) || !opensFor(s, slot)) return false
  if (!c.mealWish.length || !c.data.places.some((p) => mealShop(p) && opensFor(p, slot) && p.tags.some((t) => c.mealWish.includes(t)))) return true
  return s.tags.some((t) => c.mealWish.includes(t))
}
const isDark = (s: Spot, arrive: number, c: Ctx) => c.sunset !== null && isOutdoor(s) && arrive > c.sunset
// 混む時間を避けたい場所か（重み。0 は気にしない）
function timingWeight(s: Spot, slot: Slot, c: Ctx): number {
  if (slot === 'lunch' || slot === 'dinner') return TIMING_MEAL
  if (slot !== 'sight' || !isSight(s)) return 0
  if (c.input.must.includes(s.id)) return TIMING_MUST
  if (s.role !== 'famous') return 0
  return c.quiet > 1 ? TIMING_FAMOUS : TIMING_FAMOUS_ANY
}

// その日のうちで、その場所がいちばん空く混み具合（開いている間・出発から到着まで・屋外は日の入りまでに着く範囲で 15 分ごとに見る）
function bestLevelOf(s: Spot, slot: Slot, c: Ctx): number {
  const key = `${s.id}|${slot}`
  const hit = c.bestLevel.get(key)
  if (hit !== undefined) return hit
  const stay = baseStay(s)
  // 食事は、その食事の時間帯の中でいちばん空く時刻と比べる
  const meal = slot === 'lunch' || slot === 'dinner' ? WINDOWS[slot] : null
  const from = Math.max(c.input.start, s.open, meal ? meal[0] : 0)
  let to = Math.min(s.close, c.input.end) - stay
  if (meal) to = Math.min(to, meal[1])
  if (c.sunset !== null && isOutdoor(s)) to = Math.min(to, c.sunset)
  let best = 4
  for (let a = from; a <= to; a += 15) best = Math.min(best, levelAt(s, a + stay / 2, c.input.day))
  if (to < from) best = levelAt(s, from + stay / 2, c.input.day)
  c.bestLevel.set(key, best)
  return best
}

const matchCount = (s: Spot, tags: string[]) => s.tags.filter((t) => tags.includes(t)).length
// 選んだ場所に近いかを見るときに数えないタグ（どの場所にも付きやすく、好みを表さない）
const TASTE_SKIP = new Set(['有名', '静か', '歩かない', '屋内', '朝', '夜', '子ども'])
// 選んだ場所と同じタグ 1 つごとの加点（2 つまで）と、1 つも同じタグが無い場所の減点
const TASTE_BONUS = 8
const TASTE_MISS = 6

export function famousSights(data: AreaData): Spot[] {
  return data.places.filter((s) => isSight(s) && s.role === 'famous').slice(0, 10)
}

// 行く値打ち
function value(s: Spot, slot: Slot, c: Ctx): number {
  let v: number
  const pop = s.popularity ?? 3
  if (slot === 'sight') v = s.role === 'famous' ? (s.kind === 'street' ? 28 + pop * 6 : 36 + pop * 9) : s.kind === 'street' ? 20 + pop * 2 : 24 + pop * 3
  else if (slot === 'cafe') v = 16
  else v = 24
  if (s.theme && s.role === 'hidden' && isSight(s) && slot === 'sight') v += TUNING.theme
  v += matchCount(s, c.tags) * 12
  if (s.role === 'hidden' && c.tags.includes('静か')) v += 8
  if (s.role === 'famous' && slot === 'sight' && c.tags.includes('有名')) v += 5 + pop * 4
  if (s.source === 'wish') v += 15
  if ((slot === 'lunch' || slot === 'dinner') && s.tags.some((t) => c.mealWish.includes(t))) v += 30
  if (s.verified === false) v -= 15
  // 「この近くの場所を足す」と選んだ場所の近く（1.5 km 以内）を優先し、遠い所は少し下げる
  if (c.focus.length && slot === 'sight' && !c.input.must.includes(s.id)) v += c.focus.some((f) => distM(f, s) < 1500) ? 22 : -8
  const forced = c.input.must.includes(s.id) || c.input.pinned.some((p) => p.id === s.id)
  if (!forced && c.taste.size && slot === 'sight') {
    const same = s.tags.filter((x) => c.taste.has(x)).length
    v += same ? Math.min(2, same) * TASTE_BONUS : -TASTE_MISS
  }
  if (forced) v += FORCED
  return v
}

const opensFor = (s: Spot, slot: Slot) => {
  if (slot === 'sight') return true
  const [from, to] = WINDOWS[slot]
  return s.open <= to && s.close >= from + 45
}

type SimStop = Omit<Stop, 'role' | 'reason' | 'fits' | 'finale'>
// bad: 閉まる時刻を過ぎて滞在する場所の数
type Sim = { stops: SimStop[]; cost: number; loss: number; finish: number; crowded: number; moving: number; ease: number; backEase: number; back: Leg; backTimeNote: TimeNote; leave: number; bad: number }

const hm = (s?: string): number | null => {
  const m = /^(\d{1,2}):(\d{2})/.exec(s ?? '')
  return m ? Number(m[1]) * 60 + Number(m[2]) : null
}

// 区間をいつ出ていつ着くか。入れた経路（スクリーンショット）に時刻があれば、その便に合わせる。
// 便に間に合わないとき（missed）と、便が 2 時間以上先のとき（other）は所要時間だけを使い、画面で知らせる
function legTimes(leg: Leg, t: number): { leaveAt: number; arrive: number; note: TimeNote } {
  const dep = hm(leg.real?.depart)
  const arr = hm(leg.real?.arrive)
  if (dep !== null && arr !== null && arr > dep) {
    if (t <= dep && dep - t <= 120) return { leaveAt: dep, arrive: arr, note: null }
    return { leaveAt: t, arrive: t + leg.minutes, note: t > dep ? 'missed' : 'other' }
  }
  return { leaveAt: t, arrive: t + leg.minutes, note: null }
}

const inEstimate = (minute: number) => minute >= FIRST_HOUR * 60 && minute < (LAST_HOUR + 1) * 60

// 一日の最後に向いているか（-0.5〜1）。その時刻に空いていて、庭・景色・夕方が良い場所・カフェなどの落ち着いた所ほど高い。混んでいる所は下げる
function endFit(s: Spot, slot: Slot, arrive: number, level: number, dark: boolean): number {
  if (level >= 3 || dark) return -0.5
  const calm = level <= 1 ? 1 : 0.6
  if (slot === 'cafe') return 0.9 * calm
  if (isMeal(slot)) return (s.tags.includes('静か') ? 0.6 : 0.3) * calm
  if (s.best === 'evening' && arrive >= 16 * 60 + 30) return calm
  if (s.tags.some((t) => CALM_TAGS.includes(t))) return calm
  return (s.kind === 'street' ? 0.3 : s.tags.includes('静か') ? 0.7 : 0.4) * calm
}

function simulate(items: Item[], c: Ctx): Sim {
  const home = c.data.start
  const goal = c.data.end ?? home
  let t = c.input.start
  let leave = c.input.start
  let pos: Point = home
  let cost = 0
  let crowded = 0
  let moving = 0
  let easeTotal = 0
  let loss = 0
  const stops: SimStop[] = []
  let peak = -1
  let peakValue = -Infinity
  // 便の出発までの待ちは、前の場所の滞在を延ばさず、その区間のゆとりにする（出発地からの区間は、出発を遅らせる）
  const depart = (leg: Leg): { note: TimeNote; gap: number } => {
    const lt = legTimes(leg, t)
    let gap = Math.max(0, lt.leaveAt - t)
    if (gap > 0) {
      cost += gap * WAIT_COST * 0.5
      if (!stops.length) {
        leave = lt.leaveAt
        gap = 0
      }
    }
    if (lt.note) cost += 20
    moving += lt.arrive - lt.leaveAt
    t = lt.arrive
    return { note: lt.note, gap }
  }
  for (const it of items) {
    const s = it.spot
    const leg = route(pos, s)
    const { note: timeNote, gap } = depart(leg)
    cost += travelCost(leg.minutes, c) + (leg.mode === 'transit' ? TRANSIT_COST : 0)
    if (leg.real) cost -= 15 // 本人が入れた実際の経路の区間は、なるべくそのまま使う
    const extra = stops.length ? c.ease : 0
    t += extra
    const ease = extra + gap
    easeTotal += ease
    if (it.from !== undefined && t < it.from) t = it.from
    let wait = 0
    if (t < s.open) {
      wait = s.open - t
      t = s.open
      cost += wait * WAIT_COST
    }
    const stay = baseStay(s) + it.extra
    const arrive = t
    if (arrive + stay > s.close) cost += 5000
    if (isMeal(it.slot)) {
      const [from, to, target] = WINDOWS[it.slot as Exclude<Slot, 'sight'>]
      if (arrive < from || arrive > to) cost += 60 + Math.abs(arrive - target) * MEAL_DRIFT_COST
    }
    // 向いている時間帯から外れると損（夜の通りを朝に、など）
    if (it.slot === 'sight') {
      if (s.best === 'evening' && arrive < 16 * 60 + 30) cost += 40
      else if (s.best === 'morning' && arrive >= 11 * 60) cost += 15
      else if (s.best === 'daytime' && arrive >= 17 * 60 + 30) cost += 15
    }
    const level = levelAt(s, arrive + stay / 2, c.input.day)
    // 混雑の滞在と疲れは、時間帯ごとに重なった分だけ数える（10:50〜11:20 の滞在で 11 時台だけ混むなら 20 分）
    for (let a = arrive; a < arrive + stay; ) {
      const b = Math.min(arrive + stay, (Math.floor(a / 60) + 1) * 60)
      const lv = levelAt(s, a, c.input.day)
      if (lv >= 3) crowded += b - a
      cost += ((CROWD_COST[lv] * (b - a)) / 60) * c.quiet
      a = b
    }
    if (it.slot === 'sight' && isDark(s, arrive, c)) cost += DARK_COST
    // そのエリアの代表（知名度 5）や「有名な場所」の希望があるときは、混雑していても行く値打ちを残す
    const icon = s.role === 'famous' && it.slot === 'sight' ? (c.fame ? 0.45 : (s.popularity ?? 3) >= 5 ? 0.6 : 1) : 1
    const lossRate = CROWD_LOSS[level] * c.quiet * icon
    const v = Math.max(0, value(s, it.slot, c) % FORCED)
    loss += v * Math.min(0.9, lossRate)
    const tw = timingWeight(s, it.slot, c)
    if (tw) cost += v * tw * Math.max(0, CROWD_LOSS[level] - CROWD_LOSS[bestLevelOf(s, it.slot, c)])
    if (it.slot === 'sight' && v > peakValue) {
      peak = stops.length
      peakValue = v
    }
    t = arrive + stay
    stops.push({ spot: s, slot: it.slot, leg, arrive, depart: t, stay, wait, ease, level, estimated: inEstimate(arrive + stay / 2) && !crowdGap(s, arrive + stay / 2), closeOver: false, timeNote })
    pos = s
  }
  const last = stops[stops.length - 1]
  if (last) cost -= END_VALUE * endFit(last.spot, last.slot, last.arrive, last.level, last.slot === 'sight' && isDark(last.spot, last.arrive, c))
  if (peak >= 0) cost -= PEAK_VALUE * PEAK_CALM[stops[peak].level]
  // 一度行った場所のすぐ近くに、あとで戻る順番は損（行ったり来たりになる）
  for (let i = 0; i < items.length; i++) {
    for (let j = i + 2; j < items.length; j++) {
      const a = items[i].spot
      const b = items[j].spot
      const dy = (a.lat - b.lat) * 111000
      const dx = (a.lng - b.lng) * 91000
      if (dx * dx + dy * dy < 250 * 250) cost += 30
    }
  }
  cost += wander(items, home, goal)
  const back = route(pos, goal)
  const { note: backTimeNote, gap: backEase } = depart(back)
  easeTotal += backEase
  cost += travelCost(back.minutes, c) + (back.mode === 'transit' ? TRANSIT_COST : 0)
  const finish = t
  if (finish > c.input.end) cost += (finish - c.input.end) * LATE_COST
  else cost += Math.max(0, c.input.end - (c.input.leeway ?? 0) - finish) * IDLE_COST
  let bad = 0
  for (const st of stops) {
    st.closeOver = st.depart > st.spot.close
    if (st.closeOver) bad++
  }
  return { stops, cost, loss, finish, crowded, moving, ease: easeTotal, backEase, back, backTimeNote, leave, bad }
}

// 地図の上で行き来する順の損。移動の時間（電車・バスの目安）が短く出ても、地図の上で大きく往復する順は選ばない
//   まっすぐの道のり（出発地から到着地まで）の長さ・東西や南北に引き返した道のり・線の交わり・同じ地区や近くの塊を離れてから戻ること
export const WANDER = { km: 3, swing: 60, cross: 40, revisit: 40 }
const NEAR_M = 1000
const AWAY_M = 1500
function wander(items: Item[], home: Point, goal: Point = home): number {
  const kx = 111320 * Math.cos((home.lat * Math.PI) / 180)
  const ky = 110570
  const n = items.length
  const x = [0]
  const y = [0]
  for (const it of items) {
    x.push((it.spot.lng - home.lng) * kx)
    y.push((it.spot.lat - home.lat) * ky)
  }
  x.push((goal.lng - home.lng) * kx)
  y.push((goal.lat - home.lat) * ky)
  const loop = goal === home
  // 東西・南北それぞれで、出発地から両端に触れて到着地へ行く最短の道のりを超えて動いた分（大きく引き返した分）。
  // 出発地に戻る旅では、端から端までの 1 往復
  let len = 0
  let sx = 0
  let sy = 0
  for (let i = 0; i <= n; i++) {
    len += Math.hypot(x[i + 1] - x[i], y[i + 1] - y[i])
    sx += Math.abs(x[i + 1] - x[i])
    sy += Math.abs(y[i + 1] - y[i])
  }
  const least = (v: number[]) => {
    const lo = Math.min(...v)
    const hi = Math.max(...v)
    const s = v[0]
    const g = v[n + 1]
    return hi - lo + Math.min(s - lo + hi - g, hi - s + g - lo)
  }
  const swing = Math.max(0, sx - least(x)) + Math.max(0, sy - least(y))
  let cost = (len / 1000) * WANDER.km + (swing / 1000) * WANDER.swing
  const side = (a: number, b: number, c: number) => Math.sign((x[b] - x[a]) * (y[c] - y[a]) - (y[b] - y[a]) * (x[c] - x[a]))
  for (let i = 0; i <= n; i++) {
    for (let j = i + 2; j <= n; j++) {
      if (loop && i === 0 && j === n) continue
      if (side(i, i + 1, j) * side(i, i + 1, j + 1) < 0 && side(j, j + 1, i) * side(j, j + 1, i + 1) < 0) cost += WANDER.cross
    }
  }
  const d2 = (a: number, b: number) => (x[a] - x[b]) ** 2 + (y[a] - y[b]) ** 2
  // away[i]: i の場所から AWAY_M より離れた、最初の場所
  const away: number[] = []
  for (let i = 1; i <= n; i++) {
    let k = i + 1
    while (k <= n && d2(i, k) <= AWAY_M * AWAY_M) k++
    away[i] = k
  }
  const seen = new Set<string>()
  let prev = ''
  for (let j = 1; j <= n; j++) {
    const d = items[j - 1].spot.district
    if (d && d !== prev && seen.has(d)) cost += WANDER.revisit
    else {
      for (let i = 1; i < j - 1; i++) {
        if (away[i] < j && d2(i, j) < NEAR_M * NEAR_M) {
          cost += WANDER.revisit
          break
        }
      }
    }
    if (d) seen.add(d)
    prev = d ?? ''
  }
  return cost
}

// 同じ地区・同じ種類（寺社）・同じ切り口が続くほど、1 か所ずつの値打ちを少し下げる（いろいろな場所を回るように）
function totalValue(items: Item[], c: Ctx): number {
  const vals = items.map((it) => ({ it, v: value(it.spot, it.slot, c) })).sort((a, b) => b.v - a.v)
  const perDistrict = new Map<string, number>()
  const perTheme = new Map<string, number>()
  let temples = 0
  let total = 0
  for (const { it, v } of vals) {
    let x = v
    if (it.slot === 'sight') {
      const d = it.spot.district || ''
      const k = perDistrict.get(d) ?? 0
      if (d) perDistrict.set(d, k + 1)
      x -= 6 * k
      if (it.spot.tags.includes('寺社')) x -= 4 * temples++
    }
    const th = it.spot.theme
    if (th) {
      const k = perTheme.get(th) ?? 0
      perTheme.set(th, k + 1)
      x -= TUNING.themeRepeat * k
    }
    total += x
  }
  return total
}
const score = (items: Item[], c: Ctx) => {
  const sim = simulate(items, c)
  return totalValue(items, c) - sim.cost - sim.loss
}

function bestInsert(items: Item[], add: Item, c: Ctx, strict: boolean): { items: Item[]; score: number } | null {
  let best: { items: Item[]; score: number } | null = null
  // strict: 閉まる時刻を過ぎる場所を増やさない・到着の時刻を過ぎない（本人が決めた長い滞在で、もとから過ぎている分は数えない）
  const bad0 = strict ? simulate(items, c).bad : 0
  for (let i = 0; i <= items.length; i++) {
    const next = [...items.slice(0, i), add, ...items.slice(i)]
    const sim = simulate(next, c)
    if (strict && (sim.bad > bad0 || sim.finish > c.input.end)) continue
    const sc = totalValue(next, c) - sim.cost - sim.loss
    if (!best || sc > best.score) best = { items: next, score: sc }
  }
  return best
}

// 決まった乱数（同じ条件なら同じプランになる）
function rng(seed: number) {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}
function hashOf(s: string) {
  let h = 2166136261
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619)
  return h >>> 0
}

// 乱数の種にする入力。意味が同じ入力（既定の値を明示した・キーの順が違う・並びの順に意味が無い）は同じ形にそろえる。
// 既定の値（回り方ふつう・移動を少なくしない・混雑をもっと避けない・前の並び無し）の項目は入れない
const sortedKeys = <T,>(r: Record<string, T> | undefined) =>
  Object.fromEntries(Object.keys(r ?? {}).sort().map((k) => [k, canon(r![k])]))
function canon(v: unknown): unknown {
  if (Array.isArray(v)) return v.map(canon)
  if (v && typeof v === 'object') return sortedKeys(v as Record<string, unknown>)
  return v
}
function seedInput(input: PlanInput) {
  return {
    conds: input.conds.map((c) => c.tag),
    must: input.must,
    day: input.day,
    start: input.start,
    end: input.end,
    pinned: input.pinned.map((p) => ({ id: p.id, slot: p.slot })),
    banned: [...input.banned].sort(),
    overrides: sortedKeys(input.overrides),
    ...(input.modes && Object.keys(input.modes).length && { modes: sortedKeys(input.modes) }),
    stayFix: sortedKeys(input.stayFix),
    focus: [...(input.focus ?? [])].sort(),
    skipDistricts: [...(input.skipDistricts ?? [])].sort(),
    base: input.base?.length ? input.base.map((b) => ({ id: b.id, slot: b.slot })) : null,
    ...(input.loose?.length && { loose: [...input.loose].sort() }),
    ...(input.pace && input.pace !== 'normal' && { pace: input.pace }),
    ...(input.moveLess && { moveLess: true }),
    ...(input.calm && { calm: true }),
    ...(input.leeway && { leeway: input.leeway }),
  }
}

// 焼きなまし法：入れ替え・順番を逆にする・足す・外す・取り替える を試し、良くなれば（たまに少し悪くても）採る
function anneal(start: Item[], c: Ctx, locked: Set<string>, banned: Set<string>, seed: number): Item[] {
  const rand = rng(hashOf(JSON.stringify([c.data.area.ja ?? c.data.area.name, seedInput(c.input), start.map((i) => i.spot.id), seed])))
  const pick = <T,>(a: T[]) => a[Math.floor(rand() * a.length)]
  const poolFor = (slot: Slot, inUse: Set<string>) =>
    c.data.places.filter(
      (s) =>
        !(c.onlyChosen && (slot === 'sight' || slot === 'cafe')) &&
        !inUse.has(s.id) &&
        !banned.has(s.id) &&
        (slot === 'sight' ? isSight(s) : mealOk(s, slot, c)),
    )
  let cur = start
  let curScore = score(cur, c)
  let best = cur
  let bestScore = curScore
  const N = TUNING.iterations
  for (let k = 0; k < N; k++) {
    const T = 18 * (1 - k / N) + 0.3
    const inUse = new Set(cur.map((i) => i.spot.id))
    const free = cur.map((it, i) => ({ it, i })).filter(({ it }) => !locked.has(it.spot.id))
    let next: Item[] | null = null
    const m = rand()
    if (m < 0.25 && cur.length > 1) {
      const i = Math.floor(rand() * cur.length)
      const j = Math.floor(rand() * cur.length)
      if (i !== j) {
        next = cur.slice()
        const [x] = next.splice(i, 1)
        next.splice(j, 0, x)
      }
    } else if (m < 0.45 && cur.length > 2) {
      const i = Math.floor(rand() * cur.length)
      const j = Math.floor(rand() * cur.length)
      const [a, b] = i < j ? [i, j] : [j, i]
      if (b - a >= 1) next = [...cur.slice(0, a), ...cur.slice(a, b + 1).reverse(), ...cur.slice(b + 1)]
    } else if (m < 0.65 && cur.length < MAX_STOPS) {
      const hasCafe = cur.some((i) => i.slot === 'cafe')
      const slot: Slot = !hasCafe && rand() < 0.2 ? 'cafe' : 'sight'
      const pool = poolFor(slot, inUse)
      if (pool.length) {
        const pos = Math.floor(rand() * (cur.length + 1))
        next = [...cur.slice(0, pos), { spot: pick(pool), slot, extra: 0 }, ...cur.slice(pos)]
      }
    } else if (m < 0.8) {
      const rm = free.filter(({ it }) => it.slot === 'sight' || it.slot === 'cafe')
      if (rm.length) {
        const { i } = pick(rm)
        next = cur.filter((_, j) => j !== i)
      }
    } else if (free.length) {
      const { it, i } = pick(free)
      const pool = poolFor(it.slot, inUse)
      if (pool.length) {
        next = cur.slice()
        next[i] = { spot: pick(pool), slot: it.slot, extra: 0 }
      }
    }
    if (!next) continue
    const sc = score(next, c)
    if (sc >= curScore || rand() < Math.exp((sc - curScore) / T)) {
      cur = next
      curScore = sc
      if (sc > bestScore) {
        best = next
        bestScore = sc
      }
    }
  }
  return best
}

function improve(items: Item[], c: Ctx): Item[] {
  let cur = items
  let curScore = score(cur, c)
  for (let pass = 0; pass < 4; pass++) {
    let changed = false
    for (let i = 0; i < cur.length; i++) {
      for (let j = 0; j < cur.length; j++) {
        if (i === j) continue
        const moved = cur.slice()
        const [x] = moved.splice(i, 1)
        moved.splice(j, 0, x)
        const sc = score(moved, c)
        if (sc > curScore + 0.01) {
          cur = moved
          curScore = sc
          changed = true
        }
      }
    }
    if (!changed) break
  }
  return cur
}

const sightPool = (s: Spot) => isSight(s)

export function makePlan(data: AreaData, input: PlanInput): Plan {
  const c = ctxOf(data, input)
  const byId = new Map(data.places.map((s) => [s.id, s]))
  const keep = new Set([...input.must, ...input.pinned.map((p) => p.id)])
  const skip = new Set(input.skipDistricts ?? [])
  const banned = new Set([...input.banned, ...data.places.filter((p) => p.district && skip.has(p.district) && !keep.has(p.id)).map((p) => p.id), ...notToAdd(data, keep)])
  // 外さない場所（行きたい場所・選び直した場所・この近くを回る場所・滞在を決めた場所）。
  // loose の場所は、値打ちは行きたい場所のまま、到着の時刻に入りきらないときだけ外せるようにする
  const locked = new Set([...keep, ...(input.focus ?? []), ...Object.keys(input.stayFix ?? {})])
  for (const id of input.loose ?? []) locked.delete(id)
  const base = input.base?.length ? input.base : null

  let items = base ? fromBase(data, input, c, byId, banned) : fresh(data, input, c, byId, banned, locked)
  if (base) items = swapMeals(items, c, locked, banned)
  const before = items.length
  items = fitTime(items, c, locked)
  items = fixClose(items, c)
  // 時間に合わせて外したあとは、続けて別の場所を足さない（外して別の場所が入ると、何が変わったのか分からなくなる）
  if (base && !c.onlyChosen && items.length >= before) items = fillSlack(items, data, c, banned, false)
  items = extendStays(items, c)
  if (!base) items = notWorseThanUsual(data, input, items, c)

  const sim = simulate(items, c)
  const famous = famousSights(data)
  const stops: Stop[] = sim.stops.map((s, i) => {
    const role = roleOf(s.spot, s.slot)
    const dark = s.slot === 'sight' && isDark(s.spot, s.arrive, c)
    const finale = i === sim.stops.length - 1 && sim.stops.length > 1 && endFit(s.spot, s.slot, s.arrive, s.level, dark) >= 0.6
    const reason = sentences(explain(s.spot, s.arrive, s.level, role, input, famous), finale ? WORD.finale : '')
    return { ...s, role, finale, reason, fits: wishFits(s.spot, role, input) }
  })
  const now = new Set(items.map((i) => i.spot.id))
  const was = new Set(base?.map((b) => b.id) ?? [])
  const dropped = base ? base.filter((b) => !now.has(b.id) && !banned.has(b.id)).map((b) => b.id) : []
  const added = base ? items.filter((i) => !was.has(i.spot.id) && !keep.has(i.spot.id)).map((i) => i.spot.id) : []
  return {
    stops,
    back: sim.back,
    backTimeNote: sim.backTimeNote,
    leave: sim.leave,
    finish: sim.finish,
    crowded: sim.crowded,
    moving: sim.moving,
    ease: sim.ease,
    backEase: sim.backEase,
    score: Math.round(score(items, c)),
    dropped,
    added,
  }
}

// 初めて組む：必ず入れるもの → 食事 → 得がなくなるまで足す → 焼きなまし法
function fresh(data: AreaData, input: PlanInput, c: Ctx, byId: Map<string, Spot>, banned: Set<string>, locked: Set<string>): Item[] {
  let items: Item[] = []
  const used = new Set<string>()
  const put = (spot: Spot, slot: Slot, strict: boolean) => {
    const r = bestInsert(items, { spot, slot, extra: 0 }, c, strict)
    if (r) {
      items = r.items
      used.add(spot.id)
    }
    return !!r
  }

  // 1. 必ず入れるもの
  for (const id of input.must) {
    const s = byId.get(id)
    if (s && !banned.has(id)) put(s, 'sight', false)
  }
  for (const p of input.pinned) {
    const s = byId.get(p.id)
    if (s && !banned.has(p.id) && !used.has(p.id)) put(s, p.slot, false)
  }
  const has = (slot: Slot) => items.some((it) => it.slot === slot)
  const meal = (slot: Exclude<Slot, 'sight'>, kinds: Spot['kind'][]) => {
    if (has(slot)) return
    let best: { items: Item[]; score: number; id: string } | null = null
    for (const s of data.places) {
      if (!kinds.includes(s.kind) || used.has(s.id) || banned.has(s.id) || !mealOk(s, slot, c)) continue
      const r = bestInsert(items, { spot: s, slot, extra: 0 }, c, false)
      if (r && (!best || r.score > best.score)) best = { ...r, id: s.id }
    }
    if (best) {
      items = best.items
      used.add(best.id)
    }
  }
  if (input.start <= 12 * 60 && input.end >= 13 * 60 + 30) meal('lunch', ['food'])
  if (input.start <= 19 * 60 && input.end >= 19 * 60) meal('dinner', ['food'])

  // 2. 得がなくなるまで足す
  if (!c.onlyChosen) items = fillSlack(items, data, c, banned, true)

  // 3. 焼きなまし法で良くする（行きたい場所・選び直した場所は外さない）
  let bestItems = items
  let bestScore = -Infinity
  for (let r = 0; r < TUNING.restarts; r++) {
    const cand = improve(anneal(items, c, locked, banned, r), c)
    const sc = score(cand, c)
    if (sc > bestScore) {
      bestItems = cand
      bestScore = sc
    }
  }
  return polish(bestItems, c, locked, banned)
}

// 場所がこの数までなら、並べ方を全部試す（6 か所で 720 通り）
const PERMUTE_MAX = 6
const MEAL_PERMUTE_MAX = 6
const PERMS = new Map<number, number[][]>()
function permutations(n: number): number[][] {
  const hit = PERMS.get(n)
  if (hit) return hit
  const out: number[][] = []
  const rec = (cur: number[], rest: number[]) => {
    if (!rest.length) out.push(cur)
    for (let i = 0; i < rest.length; i++) rec([...cur, rest[i]], [...rest.slice(0, i), ...rest.slice(i + 1)])
  }
  rec([], Array.from({ length: n }, (_, i) => i))
  PERMS.set(n, out)
  return out
}

const mealPool = (c: Ctx, slot: Slot, inUse: Set<string>, banned: Set<string>) =>
  c.data.places.filter((s) => !inUse.has(s.id) && !banned.has(s.id) && mealOk(s, slot, c))

// 焼きなましの結果を、乱数を使わずに仕上げる。並べ替え（1 か所を動かす・区間を逆にする・2 か所を入れ替える）、
// 外す・足す・取り替える（食事の店も、同じ枠の店と）のうち、いちばん良くなるものを、良くならなくなるまで続ける。
// 焼きなましの種で行き着いた先が違っても、同じ所にそろうようにする
function polish(items: Item[], c: Ctx, locked: Set<string>, banned: Set<string>): Item[] {
  let cur = items
  let curScore = score(cur, c)
  let permuted = ''
  for (let round = 0; round < 16; round++) {
    let best: Item[] | null = null
    let bestScore = curScore + 0.5
    const consider = (next: Item[]) => {
      const sc = score(next, c)
      if (sc > bestScore) {
        best = next
        bestScore = sc
      }
    }
    const n = cur.length
    const kinds = cur.map((x) => x.spot.id).sort().join('|')
    if (n <= PERMUTE_MAX && kinds !== permuted) {
      permuted = kinds
      for (const order of permutations(n)) consider(order.map((k) => cur[k]))
    } else for (let i = 0; i < n; i++) {
      for (let j = i + 1; j < n; j++) {
        consider([...cur.slice(0, i), ...cur.slice(i, j + 1).reverse(), ...cur.slice(j + 1)])
        const sw = cur.slice()
        ;[sw[i], sw[j]] = [sw[j], sw[i]]
        consider(sw)
      }
      for (let j = 0; j < n; j++) {
        if (i === j) continue
        const mv = cur.slice()
        const [x] = mv.splice(i, 1)
        mv.splice(j, 0, x)
        consider(mv)
      }
    }
    const inUse = new Set(cur.map((i) => i.spot.id))
    const sights = c.onlyChosen ? [] : c.data.places.filter((s) => isSight(s) && !inUse.has(s.id) && !banned.has(s.id))
    for (let i = 0; i < n; i++) {
      const it = cur[i]
      if (locked.has(it.spot.id)) continue
      if (it.slot === 'sight' || it.slot === 'cafe') consider(cur.filter((_, j) => j !== i))
      const pool = it.slot === 'sight' ? sights : mealPool(c, it.slot, inUse, banned)
      const rest = cur.filter((_, j) => j !== i)
      for (const s of pool) {
        const next = cur.map((x, j) => (j === i ? { spot: s, slot: it.slot, extra: 0 } : x))
        consider(next)
        if (it.slot === 'sight') continue
        // 食事の店を替えると回る順も変わるので、いちばん良い位置に入れ直し、少ないときは並べ方も全部試す
        const r = bestInsert(rest, { spot: s, slot: it.slot, extra: 0 }, c, false)
        if (r) consider(r.items)
        if (n <= MEAL_PERMUTE_MAX) for (const order of permutations(n)) consider(order.map((k) => next[k]))
      }
    }
    if (n < MAX_STOPS) {
      for (const s of sights) {
        const r = bestInsert(cur, { spot: s, slot: 'sight', extra: 0 }, c, true)
        if (r) consider(r.items)
      }
    }
    if (!best) break
    cur = best
    curScore = bestScore
  }
  return cur
}

// 前のプランの並びを土台にする：並びはそのまま、増えた「必ず入れるもの」だけを損の少ない位置に入れる
function fromBase(data: AreaData, input: PlanInput, c: Ctx, byId: Map<string, Spot>, banned: Set<string>): Item[] {
  let items: Item[] = []
  for (const b of input.base ?? []) {
    const s = byId.get(b.id)
    if (s && !banned.has(b.id) && !items.some((i) => i.spot.id === b.id)) items.push({ spot: s, slot: b.slot, extra: 0 })
  }
  const used = new Set(items.map((i) => i.spot.id))
  const put = (spot: Spot, slot: Slot) => {
    const r = bestInsert(items, { spot, slot, extra: 0 }, c, false)
    if (r) {
      items = r.items
      used.add(spot.id)
    }
  }
  for (const id of input.must) {
    const s = byId.get(id)
    if (s && !banned.has(id) && !used.has(id)) put(s, 'sight')
  }
  for (const p of input.pinned) {
    const s = byId.get(p.id)
    if (!s || banned.has(p.id) || used.has(p.id)) continue
    // 食事・休憩は 1 か所ずつ。同じ枠があればその位置で入れ替える
    const same = p.slot !== 'sight' ? items.findIndex((i) => i.slot === p.slot) : -1
    if (same >= 0) {
      items = items.map((x, j) => (j === same ? { spot: s, slot: p.slot, extra: 0 } : x))
      used.add(p.id)
    } else put(s, p.slot)
  }
  void data
  return items
}

// 前の並びを土台にするとき、選び直していない食事の店が、手直しで使えなくなったとき（食事の時間帯から外れた・閉まる時刻を過ぎる・
// 食事の希望に合わない）だけ、同じ位置のまま回る道に近い店に替える（はっきり良くなるときだけ）。使えるうちは替えない
const MEAL_SWAP_GAIN = 15
function mealStillFits(it: Item, st: SimStop | undefined, c: Ctx): boolean {
  if (!st || st.closeOver || !mealOk(it.spot, it.slot, c)) return false
  if (it.slot === 'cafe') return true
  const [from, to] = WINDOWS[it.slot as Exclude<Slot, 'sight'>]
  return st.arrive >= from && st.arrive <= to
}
function swapMeals(items: Item[], c: Ctx, locked: Set<string>, banned: Set<string>): Item[] {
  let cur = items
  let curScore = score(cur, c)
  const now = simulate(cur, c).stops
  for (let i = 0; i < cur.length; i++) {
    const it = cur[i]
    if (it.slot === 'sight' || locked.has(it.spot.id) || mealStillFits(it, now[i], c)) continue
    const inUse = new Set(cur.map((x) => x.spot.id))
    for (const s of mealPool(c, it.slot, inUse, banned)) {
      const next = cur.map((x, j) => (j === i ? { spot: s, slot: it.slot, extra: 0 } : x))
      const sc = score(next, c)
      if (sc > curScore + MEAL_SWAP_GAIN) {
        cur = next
        curScore = sc
      }
    }
  }
  return cur
}

// 空いた時間に、得のある場所を足す。順番は入れ替えない（first のときだけ、足すたびに並べ直す）
function fillSlack(items: Item[], data: AreaData, c: Ctx, banned: Set<string>, first: boolean): Item[] {
  let cur = score(items, c)
  const used = new Set(items.map((i) => i.spot.id))
  const has = (slot: Slot) => items.some((it) => it.slot === slot)
  while (items.length < MAX_STOPS) {
    if (!first && simulate(items, c).finish > c.input.end - 30) break
    let best: { items: Item[]; score: number; id: string } | null = null
    const tryAdd = (s: Spot, slot: Slot) => {
      const r = bestInsert(items, { spot: s, slot, extra: 0 }, c, true)
      if (r && r.score > cur + 1 && (!best || r.score > best.score)) best = { ...r, id: s.id }
    }
    for (const s of data.places) {
      if (used.has(s.id) || banned.has(s.id)) continue
      if (sightPool(s)) tryAdd(s, 'sight')
      else if (first && s.kind === 'cafe' && !has('cafe') && opensFor(s, 'cafe')) tryAdd(s, 'cafe')
    }
    if (!best) break
    const b: { items: Item[]; score: number; id: string } = best
    items = first ? improve(b.items, c) : b.items
    used.add(b.id)
    cur = score(items, c)
  }
  return items
}

// 到着の時刻を過ぎるときは、外してよい場所から、外しても損の少ない順に外す
function fitTime(items: Item[], c: Ctx, locked: Set<string>): Item[] {
  let cur = items
  for (let k = 0; k < MAX_STOPS; k++) {
    const sim = simulate(cur, c)
    if (sim.finish <= c.input.end) break
    let best: { items: Item[]; score: number } | null = null
    cur.forEach((it, i) => {
      // 昼食と夕食は、時間が足りなくても外さない（外すのは見どころとカフェ）
      if (locked.has(it.spot.id) || it.slot === 'lunch' || it.slot === 'dinner') return
      const next = cur.filter((_, j) => j !== i)
      const sc = score(next, c)
      if (!best || sc > best.score) best = { items: next, score: sc }
    })
    if (!best) break
    cur = (best as { items: Item[]; score: number }).items
  }
  return cur
}

// 閉まる時刻を過ぎて滞在する場所は、間に合う位置へ移す（移せなければそのまま。画面で知らせる）
function fixClose(items: Item[], c: Ctx): Item[] {
  let cur = items
  for (let k = 0; k < 3; k++) {
    const sim = simulate(cur, c)
    const i = sim.stops.findIndex((s) => s.closeOver)
    if (i < 0) break
    let best: { items: Item[]; score: number } | null = null
    for (let j = 0; j < cur.length; j++) {
      if (j === i) continue
      const moved = cur.slice()
      const [x] = moved.splice(i, 1)
      moved.splice(j, 0, x)
      const ms = simulate(moved, c)
      if (ms.stops.some((s) => s.spot.id === x.spot.id && s.closeOver)) continue
      const sc = score(moved, c)
      if (!best || sc > best.score) best = { items: moved, score: sc }
    }
    if (!best) break
    cur = (best as { items: Item[]; score: number }).items
  }
  return cur
}

// 早く終わるときは滞在を長めに（本人が長さを決めた場所と食事は変えない）
function extendStays(items: Item[], c: Ctx): Item[] {
  for (let k = 0; k < 10; k++) {
    const sim = simulate(items, c)
    const slack = c.input.end - (c.input.leeway ?? 0) - sim.finish
    if (slack < 15) break
    let changed = false
    for (let i = items.length - 1; i >= 0 && !changed; i--) {
      const it = items[i]
      if (isMeal(it.slot) || it.extra >= baseStay(it.spot) || stayFix[it.spot.id] !== undefined) continue
      const add = Math.min(slack, baseStay(it.spot) - it.extra, it.spot.close - sim.stops[i].depart)
      if (add < 10) continue
      const next = items.map((x, j) => (j === i ? { ...x, extra: x.extra + Math.floor(add / 5) * 5 } : x))
      const ns = simulate(next, c)
      if (ns.bad <= sim.bad && ns.crowded <= sim.crowded && ns.finish <= c.input.end && ns.cost <= sim.cost + add * 0.4) {
        items = next
        changed = true
      }
    }
    if (!changed) break
  }
  return items
}

// 「この近くの場所を足す」：選んだ場所の近く（1.5 km 以内）で、まだプランに無い見どころを良い順に
export function nearCandidates(data: AreaData, plan: Plan, input: PlanInput, id: string, n = 2): Spot[] {
  const c = ctxOf(data, input)
  const f = data.places.find((p) => p.id === id)
  if (!f) return []
  const inPlan = new Set(plan.stops.map((s) => s.spot.id))
  const stop = plan.stops.find((s) => s.spot.id === id)
  const at = stop ? stop.depart + 15 : input.start
  const skip = new Set(input.skipDistricts)
  return data.places
    .filter((s) => isSight(s) && !inPlan.has(s.id) && !input.banned.includes(s.id) && !(s.district && skip.has(s.district)) && distM(f, s) < 1500 && s.close >= at + 30)
    .map((s) => ({ s, sc: (value(s, 'sight', c) % FORCED) - CROWD_COST[levelAt(s, at, input.day)] * 2 - distM(f, s) / 100 }))
    .sort((a, b) => b.sc - a.sc)
    .slice(0, n)
    .map((x) => x.s)
}

// その日の楽しみ：いちばんの見どころ（山場）と、希望に合う食事か、種類の違う見どころをもう 1 か所
export function highlights(data: AreaData, plan: Plan, input: PlanInput): Stop[] {
  const c = ctxOf(data, input)
  const v = (s: Stop) => value(s.spot, s.slot, c) % FORCED
  const best = (list: Stop[]) => list.slice().sort((a, b) => v(b) - v(a))[0]
  const peak = best(plan.stops.filter((s) => s.slot === 'sight'))
  if (!peak) return []
  const rest = plan.stops.filter((s) => s !== peak)
  const wish = c.tags.filter((t) => t !== '有名' && t !== '静か')
  const group = (s: Stop) => (s.slot !== 'sight' ? 'shop' : s.spot.kind)
  const meal = best(rest.filter((s) => s.slot !== 'sight' && s.spot.tags.some((t) => wish.includes(t))))
  const other = meal ?? best(rest.filter((s) => group(s) !== group(peak) && s.slot === 'sight')) ?? best(rest.filter((s) => s.slot === 'sight'))
  return other ? [peak, other] : [peak]
}

function roleOf(s: Spot, slot: Slot): RoleLabel {
  if (slot === 'lunch') return '昼食'
  if (slot === 'dinner') return '夕食'
  if (slot === 'cafe') return '休憩'
  return s.role === 'famous' ? '人気スポット' : '隠れた名所'
}

const WORD = tr({
  ja: {
    finale: '一日の最後に、落ち着いて過ごせる場所です。',
    and: (a: string, b: string) => `${a}と${b}`,
    quote: (s: string) => `「${s}」`,
    fitShop: (w: string) => `希望の${w}に合う店です。`,
    fitSight: (w: string) => `希望の${w}に合います。`,
    now: (hour: number, pred: string) => `${hour}時台は${pred}。`,
    peak: (range: string) => `混むのは${range}です。`,
    unavoidable: '混む時間を避けられませんでした。',
    near: (name: string, m: number) => `${name}から歩いて${m}分です。`,
  },
  en: {
    finale: 'A calm place to end the day.',
    and: (a: string, b: string) => `${a} and ${b}`,
    quote: (s: string) => `“${s}”`,
    fitShop: (w: string) => `Matches your wish for ${w}.`,
    fitSight: (w: string) => `Matches your wish for ${w}.`,
    now: (hour: number, pred: string) => `Usually ${pred} around ${hour}:00.`,
    peak: (range: string) => `Busiest ${range}.`,
    unavoidable: 'The busy hours couldn’t be avoided.',
    near: (name: string, m: number) => `${m} min walk from ${name}.`,
  },
})

// 文をつなぐ（日本語は続けて、英語は空白をはさむ）
const sentences = (...parts: string[]) => parts.filter(Boolean).join(isEn ? ' ' : '')

// 理由に書く、合った希望（条件の言葉）。人気スポットの理由は混む時間を書くので、希望は書かない
// 店は、食事の希望（そばなど）があるときは、それに合ったときだけ書く（「混雑を避けた場所」に合うだけの洋食の店に「希望に合う」と書かない）
function wishFits(s: Spot, role: RoleLabel, input: PlanInput): string[] {
  if (role === '人気スポット') return []
  const shop = role === '昼食' || role === '夕食' || role === '休憩'
  const specific = input.conds.filter((c) => !GENERIC_TAGS.has(c.tag))
  const conds = shop && specific.length ? specific : input.conds
  return conds.filter((c) => s.tags.includes(c.tag)).map((c) => c.label)
}

// Gemini に書かせる説明の代わり（言い方は Google マップに合わせる）
function explain(s: Spot, arrive: number, level: number, role: RoleLabel, input: PlanInput, famous: Spot[]): string {
  const hour = Math.floor(arrive / 60)
  // 希望に合ったとき: 店は「希望の「おいしいそば」に合う店です。」、見どころは「希望の「お寺」と「静かな場所」に合います。」
  const matched = wishFits(s, role, input).map((l) => WORD.quote(l))
  const shop = role === '昼食' || role === '夕食' || role === '休憩'
  const wish = matched.length > 1 ? WORD.and(matched.slice(0, -1).join(isEn ? ', ' : ''), matched[matched.length - 1]) : matched[0]
  const fit = wish ? (shop ? WORD.fitShop(wish) : WORD.fitSight(wish)) : ''
  // 混雑の推定は 8〜18 時台だけ（夜は推定が無いので、混み具合を書かない。サーバーが埋めた時間帯も書かない）
  const known = hour >= FIRST_HOUR && hour <= LAST_HOUR && !crowdGap(s, arrive)
  const now = known ? WORD.now(hour, LEVEL_PRED[level]) : ''
  if (role === '人気スポット') {
    const peak = peakRange(s, input.day)
    if (!peak) return now || s.why
    return level <= 2 || !known ? sentences(WORD.peak(peak), now) : sentences(WORD.peak(peak), WORD.unavoidable)
  }
  if (role === '昼食' || role === '夕食') {
    const peak = known && level <= 2 ? peakRange(s, input.day) : null
    return sentences(fit, peak ? WORD.peak(peak) : '', now) || s.why
  }
  if (role !== '隠れた名所') return sentences(fit, now) || s.why
  const near = famous.map((f) => ({ f, m: walkMin(f, s) })).sort((a, b) => a.m - b.m)[0]
  const nearText = near && near.m <= 20 ? WORD.near(near.f.name, near.m) : ''
  return sentences(fit, nearText) || now || s.why
}

export type UsualPlan = { crowded: number; finish: number; moving: number; closed: number; stops: { arrive: number; depart: number; level: number }[] }

// よくある回り方：このプランと同じ場所・同じ滞在を、混む時間を気にせず出発地から近い順に回り、
// 食事はいつもの時間にとる（昼食は 11時30分、夕食は 17時30分を過ぎたら）。違いは回る順番と時刻だけ
export function usualPlan(data: AreaData, input: PlanInput, plan: Plan): UsualPlan {
  const c = ctxOf(data, input)
  const items = usualItems(data, input, plan.stops.map((s): Item => ({ spot: s.spot, slot: s.slot, extra: s.stay - baseStay(s.spot) })))
  const sim = simulate(items, c)
  return { crowded: sim.crowded, finish: sim.finish, moving: sim.moving, closed: sim.bad, stops: sim.stops.map((s) => ({ arrive: s.arrive, depart: s.depart, level: s.level })) }
}

// よくある回り方の並び：同じ場所を、混む時間を気にせず出発地から近い順に回り、食事はいつもの時間にとる（昼食は 11時30分、夕食は 17時30分を過ぎたら）
function usualItems(data: AreaData, input: PlanInput, list: Item[]): Item[] {
  const remaining = list.filter((it) => it.slot !== 'lunch' && it.slot !== 'dinner')
  const meals = (['lunch', 'dinner'] as const)
    .map((slot) => ({ at: slot === 'lunch' ? 11 * 60 + 30 : 17 * 60 + 30, it: list.find((x) => x.slot === slot) }))
    .filter((m): m is { at: number; it: Item } => !!m.it)
  const out: Item[] = []
  let pos: Point = data.start
  let t = input.start
  while (remaining.length || meals.length) {
    let next: Item
    if (meals.length && (t >= meals[0].at || !remaining.length)) {
      const m = meals.shift()!
      next = { ...m.it, from: m.at }
    } else {
      remaining.sort((a, b) => distM(pos, a.spot) - distM(pos, b.spot))
      next = remaining.shift()!
    }
    t += route(pos, next.spot).minutes
    t = Math.max(t, next.spot.open, next.from ?? 0) + baseStay(next.spot) + next.extra
    out.push(next)
    pos = next.spot
  }
  return out
}

// 組んだ並びが、よくある回り方の並びより混雑する場所にいる時間が長くなるときは、よくある回り方の並び（食事の時刻は決めずに、と決めて）のうち
// 混雑の滞在がいちばん短いものに替える（帰る時刻と閉まる時刻を守れるものだけ）。混む時間をずらすアプリが、ずらさない回り方より混む並びを出さないため
function notWorseThanUsual(data: AreaData, input: PlanInput, items: Item[], c: Ctx): Item[] {
  const mine = simulate(items, c)
  const usual = simulate(usualItems(data, input, items), c)
  if (mine.crowded <= usual.crowded) return items
  const order = usualItems(data, input, items)
  let best = items
  let bestSim = mine
  for (const cand of [order, order.map(({ from: _from, ...it }) => it)]) {
    const sim = simulate(cand, c)
    if (sim.bad > mine.bad || sim.finish > Math.max(input.end, mine.finish)) continue
    if (sim.crowded < bestSim.crowded) {
      best = cand
      bestSim = sim
    }
  }
  return best
}

export type Alternative = { spot: Spot; level: number; known: boolean }

export function alternatives(data: AreaData, stop: Stop, plan: Plan, input: PlanInput): Alternative[] {
  const c = ctxOf(data, input)
  const inPlan = new Set(plan.stops.map((s) => s.spot.id))
  const at = stop.arrive + stop.stay / 2
  let pool: Spot[]
  // 食事・休憩は、近く（2.5 km 以内）の店を先に。近くに無いときだけ遠くの店も出す
  const nearFirst = (list: Spot[]) => {
    const near = list.filter((s) => distM(s, stop.spot) < 2500 && !inPlan.has(s.id))
    return near.length ? near : list
  }
  if (stop.slot === 'lunch' || stop.slot === 'dinner') pool = nearFirst(data.places.filter((s) => s.kind === 'food' && opensFor(s, stop.slot)))
  else if (stop.slot === 'cafe') pool = nearFirst(data.places.filter((s) => s.kind === 'cafe'))
  else if (stop.spot.role === 'famous') pool = data.places.filter((s) => isSight(s) && s.role === 'hidden' && distM(s, stop.spot) < 3000)
  else pool = data.places.filter((s) => isSight(s) && s.role === 'hidden' && distM(s, stop.spot) < 5000)
  return pool
    .filter((s) => !inPlan.has(s.id) && !input.banned.includes(s.id) && s.close >= at + 30)
    .map((s) => ({ s, sc: value(s, stop.slot, c) - CROWD_COST[levelAt(s, at, input.day)] - distM(s, stop.spot) / 400 }))
    .sort((a, b) => b.sc - a.sc)
    .slice(0, 3)
    .map(({ s }) => ({ spot: s, level: levelAt(s, at, input.day), known: !crowdGap(s, at) }))
}
