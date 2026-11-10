import { useEffect, useRef, useState, type PointerEvent, type ReactNode } from 'react'
import { Button } from '@astryxdesign/core/Button'
import { Heading } from '@astryxdesign/core/Heading'
import { IconButton } from '@astryxdesign/core/IconButton'
import { Icon } from '@astryxdesign/core/Icon'
import { Text } from '@astryxdesign/core/Text'
import { useBackClose } from '../lib/backStack'
import { tr } from '../lib/i18n'

const T = tr({ ja: { back: '戻る', close: '閉じる' }, en: { back: 'Back', close: 'Close' } })

const WIDE = '(min-width: 960px)'

// 広い画面（左に一覧、右に地図）か
function useWide(): boolean {
  const [wide, setWide] = useState(() => window.matchMedia(WIDE).matches)
  useEffect(() => {
    const mq = window.matchMedia(WIDE)
    const on = () => setWide(mq.matches)
    mq.addEventListener('change', on)
    return () => mq.removeEventListener('change', on)
  }, [])
  return wide
}

let locks = 0
let saved: { y: number; prev: Pick<CSSStyleDeclaration, 'position' | 'top' | 'left' | 'right' | 'overflow'> } | null = null

function lockScroll(card: boolean) {
  locks += 1
  if (locks > 1) return
  const y = window.scrollY
  const b = document.body.style
  saved = { y, prev: { position: b.position, top: b.top, left: b.left, right: b.right, overflow: b.overflow } }
  b.position = 'fixed'
  b.top = card ? '0px' : `-${y}px`
  b.left = '0'
  b.right = '0'
  b.overflow = 'hidden'
}

function unlockScroll() {
  locks = Math.max(0, locks - 1)
  if (locks > 0 || !saved) return
  const { y, prev } = saved
  saved = null
  Object.assign(document.body.style, prev)
  window.scrollTo(0, y)
}

function inertOutside(layer: Element | null): HTMLElement[] {
  const set: HTMLElement[] = []
  for (let el = layer; el && el.parentElement && el !== document.body; el = el.parentElement) {
    for (const sib of el.parentElement.children) {
      if (sib === el || !(sib instanceof HTMLElement) || sib.inert) continue
      sib.inert = true
      set.push(sib)
    }
  }
  return set
}

// 下から出るシート。上のつまみと見出しを下へなぞると閉じる。
// card のときは暗幕を置かず、狭い画面では下半分の高さで開く（上の地図が見えて、触れる）。つまみを上へなぞるか押すと広がる。
// 広い画面では、どのシートも左の列いっぱいに出て一覧と入れ替わり、「戻る」で一覧に戻る。
// back のときは、閉じる代わりに前の画面に戻る（どの幅でも「戻る」）。
// 開いている間は履歴に 1 つ積み、スマホやブラウザの「戻る」でも閉じる。
// grow になったら、card でも狭い画面で高さいっぱいに広げる（読み取った結果など、下まで見てほしい物が出たとき）
// grow に数を渡したときは、数が変わるたびに広げる（押すたびに広げるボタン）。
// closeLabel は、閉じるボタン（×）の読み上げの名前（中の変更がすぐ入るシートは「完了」）
export function Sheet({
  title,
  lead,
  onClose,
  children,
  card = false,
  back = false,
  grow = false,
  closeLabel,
}: {
  title: ReactNode
  lead?: ReactNode
  onClose: () => void
  children: ReactNode
  card?: boolean
  back?: boolean
  grow?: boolean | number
  closeLabel?: string
}) {
  const ref = useRef<HTMLDivElement>(null)
  const wide = useWide()
  const toBack = back || wide
  const [full, setFull] = useState(!card)
  useEffect(() => {
    if (grow) setFull(true)
  }, [grow])
  const drag = useRef<{ id: number; y: number; dy: number } | null>(null)
  const closeRef = useRef(onClose)
  closeRef.current = onClose
  useBackClose(true, onClose, back)

  useEffect(() => {
    const before = document.activeElement
    ref.current?.focus()
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && closeRef.current()
    window.addEventListener('keydown', onKey)
    const freed = card ? [] : inertOutside(ref.current?.closest('.sheet-layer') ?? null)
    return () => {
      window.removeEventListener('keydown', onKey)
      for (const el of freed) el.inert = false
      if (before instanceof HTMLElement && before !== document.body && before.isConnected) before.focus({ preventScroll: true })
    }
  }, [])

  // 開いている間は下のページを止め、閉じたら元の位置に戻す。
  // 重なって開いたときは、最初の 1 枚が止め、最後の 1 枚が閉じたときに戻す
  useEffect(() => {
    lockScroll(card)
    return unlockScroll
  }, [])

  const down = (e: PointerEvent<HTMLDivElement>) => {
    if (wide) return
    if ((e.target as HTMLElement).closest('button, a')) return
    drag.current = { id: e.pointerId, y: e.clientY, dy: 0 }
    e.currentTarget.setPointerCapture(e.pointerId)
  }
  const move = (e: PointerEvent<HTMLDivElement>) => {
    const d = drag.current
    if (!d || d.id !== e.pointerId || !ref.current) return
    d.dy = card ? e.clientY - d.y : Math.max(0, e.clientY - d.y)
    ref.current.style.transform = d.dy > 0 ? `translateY(${d.dy}px)` : ''
    ref.current.style.transition = 'none'
  }
  const up = (e: PointerEvent<HTMLDivElement>) => {
    const d = drag.current
    if (!d || d.id !== e.pointerId || !ref.current) return
    drag.current = null
    ref.current.style.transition = ''
    ref.current.style.transform = ''
    if (d.dy > 90) {
      if (card && full) setFull(false)
      else onClose()
    } else if (card && d.dy < -40) setFull(true)
    else if (card && Math.abs(d.dy) < 6) setFull((f) => !f)
  }

  return (
    <div className={card ? 'sheet-layer card' : 'sheet-layer'}>
      {!card && <div className="sheet-scrim" onClick={onClose} />}
      <div
        className={card ? 'sheet card' : 'sheet'}
        data-size={card ? (full ? 'full' : 'peek') : undefined}
        role="dialog"
        aria-modal={card ? undefined : true}
        aria-labelledby="sheet-title"
        tabIndex={-1}
        ref={ref}
      >
        <div className="sheet-handle" onPointerDown={down} onPointerMove={move} onPointerUp={up} onPointerCancel={up}>
          <div className="sheet-grabber" aria-hidden="true" />
          <div className="sheet-bar">
            {toBack && <Button variant="ghost" className="sheet-back" label={T.back} icon={<Icon icon="chevronLeft" />} onClick={onClose} />}
            <div className="sheet-heading">
              <Heading level={2} id="sheet-title">
                {title}
              </Heading>
              {lead && (
                <Text as="p" display="block" type="supporting" color="secondary">
                  {lead}
                </Text>
              )}
            </div>
            {!toBack && <IconButton variant="secondary" className="sheet-close" label={closeLabel ?? T.close} icon={<Icon icon="close" />} onClick={onClose} />}
          </div>
        </div>
        <div className="sheet-body">{children}</div>
      </div>
    </div>
  )
}
