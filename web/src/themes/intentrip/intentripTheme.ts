// IntenTrip のテーマ。Astryx の Neutral を土台に、地を白にし、字の段と押せる大きさを IntenTrip の決まり（data/ui-guidelines.md）に合わせる。
// アクセント（墨）・影・角は Neutral の既定のまま。路線の浅葱は styles.css の --route だけで使う。
// 組み立て: pnpm exec astryx theme build src/themes/intentrip/intentripTheme.ts（intentrip.css・intentrip.js ができる）
import { defineTheme } from '@astryxdesign/core/theme'
import { neutralTheme } from '@astryxdesign/theme-neutral/built'

const JA = "'Hiragino Sans', 'Hiragino Kaku Gothic ProN', 'Noto Sans JP', 'Yu Gothic UI', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif"

// 字の段（大見出し 28・主役の値 22・見出し 17・本文 15・補足 13・注記 11）。h1 は画面の題、h2・h3 はシートの題と塊の見出し
const TEXT = {
  '--text-heading-1-size': '1.75rem',
  '--text-heading-1-weight': 'var(--font-weight-bold)',
  '--text-heading-1-leading': '1.2',
  '--text-heading-2-size': '1.0625rem',
  '--text-heading-2-weight': 'var(--font-weight-bold)',
  '--text-heading-2-leading': '1.3',
  '--text-heading-3-size': '1.0625rem',
  '--text-heading-3-weight': 'var(--font-weight-bold)',
  '--text-heading-3-leading': '1.3',
  '--text-heading-4-size': '0.9375rem',
  '--text-heading-4-weight': 'var(--font-weight-bold)',
  '--text-heading-4-leading': '1.5',
  '--text-heading-5-size': '0.8125rem',
  '--text-heading-5-weight': 'var(--font-weight-bold)',
  '--text-heading-5-leading': '1.5',
  '--text-heading-6-size': '0.6875rem',
  '--text-heading-6-weight': 'var(--font-weight-bold)',
  '--text-heading-6-leading': '1.5',
  '--text-large-size': '1.375rem',
  '--text-large-leading': '1.2',
  '--text-body-size': '0.9375rem',
  '--text-body-leading': '1.5',
  '--text-label-size': '0.9375rem',
  '--text-label-leading': '1.4',
  '--text-supporting-size': '0.8125rem',
  '--text-supporting-leading': '1.5',
} as const

export const intentripTheme = defineTheme({
  name: 'intentrip',
  extends: neutralTheme,

  typography: {
    scale: { base: 15, ratio: 1.2 },
    body: { family: 'Figtree', fallbacks: JA },
    heading: { family: 'Figtree', fallbacks: JA, weights: { 3: 'bold', 4: 'bold' } },
    code: { family: 'ui-monospace', fallbacks: '"SF Mono", Monaco, Consolas, "Liberation Mono", monospace' },
  },

  // 指で触る狭い画面でも、字の段は同じにする（Neutral は本文を 16px に上げる）
  adaptations: {
    rules: [
      {
        when: { pointer: 'coarse', width: { below: 'lg' } },
        value: { typography: { scale: { base: 15, ratio: 1.2 } }, tokens: TEXT },
      },
    ],
  },

  // 押す前の切り替え（理由の札など）も、押せることが分かるように細い線で囲む
  components: {
    'toggle-button': {
      base: { borderWidth: '1px', borderStyle: 'solid', borderColor: 'var(--color-border-emphasized)' },
      isPressed: { borderColor: 'var(--color-accent)' },
    },
  },

  tokens: {
    ...TEXT,

    // 地は白。札・シート・メニューの重なりは Neutral の既定の影で見せる
    '--color-background-body': ['#ffffff', '#1b1b1b'],

    // 押せる所は 44px 以上
    '--size-element-sm': '2.75rem',
    '--size-element-md': '2.75rem',
    '--size-element-lg': '3rem',
  },
})
