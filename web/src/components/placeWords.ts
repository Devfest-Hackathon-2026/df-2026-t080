import type { Spot } from '../types'
import { tr } from '../lib/i18n'

// 場所の画面（プランの場所・候補）で同じに出す言葉
export const PLACE_WORDS = tr({
  ja: {
    kind: { sight: '見どころ', street: '通り', food: '食事', cafe: 'カフェ' } as Record<Spot['kind'], string>,
    famous: '人気スポット',
    hidden: '隠れた名所',
    sep: '・',
    why: '特徴',
    downside: '注意点',
    busy: '混雑する時間帯',
    estimate: (holiday: boolean) => `${holiday ? '休日' : '平日'}の推定です。`,
    maps: 'Google マップで開く',
    noRoom: '端末の空きが足りないため、理由を保存できませんでした',
    remove: 'プランから外す',
  },
  en: {
    kind: { sight: 'Sight', street: 'Street', food: 'Food', cafe: 'Café' },
    famous: 'Popular',
    hidden: 'Hidden gem',
    sep: ' · ',
    why: 'About',
    downside: 'Heads-Up',
    busy: 'Popular Times',
    estimate: (holiday: boolean) => (holiday ? 'Estimate for weekends and holidays. ' : 'Estimate for weekdays. '),
    maps: 'Open in Google Maps',
    noRoom: 'Not enough storage to save your reason',
    remove: 'Remove from Plan',
  },
})

// Google マップで探すときの名前（英語の候補は日本語の名前で探すほうが確かなので、あれば日本語の名前）
export const searchName = (p: { name: string; ja?: string }) => p.ja || p.name
