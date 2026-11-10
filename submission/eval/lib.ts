// IntenTrip の「よくある回り方」との比べを、画面と同じ定義・同じ閾値で数える共通の部品。
// アプリのコードは読むだけ（web/src/lib の planner.ts ほか）。外の API は呼ばない。
import { readFileSync } from 'node:fs'
import { makePlan, usualPlan, type Plan, type PlanInput, type UsualPlan } from '../../web/src/lib/planner.ts'
import { distM, route, setBusTable, setMatrix, setModes, setOverrides } from '../../web/src/lib/geo.ts'
import { levelAt } from '../../web/src/lib/crowd.ts'
import type { AreaData, Condition } from '../../web/src/types.ts'

export const REPO = new URL('../../', import.meta.url).pathname
export let data: AreaData = JSON.parse(readFileSync(`${REPO}/server/sample.json`, 'utf8'))
export let byId = new Map(data.places.map((p) => [p.id, p]))
export const idOf = (name: string) => {
  const p = data.places.find((x) => x.name === name || x.name.startsWith(name))
  if (!p) throw new Error(`no place ${name}`)
  return p.id
}

export const hhmm = (m: number) => `${Math.floor(m / 60)}:${String(Math.round(m) % 60).padStart(2, '0')}`

// Compare.tsx と同じ判定（diff >= 10 で減らせる、diff <= -10 で長くなる、その間は同じくらい）
// 画面（Compare.tsx）と同じ判定。よくある回り方が帰る時刻に間に合わない・閉まる時刻を過ぎる場所があるときは、長いとは言わずにそう言う
export function verdict(planCrowded: number, usualCrowded: number, usualFinish = 0, end = Infinity, usualClosed = 0, planClosed = 0): { kind: 'shorter' | 'zero' | 'same' | 'longer' | 'usualLate' | 'usualClosed'; text: string } {
  const diff = usualCrowded - planCrowded
  if (diff >= 10) {
    if (planCrowded === 0) return { kind: 'zero', text: '混雑する場所にいる時間は0分です' }
    const p = Math.min(99, Math.round((diff / usualCrowded) * 100))
    return { kind: 'shorter', text: `よくある回り方より${p}%減らせます` }
  }
  if (diff <= -10 && usualFinish > end) return { kind: 'usualLate', text: `よくある回り方では、帰る時刻（${hhmm(end)}）に間に合いません` }
  if (diff <= -10 && usualClosed > planClosed) return { kind: 'usualClosed', text: 'よくある回り方では、閉まる時刻を過ぎる場所があります' }
  if (diff <= -10) return { kind: 'longer', text: `よくある回り方より${-diff}分長くなります` }
  return { kind: 'same', text: '同じくらいです' }
}

export let COND_ALL: Condition[] = data.conditions

export type Case = {
  id: string
  group: string
  note?: string
  conds: string[] // 条件の tag（sample.json の conditions から選ぶ）
  day: 'holiday' | 'weekday'
  start: number
  end: number
  must?: string[]
  pinned?: { id: string; slot: 'sight' | 'lunch' | 'dinner' | 'cafe' }[]
  banned?: string[]
  pace?: 'slow' | 'normal' | 'many'
  calm?: boolean
  moveLess?: boolean
  fill?: boolean // false: 選んだ場所と食事だけで組む（画面で場所を選んだとき）
}

export function inputOf(c: Case): PlanInput {
  return {
    conds: COND_ALL.filter((x) => c.conds.includes(x.tag)),
    must: c.must ?? [],
    day: c.day,
    start: c.start,
    end: c.end,
    pinned: c.pinned ?? [],
    banned: c.banned ?? [],
    overrides: {},
    stayFix: {},
    focus: [],
    skipDistricts: [],
    base: null,
    ...(c.pace && c.pace !== 'normal' && { pace: c.pace }),
    ...(c.moveLess && { moveLess: true }),
    ...(c.calm && { calm: true }),
    ...(c.fill === false && { fill: false }),
  }
}

