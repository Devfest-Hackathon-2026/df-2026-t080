import { useEffect, useLayoutEffect, useRef } from 'react'

// 画面（ホーム・入力・選ぶ・プラン）が替わったら、先頭から見せる。「戻る」で前の画面に戻ったときは、離れたときの位置に戻す。
// 位置は、窓と、広い画面の左の列（.panel）の両方を覚える
type Pos = { win: number; panel: number }
const TOP: Pos = { win: 0, panel: 0 }
// 中身があとから届く画面では、届くまでこの長さだけ位置を合わせ直す（その間に本人が動かしたら、やめる）
const SETTLE_MS = 1500

const panelOf = () => document.querySelector<HTMLElement>('.plan-view > .panel')
const put = (to: Pos) => {
  window.scrollTo(0, to.win)
  const pn = panelOf()
  if (pn) pn.scrollTop = to.panel
}

// 戻す前に呼ぶ関数を返す（次に画面が替わったときだけ、元の位置に戻す）
export function useViewScroll(view: string): () => void {
  const at = useRef<Record<string, Pos>>({})
  const cur = useRef(view)
  const back = useRef(false)
  const want = useRef<Pos | null>(null)

  useEffect(() => {
    if ('scrollRestoration' in window.history) window.history.scrollRestoration = 'manual'
    const on = (e: Event) => {
      // シートが窓を止めている間の位置は、覚えない
      if (document.body.style.position === 'fixed') return
      const p = { ...(at.current[cur.current] ?? TOP) }
      if (e.target === document) p.win = window.scrollY
      else if (e.target instanceof HTMLElement && e.target === panelOf()) p.panel = e.target.scrollTop
      else return
      at.current[cur.current] = p
    }
    document.addEventListener('scroll', on, { capture: true, passive: true })
    return () => document.removeEventListener('scroll', on, { capture: true })
  }, [])

  useLayoutEffect(() => {
    if (cur.current === view) return
    cur.current = view
    const to = back.current ? (at.current[view] ?? TOP) : TOP
    back.current = false
    want.current = to
    put(to)
  }, [view])

  // 閉じたシートが窓の位置を戻したあとに、もう一度合わせる
  useEffect(() => {
    const to = want.current
    if (!to) return
    want.current = null
    put(to)
    if (!to.win && !to.panel) return
    const ro = new ResizeObserver(() => put(to))
    ro.observe(document.body)
    const pn = panelOf()
    if (pn?.firstElementChild) ro.observe(pn.firstElementChild)
    const stop = () => {
      ro.disconnect()
      window.clearTimeout(t)
      for (const k of ['wheel', 'touchstart', 'keydown', 'pointerdown'] as const) window.removeEventListener(k, stop, true)
    }
    const t = window.setTimeout(stop, SETTLE_MS)
    for (const k of ['wheel', 'touchstart', 'keydown', 'pointerdown'] as const) window.addEventListener(k, stop, { capture: true, passive: true })
    return stop
  }, [view])

  return () => {
    back.current = true
  }
}
