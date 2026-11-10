// プランの題（その日の楽しみの 1 行）の言い方の試験。実行: node --test web/tests/highlight-title.test.mjs
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createServer } from 'vite'

globalThis.window ??= { localStorage: { getItem: () => null, setItem: () => {} }, addEventListener: () => {}, location: { search: '' }, navigator: { languages: ['ja'], language: 'ja' } }
globalThis.localStorage ??= window.localStorage

const server = await createServer({ root: new URL('..', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1'), server: { middlewareMode: true }, appType: 'custom', logLevel: 'silent' })
const { highlightParts } = await server.ssrLoadModule('/src/lib/highlight.ts')

const stop = (name, slot, kind, tags) => ({ spot: { name, kind, tags, lat: 35.3, lng: 139.5 }, slot, arrive: 12 * 60 })

test('名前に空白がある店は「」でくくり、前の場所と続けて読ませない', () => {
  const parts = highlightParts([stop('高徳院', 'sight', 'temple', []), stop('海沿いの キコリ食堂', 'lunch', 'food', ['魚'])], '2026-11-14', [])
  assert.equal(parts.join(''), '高徳院と「海沿いの キコリ食堂」の魚料理')
})

test('空白の無い名前は、そのまま続ける', () => {
  const parts = highlightParts([stop('鶴岡八幡宮', 'sight', 'shrine', []), stop('小町通り', 'sight', 'street', ['甘味'])], '2026-11-14', [])
  assert.equal(parts.join(''), '鶴岡八幡宮と小町通りの食べ歩き')
})

test('店が並ぶだけの通りは、食べ歩きと言わない', () => {
  const parts = highlightParts([stop('法然院', 'sight', 'temple', []), stop('先斗町', 'sight', 'street', ['和食', '酒', '散策'])], '2026-11-14', [])
  assert.equal(parts.join(''), '法然院と先斗町の散策')
})

test('全角の空白も「」でくくる', () => {
  const parts = highlightParts([stop('南禅寺　天授庵', 'sight', 'temple', ['庭'])], '2026-11-14', [])
  assert.equal(parts.join(''), '「南禅寺　天授庵」の庭')
})

test('食事の希望の札に合う店は、札の言葉で書く（たこ焼き屋を「魚料理」と書かない）', () => {
  const stops = [stop('綱敷天神社 御旅社', 'sight', 'shrine', []), stop('多幸屋 2組', 'lunch', 'food', ['魚', '郷土料理'])]
  const conds = [{ tag: '郷土料理', label: 'たこ焼き' }, { tag: '静か', label: '混雑を避ける' }]
  assert.equal(highlightParts(stops, '2026-11-14', conds.map((c) => c.tag), conds).join(''), '「綱敷天神社 御旅社」と「多幸屋 2組」のたこ焼き')
  assert.equal(highlightParts(stops, '2026-11-14', []).join(''), '「綱敷天神社 御旅社」と「多幸屋 2組」の魚料理')
})

test('食べ物でない札の言葉は、店の言葉にしない', () => {
  const stops = [stop('海沿いの キコリ食堂', 'lunch', 'food', ['魚', '屋内'])]
  const conds = [{ tag: '屋内', label: '雨でも楽しめる場所' }]
  assert.equal(highlightParts(stops, '2026-11-14', ['屋内'], conds).join(''), '「海沿いの キコリ食堂」の魚料理')
})

test.after(() => server.close())
