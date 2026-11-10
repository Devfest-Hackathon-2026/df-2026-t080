// 場所の種類のアイコン。一覧の写真の無い場所（Thumb）と、地図の候補の印（lib/mapLayer）の両方が、この形と選び方を使う
import type { Spot } from '../types'
import { odaiKind } from './odai'

export type SpotKind = 'temple' | 'park' | 'culture' | 'street' | 'food' | 'cafe'

const SHOP_TAGS = ['買い物', '古着', '雑貨', '本', '音楽']

export function kindOf(s: Spot): SpotKind {
  if (s.kind === 'food' || s.kind === 'cafe' || s.kind === 'street') return s.kind
  if (s.tags.some((t) => SHOP_TAGS.includes(t))) return 'street'
  const k = odaiKind(s)
  if (k === 'temple' && !s.tags.includes('寺社')) return 'culture'
  return k as 'temple' | 'park' | 'culture'
}

// 種類のアイコンの形（24 四方の線）。
// temple: Tabler Icons（https://tabler.io/icons）の torii。MIT ライセンス（著作権は Paweł Kuna）。
// ほか: Lucide（https://lucide.dev）の trees・landmark・store・utensils・coffee。ISC ライセンス（著作権は Lucide Contributors）
export const KIND_ICON: Record<SpotKind, string[]> = {
  temple: ['M4 4c5.333 1.333 10.667 1.333 16 0', 'M4 8h16', 'M12 5v3', 'M18 4.5v15.5', 'M6 4.5v15.5'],
  park: ['M10 10v.2A3 3 0 0 1 8.9 16H5a3 3 0 0 1-1-5.8V10a3 3 0 0 1 6 0Z', 'M7 16v6', 'M13 19v3', 'M12 19h8.3a1 1 0 0 0 .7-1.7L18 14h.3a1 1 0 0 0 .7-1.7L16 9h.2a1 1 0 0 0 .8-1.7L13 3l-1.4 1.5'],
  culture: ['M3 22h18', 'M6 18v-7', 'M10 18v-7', 'M14 18v-7', 'M18 18v-7', 'M12 2l8 5H4z'],
  street: [
    'm2 7 4.41-4.41A2 2 0 0 1 7.83 2h8.34a2 2 0 0 1 1.42.59L22 7',
    'M4 12v8a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-8',
    'M15 22v-4a2 2 0 0 0-2-2h-2a2 2 0 0 0-2 2v4',
    'M2 7h20',
    'M22 7v3a2 2 0 0 1-2 2a2.7 2.7 0 0 1-1.59-.63.7.7 0 0 0-.82 0A2.7 2.7 0 0 1 16 12a2.7 2.7 0 0 1-1.59-.63.7.7 0 0 0-.82 0A2.7 2.7 0 0 1 12 12a2.7 2.7 0 0 1-1.59-.63.7.7 0 0 0-.82 0A2.7 2.7 0 0 1 8 12a2.7 2.7 0 0 1-1.59-.63.7.7 0 0 0-.82 0A2.7 2.7 0 0 1 4 12a2 2 0 0 1-2-2V7',
  ],
  food: ['M3 2v7c0 1.1.9 2 2 2h4a2 2 0 0 0 2-2V2', 'M7 2v20', 'M21 15V2a5 5 0 0 0-5 5v6c0 1.1.9 2 2 2h3Zm0 0v7'],
  cafe: ['M10 2v2', 'M14 2v2', 'M16 8a1 1 0 0 1 1 1v8a4 4 0 0 1-4 4H7a4 4 0 0 1-4-4V9a1 1 0 0 1 1-1h14a4 4 0 1 1 0 8h-1', 'M6 2v2'],
}
