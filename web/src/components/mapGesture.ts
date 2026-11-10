// 地図を指で動かす決まり（Google マップの既定の gestureHandling: 'auto' と同じく、ページを送れるかで分ける）。
// ページを送れる狭い画面では、1 本の指でページを送り、地図は 2 本の指で動かす（パソコンでは Ctrl か ⌘ を押しながらスクロールで拡大）。
// 広い画面・地図を全画面で表示しているとき・下から出る画面でページを止めているときは、1 本の指で地図を動かす
import { useEffect, useState } from 'react'
import { tr } from '../lib/i18n'

const WIDE = '(min-width: 960px)'

// MapLibre の案内の言葉（Google マップが出す言葉と同じにする）
export const COOP_LOCALE = tr({
  ja: {
    'CooperativeGesturesHandler.WindowsHelpText': '地図をズームするには、Ctrl キーを押しながらスクロールしてください',
    'CooperativeGesturesHandler.MacHelpText': '地図をズームするには、⌘ キーを押しながらスクロールしてください',
    'CooperativeGesturesHandler.MobileHelpText': '地図を移動させるには指 2 本で操作します',
  },
  en: {
    'CooperativeGesturesHandler.WindowsHelpText': 'Use ctrl + scroll to zoom the map',
    'CooperativeGesturesHandler.MacHelpText': 'Use ⌘ + scroll to zoom the map',
    'CooperativeGesturesHandler.MobileHelpText': 'Use two fingers to move the map',
  },
})

// components/Sheet の lockScroll は、ページを止めている間 body を position: fixed にする
const pageLocked = () => document.body.style.position === 'fixed'

export function useMapGestures(): { big: boolean; setBig: (v: boolean) => void; oneFinger: boolean } {
  const [wide, setWide] = useState(() => window.matchMedia(WIDE).matches)
  const [locked, setLocked] = useState(pageLocked)
  const [big, setBig] = useState(false)
  useEffect(() => {
    const mq = window.matchMedia(WIDE)
    const onWide = () => setWide(mq.matches)
    mq.addEventListener('change', onWide)
    const mo = new MutationObserver(() => setLocked(pageLocked()))
    mo.observe(document.body, { attributes: true, attributeFilter: ['style'] })
    return () => {
      mq.removeEventListener('change', onWide)
      mo.disconnect()
    }
  }, [])
  // 全画面の間は、Escape で元に戻す（下から出る画面が開いているときは、その画面を先に閉じる）
  useEffect(() => {
    if (!big) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !document.querySelector('.sheet-layer')) setBig(false)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [big])
  const isBig = big && !wide
  return { big: isBig, setBig, oneFinger: wide || isBig || locked }
}
