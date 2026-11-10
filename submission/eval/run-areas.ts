// 入力画面の 8 エリア（areas/*.json の作り置き）で、よくある回り方との比べを流す。移動はアプリの式で見積もる（道の表・時刻表の目安なし）
// 使い方: tsx run-areas.ts → results-areas.json
import { readdirSync, readFileSync, writeFileSync } from 'node:fs'
import type { AreaData } from '../../web/src/types.ts'
import { run, useArea, type Case } from './lib.ts'

const H = (h: number, m = 0) => h * 60 + m
const hm = (m: number) => `${Math.floor(m / 60)}:${String(m % 60).padStart(2, '0')}`
const dir = new URL('./areas/', import.meta.url)
const rows = []
for (const f of readdirSync(dir).filter((x) => x.endsWith('.json')).sort()) {
  const d = JSON.parse(readFileSync(new URL(f, dir), 'utf8')) as AreaData
  useArea(d)
  const area = d.area.name
  for (const day of ['holiday', 'weekday'] as const)
    for (const start of [H(8), H(9), H(10), H(12)])
      for (const end of [H(15), H(18)]) {
        const c: Case = { id: `${area}-${day === 'holiday' ? '休' : '平'}-${hm(start)}-${hm(end)}`, group: area, conds: [], day, start, end }
        const r = run(c)
        rows.push({ area, ...r })
      }
  console.error(`${area} ${d.places.length} か所`)
}
writeFileSync(new URL('./results-areas.json', import.meta.url), JSON.stringify({ made: new Date().toISOString(), n: rows.length, rows }, null, 1))
console.error(`done ${rows.length} rows`)