// planWorker.ts と同じ順で道の表などを入れる（時刻表の目安 busTable は無し＝サーバーが表を返さないときと同じ）
// table: 'saved' は前の係が試作サイトのサーバーから受け取って保存した京都の目安の表（11-06・11-07 に 3 回取って同じ中身）。'none' は表無し（式で見積もる）
export const SAVED_TABLE = JSON.parse(readFileSync(new URL('./bustable-sample-20261106.json', import.meta.url), 'utf8'))
// ほかのエリアの作り置き（areas/*.json）に差し替える。移動は表を使わず、アプリの式で見積もる（道の表と時刻表の目安なし）
export function useArea(d: AreaData) {
  data = d
  byId = new Map(d.places.map((p) => [p.id, p]))
  COND_ALL = d.conditions ?? []
  setMatrix(d)
  setOverrides(d, {})
  setModes(d, {})
  setBusTable(d, null)
}

export function prepare(table: 'saved' | 'none' = 'saved') {
  setMatrix(data)
  setOverrides(data, {})
  setModes(data, {})
  setBusTable(data, table === 'saved' ? SAVED_TABLE : null)
}

// よくある回り方の順番を、usualPlan と同じ決め方でなぞって、場所の名前を付ける（usualPlan は名前を返さないため）
function usualOrder(input: PlanInput, plan: Plan) {
  const remaining = plan.stops.filter((s) => s.slot !== 'lunch' && s.slot !== 'dinner')
  const meals = (['lunch', 'dinner'] as const)
    .map((slot) => ({ slot, at: slot === 'lunch' ? 11 * 60 + 30 : 17 * 60 + 30, stop: plan.stops.find((s) => s.slot === slot) }))
    .filter((m) => !!m.stop)
  const out: { name: string; slot: string; id: string; stay: number }[] = []
  let pos = data.start as { lat: number; lng: number }
  let t = input.start
  while (remaining.length || meals.length) {
    let next
    let from = 0
    if (meals.length && (t >= meals[0].at || !remaining.length)) {
      const m = meals.shift()!
      next = m.stop!
      from = m.at
    } else {
      remaining.sort((a, b) => distM(pos, a.spot) - distM(pos, b.spot))
      next = remaining.shift()!
    }
    t += route(pos, next.spot).minutes
    t = Math.max(t, next.spot.open, from) + next.stay
    out.push({ name: next.spot.name, slot: next.slot, id: next.spot.id, stay: next.stay })
    pos = next.spot
  }
  return out
}

export type Row = ReturnType<typeof run>

// impl: 組み立ての部品（ふだんはアプリの planner.ts。仮定の比べのときだけ写しを渡す）
export type Impl = { makePlan: typeof makePlan; usualPlan: typeof usualPlan }
export function run(c: Case, impl: Impl = { makePlan, usualPlan }) {
  const input = inputOf(c)
  const t0 = Date.now()
  const plan = impl.makePlan(data, input)
  const usual: UsualPlan = impl.usualPlan(data, input, plan)
  const ms = Date.now() - t0
  const order = usualOrder(input, plan)
  const v = verdict(plan.crowded, usual.crowded, usual.finish, c.end, usual.closed ?? 0, plan.stops.filter((s) => s.closeOver).length)
  const famous = plan.stops.filter((s) => s.slot === 'sight' && s.spot.role === 'famous').length
  const stayTotal = plan.stops.reduce((a, s) => a + s.stay, 0)
  // 混雑の推定のある時間帯（8〜18時台）で、その場所の滞在がどの時刻に始まっても混雑（3 以上）になるか＝順番では避けられない場所
  const unavoidable = (id: string, stay: number) => {
    const s = byId.get(id)!
    for (let a = Math.max(c.start, s.open); a + stay <= Math.min(c.end, s.close); a += 5) if (levelAt(s, a + stay / 2, c.day) < 3) return false
    return true
  }
  return {
    ...c,
    ms,
    planCrowded: plan.crowded,
    usualCrowded: usual.crowded,
    diff: usual.crowded - plan.crowded,
    verdict: v.kind,
    screen: v.text,
    stops: plan.stops.length,
    famousSights: famous,
    stayTotal,
    planFinish: plan.finish,
    usualFinish: usual.finish,
    unavoidableMin: plan.stops.filter((s) => unavoidable(s.spot.id, s.stay)).reduce((a, s) => a + s.stay, 0),
    plan: plan.stops.map((s) => ({ name: s.spot.name, slot: s.slot, role: s.spot.role, arrive: hhmm(s.arrive), stay: s.stay, level: s.level, crowded: s.level >= 3 })),
    usual: usual.stops.map((s, i) => ({ name: order[i]?.name ?? '?', slot: order[i]?.slot ?? '?', arrive: hhmm(s.arrive), stay: s.depart - s.arrive, level: s.level, crowded: s.level >= 3 })),
  }
}
