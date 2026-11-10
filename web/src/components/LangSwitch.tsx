import { Button } from '@astryxdesign/core/Button'
import { askOpenAfterLang } from '../lib/homeIntent'
import { isEn, setLang } from '../lib/i18n'

// 言語の切り替え。いまと違う言語の名前を、その言語で 1 つだけ出す（押すとページを読み直す）
// 名前はその言語で読み上げるので、ボタンに lang を付ける（Astryx の Button の型には無いが、要素へそのまま渡る）
// after: 読み直したあとに開く画面（無ければホーム画面）
export function LangSwitch({
  className = 'lang-switch',
  variant = 'ghost',
  wide = false,
  after,
}: {
  className?: string
  variant?: 'ghost' | 'secondary'
  wide?: boolean
  after?: 'form'
}) {
  const next = isEn ? 'ja' : 'en'
  const name = isEn ? '日本語' : 'English'
  return (
    <Button
      variant={variant}
      className={className}
      label={name}
      width={wide ? '100%' : undefined}
      {...({ lang: next } as object)}
      onClick={() => {
        if (after) askOpenAfterLang(after)
        setLang(next)
      }}
    />
  )
}
