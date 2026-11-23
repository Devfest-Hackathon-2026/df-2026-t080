import { Button } from '@astryxdesign/core/Button'
import { Icon } from '@astryxdesign/core/Icon'
import { tr } from '../lib/i18n'

const T = tr({
  ja: { label: '旅', aria: '自分の旅（ホーム画面）へ戻る' },
  en: { label: 'Trips', aria: 'Back to your trips' },
})

// 見出しの左の、自分の旅（ホーム画面）へ戻るボタン。「＜」に「旅」を添えて、どこへ戻るかが分かるようにする。
// to: ホーム画面ではない戻る先（言葉と読み上げの名前）
export function HomeButton({ onClick, to }: { onClick: () => void; to?: { label: string; aria: string } }) {
  const aria = to?.aria ?? T.aria
  return (
    <Button variant="ghost" className="top-home" label={aria} tooltip={aria} icon={<Icon icon="chevronLeft" />} onClick={onClick}>
      <span aria-hidden="true">{to?.label ?? T.label}</span>
    </Button>
  )
}
