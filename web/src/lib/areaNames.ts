import { isEn } from './i18n'

// 行き先の例に出すエリアの、日本語と英語の名前
export const AREA_NAMES: { ja: string; en: string }[] = [
  { ja: '鎌倉', en: 'Kamakura' },
  { ja: '浅草', en: 'Asakusa' },
  { ja: '横浜', en: 'Yokohama' },
  { ja: '箱根', en: 'Hakone' },
  { ja: '日光', en: 'Nikko' },
  { ja: '京都', en: 'Kyoto' },
  { ja: '奈良', en: 'Nara' },
  { ja: '金沢', en: 'Kanazawa' },
]

// 旅の題の中の、例のエリアの名前を画面の言語の名前にする（ほかの名前は書いたまま）
export function localTitle(title: string): string {
  return title
    .split(' → ')
    .map((part) => {
      const a = AREA_NAMES.find((x) => x.ja === part || x.en === part)
      return a ? (isEn ? a.en : a.ja) : part
    })
    .join(' → ')
}
