import { tr } from '../lib/i18n'

const BY = tr({ ja: 'Gemini が作成', en: 'Made by Gemini' })

// Gemini が作った文の頭に付ける小さな記号（文字は出さない）。形の出典: Lucide（https://lucide.dev）の sparkles。
// ISC ライセンス（https://lucide.dev/license）。著作権は Lucide Contributors にあり、一部は Feather（MIT・Cole Bemis）に由来する。
export function GeminiMark() {
  return (
    <span className="ai-mark" role="img" aria-label={BY} title={BY}>
      <svg viewBox="0 0 24 24" width="12" height="12" aria-hidden="true">
        <path d="M9.937 15.5A2 2 0 0 0 8.5 14.063l-6.135-1.582a.5.5 0 0 1 0-.962L8.5 9.936A2 2 0 0 0 9.937 8.5l1.582-6.135a.5.5 0 0 1 .963 0L14.063 8.5A2 2 0 0 0 15.5 9.937l6.135 1.581a.5.5 0 0 1 0 .964L15.5 14.063a2 2 0 0 0-1.437 1.437l-1.582 6.135a.5.5 0 0 1-.963 0z" />
        <path d="M20 3v4" />
        <path d="M22 5h-4" />
        <path d="M4 17v2" />
        <path d="M5 18H3" />
      </svg>
    </span>
  )
}
