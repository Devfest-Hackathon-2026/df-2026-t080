import { useEffect, useRef, useState } from 'react'
import type { AreaData } from '../types'
import type { Plan, PlanInput, UsualPlan } from './planner'
import type { PlanRequest, PlanResponse } from './planWorker'
import { lang } from './i18n'

// 入力が変わるたびに裏で計算し、最後に頼んだ分の結果だけを使う。
// current: いまの入力で計算し終えた結果か（組み直しの途中なら false）
export function usePlan(data: AreaData | null, input: PlanInput) {
  const worker = useRef<Worker | null>(null)
  const seq = useRef(0)
  const asked = useRef<{ data: AreaData; input: PlanInput } | null>(null)
  const [result, setResult] = useState<{ plan: Plan; usual: UsualPlan; data: AreaData; input: PlanInput } | null>(null)
  const [pending, setPending] = useState(false)

  useEffect(() => {
    const w = new Worker(new URL('./planWorker.ts', import.meta.url), { type: 'module', name: lang })
    w.onmessage = (e: MessageEvent<PlanResponse>) => {
      if (e.data.id !== seq.current || !asked.current) return
      setResult({ plan: e.data.plan, usual: e.data.usual, ...asked.current })
      setPending(false)
    }
    worker.current = w
    return () => w.terminate()
  }, [])

  useEffect(() => {
    if (!data || !worker.current) return
    asked.current = { data, input }
    const id = ++seq.current
    setPending(true)
    worker.current.postMessage({ id, data, input } satisfies PlanRequest)
  }, [data, input])

  // 別のエリアに切り替えた直後は、古いエリアの結果を見せない
  const fresh = result && data && (result.data === data || result.data.area.name === data.area.name) ? result : null
  return { plan: fresh?.plan ?? null, usual: fresh?.usual ?? null, pending, current: !!fresh && fresh.input === input && fresh.data === data }
}
