// 例のプラン（server/sample.json の example: 7:30〜15:00・4 か所を選ぶ）を再現して、IntenTrip とよくある回り方の並びを出す
import { data, prepare, run } from './lib.ts'
const ex = (data as any).example
for (const t of ['saved', 'none'] as const) {
  prepare(t)
  const r = run({ id: 'S0', group: 'sample', conds: ['有名', '静か'], day: 'holiday', start: ex.start, end: ex.end, must: ex.must, fill: false })
  console.log(t, r.planCrowded, r.usualCrowded, r.screen, r.ms + 'ms')
  for (const s of r.plan) console.log('  plan ', s.arrive, s.name, s.slot, s.stay, 'lv' + s.level)
  for (const s of r.usual) console.log('  usual', s.arrive, s.name, s.slot, s.stay, 'lv' + s.level)
}
