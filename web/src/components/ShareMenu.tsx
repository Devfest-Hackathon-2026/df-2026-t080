import { useEffect, useRef, useState, type SVGProps } from 'react'
import { Icon } from '@astryxdesign/core/Icon'
import { IconButton } from '@astryxdesign/core/IconButton'
import { useBackClose } from '../lib/backStack'
import { tr } from '../lib/i18n'

const T = tr({
  ja: { share: '共有', text: 'テキストで共有', image: '画像で保存' },
  en: { share: 'Share', text: 'Share as Text', image: 'Save as Image' },
})

// 共有の形。形の出典: Lucide（https://lucide.dev）の share。ISC ライセンス
function ShareShape(props: SVGProps<SVGSVGElement>) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" {...props}>
      <path d="M4 12v8a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-8" />
      <path d="M16 6l-4-4-4 4" />
      <path d="M12 2v13" />
    </svg>
  )
}

// 見出しの「共有」（送る形のアイコン）。押すと、プランを文で共有するか、画像で保存するかを選ぶ小さなメニューを開く（「戻る」でも閉じる）
export function ShareMenu({ disabled, onText, onImage }: { disabled: boolean; onText: () => void; onImage: () => void }) {
  const [open, setOpen] = useState(false)
  const box = useRef<HTMLDivElement>(null)
  const first = useRef<HTMLButtonElement>(null)
  useBackClose(open, () => setOpen(false))

  useEffect(() => {
    if (!open) return
    first.current?.focus()
    const away = (e: PointerEvent) => {
      if (!box.current?.contains(e.target as Node)) setOpen(false)
    }
    const key = (e: KeyboardEvent) => {
      const items = [...(box.current?.querySelectorAll<HTMLButtonElement>('[role="menuitem"]') ?? [])]
      const at = items.indexOf(document.activeElement as HTMLButtonElement)
      if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
        e.preventDefault()
        items[(at + (e.key === 'ArrowDown' ? 1 : items.length - 1)) % items.length]?.focus()
      } else if (e.key === 'Escape') {
        setOpen(false)
        box.current?.querySelector<HTMLButtonElement>('.share-toggle')?.focus()
      }
    }
    document.addEventListener('pointerdown', away)
    document.addEventListener('keydown', key)
    return () => {
      document.removeEventListener('pointerdown', away)
      document.removeEventListener('keydown', key)
    }
  }, [open])

  const pick = (f: () => void) => () => {
    setOpen(false)
    f()
  }

  return (
    <div className="share-menu" ref={box}>
      <IconButton
        variant="ghost"
        className="share-toggle"
        label={T.share}
        tooltip={T.share}
        icon={<Icon icon={ShareShape} size="md" />}
        aria-haspopup="menu"
        aria-expanded={open}
        isDisabled={disabled}
        onClick={() => setOpen(!open)}
      />
      {open && (
        <div className="share-list" role="menu" aria-label={T.share}>
          <button type="button" role="menuitem" ref={first} onClick={pick(onText)}>
            {T.text}
          </button>
          <button type="button" role="menuitem" onClick={pick(onImage)}>
            {T.image}
          </button>
        </div>
      )}
    </div>
  )
}
