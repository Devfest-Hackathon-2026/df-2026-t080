import type { Plugin } from 'vite'

// Astryx の CSS（全部の部品の StyleX のクラス）から、組み立てた JS のどこにも出てこないクラスの規則を落とす。
// StyleX のクラス名は x で始まる短い名前で、JS には文字列のまま入るので、JS に無い名前は画面に付くことが無い。
// 「:root, .x…」のように並べた選び方は、1 つでも生きていれば規則を残す。
const NAME = /x[a-z0-9]{5,9}/g
const IN_SELECTOR = /\.(x[a-z0-9]{5,9})\b/g
const NESTED = /^@(media|supports|layer|container)\b/

function prune(css: string, used: Set<string>): string {
  let out = ''
  let i = 0
  while (i < css.length) {
    const open = css.indexOf('{', i)
    const semi = css.indexOf(';', i)
    if (open < 0) {
      out += css.slice(i)
      break
    }
    if (semi >= 0 && semi < open && css.slice(i, semi).trim().startsWith('@')) {
      out += css.slice(i, semi + 1)
      i = semi + 1
      continue
    }
    let depth = 1
    let k = open + 1
    while (depth > 0 && k < css.length) {
      if (css[k] === '{') depth++
      else if (css[k] === '}') depth--
      k++
    }
    const head = css.slice(i, open)
    const body = css.slice(open + 1, k - 1)
    if (NESTED.test(head.trim())) {
      const inner = prune(body, used)
      if (inner.trim()) out += `${head}{${inner}}`
    } else {
      if (head.split(',').some((sel) => [...sel.matchAll(IN_SELECTOR)].every((m) => used.has(m[1])))) out += css.slice(i, k)
    }
    i = k
  }
  return out
}

export function astryxCssPrune(): Plugin {
  return {
    name: 'astryx-css-prune',
    apply: 'build',
    enforce: 'post',
    generateBundle(_, bundle) {
      const used = new Set<string>()
      for (const f of Object.values(bundle)) if (f.type === 'chunk') for (const m of f.code.matchAll(NAME)) used.add(m[0])
      for (const f of Object.values(bundle)) {
        if (f.type !== 'asset' || !f.fileName.endsWith('.css') || typeof f.source !== 'string') continue
        f.source = prune(f.source, used)
      }
    },
  }
}
