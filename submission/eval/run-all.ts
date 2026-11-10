// 条件を変えたプランを組み、画面と同じ定義で「混雑する場所にいる時間」を IntenTrip とよくある回り方で比べる。
// 使い方: tsx run-all.ts saved|none   （saved＝画面と同じく時刻表の目安の表あり、none＝表なし・式で見積もる）
import { writeFileSync } from 'node:fs'
import { data, idOf, prepare, run, type Case } from './lib.ts'

const table = (process.argv[2] ?? 'saved') as 'saved' | 'none'
prepare(table)

const H = (h: number, m = 0) => h * 60 + m
const SUBSETS: string[][] = [[], ['有名'], ['静か'], ['有名', '静か']]
const EX = ['有名', '静か'] // 例の希望（有名な所も行きたいけど混雑は避けたい）の札
const name = (c: string[]) => (c.length ? c.join('+') : '希望なし')
const DAY = (d: string) => (d === 'holiday' ? '休' : '平')
const hm = (m: number) => `${Math.floor(m / 60)}:${String(m % 60).padStart(2, '0')}`
const cases: Case[] = []

// A: おまかせ（場所もアプリが選ぶ）。希望の札（調整の画面で付け外しできる 2 つ）× 曜日 × 出発 × 帰る時刻
for (const conds of SUBSETS)
  for (const day of ['holiday', 'weekday'] as const)
    for (const start of [H(7, 30), H(9), H(10), H(12)])
      for (const end of [H(15), H(18)])
        cases.push({ id: `A-${name(conds)}-${DAY(day)}-${hm(start)}-${hm(end)}`, group: 'A', conds, day, start, end })

// A2: 画面の「回り方」の設定（休日・例の 7:30〜15:00）
for (const conds of SUBSETS) cases.push({ id: `A2-calm-${name(conds)}`, group: 'A2', note: '混雑をもっと避ける', conds, day: 'holiday', start: H(7, 30), end: H(15), calm: true })
for (const conds of [EX, []]) {
  cases.push({ id: `A2-slow-${name(conds)}`, group: 'A2', note: 'ゆっくり', conds, day: 'holiday', start: H(7, 30), end: H(15), pace: 'slow' })
  cases.push({ id: `A2-many-${name(conds)}`, group: 'A2', note: 'たくさん', conds, day: 'holiday', start: H(7, 30), end: H(15), pace: 'many' })
}
cases.push({ id: 'A2-moveLess-例', group: 'A2', note: '移動を少なく', conds: EX, day: 'holiday', start: H(7, 30), end: H(15), moveLess: true })
cases.push({ id: 'A2-10-18-例', group: 'A2', note: '10:00〜18:00', conds: EX, day: 'holiday', start: H(10), end: H(18) })
cases.push({ id: 'A2-end17-例', group: 'A2', note: '帰る時刻 17:00', conds: EX, day: 'holiday', start: H(7, 30), end: H(17) })
cases.push({ id: 'A2-end20-例', group: 'A2', note: '帰る時刻 20:00', conds: EX, day: 'holiday', start: H(7, 30), end: H(20) })

// B: 同じ場所の並びだけ。行きたい場所（must）と昼食の店（pinned）を決め、ほかの候補は全部外す（banned）。アプリは順番と時刻だけを決める
const LUNCH = idOf('手打ちそば 花もも')
const SETS: Record<string, string[]> = {
  定番3: ['清水寺', '伏見稲荷大社', '金閣寺'],
  洛中と東山: ['清水寺', '二条城', '錦市場'],
  嵐山: ['嵐山竹林の小径', '天龍寺', '鹿王院'],
  有名と静か4: ['金閣寺', '二条城', '南禅寺 天授庵', '法然院'],
  東山4: ['清水寺', '花見小路通', '法住寺', '新熊野神社'],
  静かな所3: ['詩仙堂', '宝泉院', '法然院'],
}
for (const [set, names] of Object.entries(SETS)) {
  const must = names.map(idOf)
  const keep = new Set([...must, LUNCH])
  const banned = data.places.filter((p) => !keep.has(p.id)).map((p) => p.id)
  for (const day of ['holiday', 'weekday'] as const)
    for (const start of [H(9), H(10)])
      cases.push({ id: `B-${set}-${DAY(day)}-${hm(start)}`, group: 'B', note: names.join('・'), conds: [], day, start, end: H(18), must, pinned: [{ id: LUNCH, slot: 'lunch' }], banned, fill: false })
}

// EX: 例の 4 か所（清水寺・白川一本橋・花見小路通・法住寺）を選んで組む（画面の「行きたい場所を選ぶ」→「この場所でプランを作る」と同じ。食事の店はアプリが選ぶ）
const exMust: string[] = (data as any).example?.must ?? []
for (const day of ['holiday', 'weekday'] as const)
  for (const start of [H(7, 30), H(9), H(10), H(12)])
    cases.push({ id: `EX-${DAY(day)}-${hm(start)}`, group: 'EX', note: '例の 4 か所', conds: EX, day, start, end: start === H(12) ? H(18) : H(15), must: exMust, fill: false })

const rows = cases.map((c, i) => {
  const r = run(c)
  if (i % 20 === 0) console.error(`${i}/${cases.length} ${c.id} ${r.ms}ms`)
  return r
})

writeFileSync(new URL(`./results-${table}.json`, import.meta.url), JSON.stringify({ table, made: new Date().toISOString(), area: data.area.name, n: rows.length, rows }, null, 1))
console.error(`done ${rows.length} rows`)
