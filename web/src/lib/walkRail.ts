// スケジュールの徒歩の点を、ひと続きの点線（番号の札から次の札まで）ごとに同じ間で並べ、どの端でも点を丸ごと描く。
// 点は、区間の行と場所の札に分かれた線の部品（.rt-rail の ::before・::after）の背景で描く。部品ごとに並べると、
// 部品の端で点が半分に切れ、部品の境目で間が乱れる。画面に出たあと部品の位置を測り、ひと続きの長さを点の数で割った間と、
// 部品ごとのずらし（ひと続きの始まりからの位置）を CSS の変数で渡す
import { useLayoutEffect, type RefObject } from 'react'

// 点の中心から次の点の中心までの目安（px）。ひと続きの長さに合わせて少し伸び縮みさせる
const STEP = 10
// これ以下の間しかない部品どうしは、ひと続きの点線とみる（px）
const JOIN = 1.5

type Seg = { el: HTMLElement; pe: 'before' | 'after'; y0: number; y1: number }

function walkSegs(root: HTMLElement): Seg[] {
  const out: Seg[] = []
  for (const el of root.querySelectorAll<HTMLElement>('.rt-rail')) {
    const r = el.getBoundingClientRect()
    for (const pe of ['before', 'after'] as const) {
      const s = getComputedStyle(el, `::${pe}`)
      if (s.content === 'none' || s.display === 'none' || !s.backgroundImage.startsWith('radial-gradient')) continue
      const top = parseFloat(s.top)
      const bottom = parseFloat(s.bottom)
      if (!Number.isFinite(top) || !Number.isFinite(bottom)) continue
      out.push({ el, pe, y0: r.top + top, y1: r.bottom - bottom })
    }
  }
  return out.sort((a, b) => a.y0 - b.y0)
}

export function layoutWalkDots(root: HTMLElement) {
  const segs = walkSegs(root)
  for (let i = 0; i < segs.length; ) {
    let j = i
    while (j + 1 < segs.length && segs[j + 1].y0 - segs[j].y1 <= JOIN) j++
    const y0 = segs[i].y0
    const len = segs[j].y1 - y0
    const step = len / Math.max(1, Math.round(len / STEP))
    for (let k = i; k <= j; k++) {
      const s = segs[k]
      const off = (((s.y0 - y0) % step) + step) % step
      s.el.style.setProperty(`--dot-${s.pe}-step`, `${step}px`)
      s.el.style.setProperty(`--dot-${s.pe}-shift`, `${-off}px`)
    }
    i = j + 1
  }
}

// root の中の徒歩の点を並べ直す。大きさが変わったとき・字が読み込まれたとき・deps が変わったときに測り直す
export function useWalkDots(root: RefObject<HTMLElement | null>, deps: unknown[]) {
  useLayoutEffect(() => {
    const el = root.current
    if (!el) return
    let raf = 0
    const run = () => {
      cancelAnimationFrame(raf)
      raf = requestAnimationFrame(() => layoutWalkDots(el))
    }
    layoutWalkDots(el)
    const ro = new ResizeObserver(run)
    ro.observe(el)
    void document.fonts?.ready.then(run)
    return () => {
      ro.disconnect()
      cancelAnimationFrame(raf)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps)
}
