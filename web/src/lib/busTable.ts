// 場所どうしの、乗換なしのバス・電車で戸口から戸口までの目安の表をサーバーに聞く（エリアに関わる時刻表と、時刻表の無い組みは電車の路線と駅から）。
// サーバーが無い・時刻表も電車の路線も使えないときは null（画面の式で見積もる）
import type { AreaData, RailOpt, TransitTable } from '../types'
import { hasServer } from './api'
import { lang } from './i18n'
import { tableIds, tablePoints } from './geo'
import type { BusSource } from './bus'

// 目安の表と、表に使った時刻表の出典
export type BusTable = TransitTable & { sources: BusSource[] }

const asked = new Map<string, Promise<BusTable | null>>()
const wait = (ms: number) => new Promise((r) => window.setTimeout(r, ms))

// signal: 頼んだ側が要らなくなったら（エリアのデータが変わったなど）、聞き直しをやめる
export function fetchBusTable(data: AreaData, date: string, start: number, end: number, signal?: AbortSignal): Promise<BusTable | null> {
  if (!hasServer) return Promise.resolve(null)
  const ids = tableIds(data).slice(0, 60)
  const points = tablePoints(data).slice(0, 60).map((p) => [p.lat, p.lng])
  const key = `${JSON.stringify(points)}|${date}|${start}|${end}|${lang}`
  const hit = asked.get(key)
  if (hit) return hit
  const body = JSON.stringify({ points, date, start, end, lang })
  const p = (async () => {
    // 冷えたサーバーは時刻表と路線を取るのに時間がかかるので、取り終わるまで聞き直す（はじめは 5 秒おき、あとは 10 秒おきに 2 分ほど）。
    // プランは表を待たずに出し、表が後から届いたら組み直す（App.tsx の TABLE_WAIT）
    for (let i = 0; i < 16; i++) {
      if (signal?.aborted) return null
      try {
        const r = await fetch('/api/bus-table', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body, signal })
        if (!r.ok) return null
        const j = (await r.json()) as { minutes?: (number | null)[][]; loading?: boolean; sources?: BusSource[]; rail?: { opts?: RailOpt[]; via?: (number | null)[][] } }
        if (j.minutes && j.minutes.length === ids.length) {
          const rail = j.rail?.opts?.length && j.rail.via?.length === ids.length ? { opts: j.rail.opts, via: j.rail.via } : undefined
          return j.minutes.some((row) => row.some((v) => v != null)) ? { ids, minutes: j.minutes, sources: j.sources ?? [], ...(rail && { rail }) } : null
        }
        if (!j.loading) return null
      } catch {
        return null
      }
      await wait(i < 8 ? 5000 : 10000)
    }
    return null
  })()
  p.then((t) => {
    if (!t && asked.get(key) === p) asked.delete(key)
  })
  // 止めた問い合わせは、すぐに作り置きから外す（同じ点で頼み直したときに、止めた物を返さない）
  signal?.addEventListener('abort', () => {
    if (asked.get(key) === p) asked.delete(key)
  }, { once: true })
  if (asked.size > 20) asked.clear()
  asked.set(key, p)
  return p
}
