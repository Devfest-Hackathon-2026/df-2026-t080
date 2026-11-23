// 乗る区間の線の縁取りを太くするかの試験。実行: node --test web/tests/line-edge.test.mjs
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createServer } from 'vite'

const server = await createServer({ root: new URL('..', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1'), server: { middlewareMode: true }, appType: 'custom', logLevel: 'silent' })
const { lineEdgeGrow, inkOn } = await server.ssrLoadModule('/src/lib/lineColor.ts')

test('明るい地図で、地の色との差が 3:1 に届かない橙は縁取りを太くする', () => {
  for (const land of ['#f2f3f0', 'rgb(242, 243, 240)', 'rgba(242,243,240,1)', 'hsl(75, 9%, 94%)', '#eef1f4']) assert.equal(lineEdgeGrow('#f19049', false, land), 2, land)
})

test('地の色との差が足りる色と、暗い地図と、読めない色はそのまま', () => {
  assert.equal(lineEdgeGrow('#2f7fd1', false, '#f2f3f0'), 0)
  assert.equal(lineEdgeGrow('#f19049', true, '#141b23'), 0)
  assert.equal(lineEdgeGrow('#f19049', false, 'transparent'), 0)
  assert.equal(lineEdgeGrow('var(--route)', false, '#f2f3f0'), 0)
})

// 路線の札の字の色（#313）。色は京都市バスの観光特急 EX101（赤）・10 系統（青）・204 系統（橙）
test('赤や青の濃い札は白い字、橙の明るい札は黒い字にする', () => {
  assert.equal(inkOn('#d9384f'), '#ffffff')
  assert.equal(inkOn('#5887c6'), '#ffffff')
  assert.equal(inkOn('#f19049'), '#000000')
  assert.equal(inkOn('#ffffff'), '#000000')
  assert.equal(inkOn('#000000'), '#ffffff')
})

test('時刻表の黒い字（既定の値）は決めた色と見ず、黒のほかの色は 3:1 以上の差があれば使う', () => {
  assert.equal(inkOn('#d9384f', '000000'), '#ffffff')
  assert.equal(inkOn('#d9384f', 'FFFFFF'), '#ffffff')
  assert.equal(inkOn('#1a2a5a', 'FFE000'), '#ffe000')
  // 地の色との差が足りない字の色は使わない
  assert.equal(inkOn('#f19049', 'FFFFFF'), '#000000')
  assert.equal(inkOn('#f19049', 'zzz'), '#000000')
})

test('地の色が読めないときは、時刻表の字の色か白', () => {
  assert.equal(inkOn('var(--route)'), '#ffffff')
  assert.equal(inkOn('var(--route)', '112233'), '#112233')
})

test.after(() => server.close())
