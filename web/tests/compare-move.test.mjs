// 概要の札の、よくある回り方と比べた移動の差の言い方の試験。実行: node --test web/tests/compare-move.test.mjs
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createServer } from 'vite'

globalThis.window ??= { localStorage: { getItem: () => null, setItem: () => {} }, addEventListener: () => {}, location: { search: '' }, navigator: { languages: ['ja'], language: 'ja' } }
globalThis.localStorage ??= window.localStorage

const server = await createServer({ root: new URL('..', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1'), server: { middlewareMode: true }, appType: 'custom', logLevel: 'silent' })
const { moveWords } = await server.ssrLoadModule('/src/components/Compare.tsx')

test('移動が短いときは、符号を付けずに「短くなります」と言う', () => {
  assert.deepEqual(moveWords(-5), ['移動は', '5分', '短くなります'])
})

test('移動が長いときは「長くなります」と言う', () => {
  assert.deepEqual(moveWords(12.4), ['移動は', '12分', '長くなります'])
})

test('1時間を超える差は時間と分で言う', () => {
  assert.deepEqual(moveWords(-75), ['移動は', '1時間15分', '短くなります'])
})

test('分に丸めて同じなら出さない', () => {
  assert.equal(moveWords(0), null)
  assert.equal(moveWords(0.4), null)
  assert.equal(moveWords(-0.4), null)
})

test.after(() => server.close())
