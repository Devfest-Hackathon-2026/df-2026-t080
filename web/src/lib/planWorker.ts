// スケジュールの計算を裏で行う（数百ミリ秒かかるので、画面を止めない）
import { makePlan, usualPlan, type Plan, type PlanInput, type UsualPlan } from './planner'
import { setBusTable, setMatrix, setModes, setOverrides } from './geo'
import type { AreaData } from '../types'

export type PlanRequest = { id: number; data: AreaData; input: PlanInput }
export type PlanResponse = { id: number; plan: Plan; usual: UsualPlan }

self.onmessage = (e: MessageEvent<PlanRequest>) => {
  const { id, data, input } = e.data
  setMatrix(data)
  setOverrides(data, input.overrides)
  setModes(data, input.modes ?? {})
  setBusTable(data, input.busTable)
  const plan = makePlan(data, input)
  const usual = usualPlan(data, input, plan)
  ;(self as unknown as Worker).postMessage({ id, plan, usual } satisfies PlanResponse)
}
