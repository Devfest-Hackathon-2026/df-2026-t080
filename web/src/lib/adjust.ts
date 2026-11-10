// 調整の頼み（Gemini が返した操作）を、プランの入力に当てる。時刻と順番は、当てたあとに planner.ts が組む。
//
// その頼みで名前の出た場所（足した・順番を変えた・滞在を決めた・探して見つけた場所）は必ず入れる。
// 足す・探す・順番・滞在・時刻の頼みでは、それまでに選んでいた見どころを loose に入れる。
// loose の場所は並び（base）の同じ位置に残し、戻りの時刻に入りきらないときだけ、
// planner.ts の決まり（fitTime）で、外しても損の少ない順に外す。
import type { AdjustOp } from './api'
import type { BaseItem, Plan, Slot } from './planner'
import type { Spot } from '../types'

export type Pin = { id: string; slot: Slot }

export type AdjustState = {
  must: string[]
  pinned: Pin[]
  banned: string[]
  focus: string[]
  stayFix: Record<string, number>
  conds: { tag: string; label: string }[]
  skipDistricts: string[]
  start: number
  end: number
  base: BaseItem[] | null
  loose: string[]
}

export type MealSlot = (s: Spot, taken?: Slot[]) => Slot

const baseOf = (plan: Plan): BaseItem[] => plan.stops.map((s) => ({ id: s.spot.id, slot: s.slot }))

// 頼みで名前の出なかった見どころ（時間が足りないときは外してよい場所）。食事・休憩の店は、もとから外さないので入れない
export function looseOf(must: string[], pinned: Pin[], named: Set<string> = new Set()): string[] {
  const ids = [...must, ...pinned.filter((p) => p.slot === 'sight').map((p) => p.id)]
  return [...new Set(ids)].filter((id) => !named.has(id))
}

export function applyAdjust(places: Spot[], plan: Plan, st: AdjustState, ops: AdjustOp[], mealSlot: MealSlot): AdjustState {
  const byId = new Map(places.map((p) => [p.id, p]))
  let b = baseOf(plan)
  let mustN = [...st.must]
  let pinnedN = [...st.pinned]
  let bannedN = [...st.banned]
  let focusN = [...st.focus]
  const stayN = { ...st.stayFix }
  let condsN = [...st.conds]
  const takenSlots: Slot[] = []
  let skipN = [...st.skipDistricts]
  let startN = st.start
  let endN = st.end
  const named = new Set<string>()
  const keepIn = (id: string) => {
    const slot = b.find((x) => x.id === id)?.slot
    if (slot && !mustN.includes(id) && !pinnedN.some((x) => x.id === id)) pinnedN.push({ id, slot })
  }
  for (const o of ops) {
    if (o.op === 'add') {
      const sp = byId.get(o.id)
      if (!sp) continue
      named.add(o.id)
      bannedN = bannedN.filter((x) => x !== o.id)
      if (sp.district && skipN.includes(sp.district)) skipN = skipN.filter((x) => x !== sp.district)
      if (sp.kind === 'food' || sp.kind === 'cafe') {
        const slot = mealSlot(sp, takenSlots)
        takenSlots.push(slot)
        const replaced = b.find((x) => x.slot === slot)
        pinnedN = [...pinnedN.filter((x) => x.id !== o.id && x.slot !== slot), { id: o.id, slot }]
        if (replaced) b = b.map((x) => (x.id === replaced.id ? { id: o.id, slot } : x))
      } else if (!mustN.includes(o.id)) mustN.push(o.id)
    } else if (o.op === 'remove') {
      named.delete(o.id)
      mustN = mustN.filter((x) => x !== o.id)
      pinnedN = pinnedN.filter((x) => x.id !== o.id)
      focusN = focusN.filter((x) => x !== o.id)
      if (!bannedN.includes(o.id)) bannedN.push(o.id)
      b = b.filter((x) => x.id !== o.id)
    } else if (o.op === 'stay') {
      named.add(o.id)
      stayN[o.id] = o.minutes
      keepIn(o.id)
    } else if (o.op === 'move') {
      let at = b.findIndex((x) => x.id === o.id)
      // 同じ頼みで足した場所は、まだ並びに無いので、ここで並びに入れてから動かす
      const added = pinnedN.find((x) => x.id === o.id)
      if (at < 0 && (mustN.includes(o.id) || added)) {
        b.push({ id: o.id, slot: added?.slot ?? 'sight' })
        at = b.length - 1
      }
      if (at < 0) continue
      named.add(o.id)
      const [item] = b.splice(at, 1)
      const [where, ref] = o.to.split(':')
      const j = ref ? b.findIndex((x) => x.id === ref) : -1
      if (o.to === 'first') b.unshift(item)
      else if (o.to === 'last') b.push(item)
      else if (j >= 0) b.splice(where === 'after' ? j + 1 : j, 0, item)
      else b.splice(at, 0, item)
      keepIn(o.id)
    } else if (o.op === 'time') {
      if (o.start !== undefined) startN = Math.min(22 * 60, Math.max(5 * 60, o.start))
      if (o.end !== undefined) endN = Math.min(23 * 60 + 55, o.end)
      if (endN < startN + 60) endN = Math.min(23 * 60 + 55, startN + 60)
    } else if (o.op === 'cond') {
      const kept = condsN.filter((c) => !o.remove.includes(c.tag))
      condsN = [...kept, ...o.add.filter((c) => !kept.some((x) => x.tag === c.tag))]
    } else if (o.op === 'district') {
      skipN = [...skipN.filter((d) => !o.use.includes(d)), ...o.skip.filter((d) => !skipN.includes(d))]
      const off = new Set(o.skip)
      const inOff = new Set(places.filter((p) => p.district && off.has(p.district)).map((p) => p.id))
      mustN = mustN.filter((x) => !inOff.has(x))
      pinnedN = pinnedN.filter((x) => !inOff.has(x.id))
      focusN = focusN.filter((x) => !inOff.has(x))
    }
  }
  return {
    must: mustN,
    pinned: pinnedN,
    banned: bannedN,
    focus: focusN,
    stayFix: stayN,
    conds: condsN,
    skipDistricts: skipN,
    start: startN,
    end: endN,
    base: b,
    // 時間を多く使う頼み（足す・順番・滞在・時刻）のときだけ、外してよい場所を決め直す
    loose: ops.some((o) => o.op === 'add' || o.op === 'stay' || o.op === 'move' || o.op === 'time')
      ? looseOf(mustN, pinnedN, named)
      : st.loose.filter((id) => looseOf(mustN, pinnedN).includes(id)),
  }
}

// 頼みで探して見つけた場所を入れる。見どころは必ず入れる場所に、食事・休憩は同じ枠の店と入れ替える。
// st.loose は、同じ頼みの初めに決めたもの（見つけた場所は入れない）
export function addFound(plan: Plan, st: AdjustState, sights: Spot[], meals: Pin[]): AdjustState {
  let base = baseOf(plan)
  let pinned = st.pinned
  for (const m of meals) {
    pinned = [...pinned.filter((q) => q.slot !== m.slot), m]
    const replaced = plan.stops.find((s) => s.slot === m.slot)
    if (replaced) base = base.map((x) => (x.id === replaced.spot.id ? { id: m.id, slot: m.slot } : x))
  }
  const found = new Set(sights.map((p) => p.id))
  return { ...st, base, pinned, must: [...st.must, ...[...found].filter((id) => !st.must.includes(id))], loose: st.loose.filter((id) => !found.has(id)) }
}
