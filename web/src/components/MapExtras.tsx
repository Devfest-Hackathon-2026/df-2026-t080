// 地図の部品（MapView・GoogleMapView）が地図の上と画面の端に出す物。下地によらない。
// - MapPeek: 全画面の地図で場所の札を押したときの、下の小さな札（名前・時刻・混雑・詳細）
// - MapFloat: 狭い画面で地図が画面の外へ送られたときの、右下の「地図」のボタン（押すと全画面の地図）
// - readingStop: スケジュールで今読んでいる場所（見出しのすぐ下にある場所の行）
// - useRowHover: スケジュールの場所の行（data-stop-id）にマウスを乗せた・フォーカスした場所
// - MapLegend: 左下の凡例（番号・出発地・徒歩・電車とバス・乗り降りする所・候補）。開け閉めは端末に覚える
import { useEffect, useState } from 'react'
import { createPortal } from 'react-dom'
import { CrowdMark } from './CrowdMark'
import { KIND_ICON } from '../lib/kindIcon'
import { ROLE_TEXT, type Stop } from '../lib/planner'
import { tr } from '../lib/i18n'
import { fmt } from '../lib/time'
import { askMapRedraw } from './mapShared'

const W = tr({
  ja: { more: '詳細', close: '閉じる', span: (a: string, b: string) => `${a}〜${b}`, sep: '・', map: '地図' },
  en: { more: 'Details', close: 'Close', span: (a: string, b: string) => `${a}–${b}`, sep: ' · ', map: 'Map' },
})

export function MapPeek({ stop, index, onMore, onClose }: { stop: Stop; index: number; onMore: () => void; onClose: () => void }) {
  return (
    <div className="map-peek">
      <button type="button" className="map-peek-main" onClick={onMore}>
        <span className="map-peek-head">
          <span className="map-peek-num num" aria-hidden="true">
            {index + 1}
          </span>
          <span className="map-peek-name">{stop.spot.name}</span>
        </span>
        <span className="map-peek-meta">
          <span>
            {ROLE_TEXT[stop.role]}
            {W.sep}
            <span className="num">{W.span(fmt(stop.arrive), fmt(stop.depart))}</span>
          </span>
          {stop.estimated && <CrowdMark level={stop.level} word />}
        </span>
        <span className="map-peek-more">
          {W.more}
          {/* 形の出典: Lucide（https://lucide.dev）の chevron-right。ISC ライセンス */}
          <svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true">
            <path d="m9 18 6-6-6-6" />
          </svg>
        </span>
      </button>
      <button type="button" className="map-peek-close" onClick={onClose} aria-label={W.close} title={W.close}>
        {/* 形の出典: Lucide（https://lucide.dev）の x。ISC ライセンス */}
        <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true">
          <path d="M18 6 6 18M6 6l12 12" />
        </svg>
      </button>
    </div>
  )
}

// 見出しの帯（header.top）のすぐ下にある、スケジュールの場所の行（data-stop-id）。スケジュールが画面に無ければ null
export function readingStop(): string | null {
  const top = document.querySelector('header.top')?.getBoundingClientRect().bottom ?? 0
  const rows = [...document.querySelectorAll<HTMLElement>('[data-stop-id]')]
  const row = rows.find((r) => {
    const b = r.getBoundingClientRect()
    return b.height > 0 && b.bottom > top + 24 && b.top < window.innerHeight - 24
  })
  return row?.dataset.stopId ?? null
}

// el（地図の枠）が画面から外れているか。広い画面では地図はいつも見えているので、見ない
function useOffScreen(el: HTMLElement | null, on: boolean): boolean {
  const [off, setOff] = useState(false)
  useEffect(() => {
    if (!el || !on) {
      setOff(false)
      return
    }
    const io = new IntersectionObserver(([e]) => setOff(e.intersectionRatio < 0.25), { threshold: [0, 0.25, 0.5] })
    io.observe(el)
    return () => io.disconnect()
  }, [el, on])
  return off
}

// 狭い画面で地図が画面の外へ送られたら、右下に「地図」のボタンを出す（押すと全画面の地図）。on: 出してよいか（プランがあって全画面でない）
export function MapFloat({ target, on, onOpen }: { target: HTMLElement | null; on: boolean; onOpen: () => void }) {
  const off = useOffScreen(target, on)
  if (!on || !off) return null
  return createPortal(
    <button type="button" className="map-float" onClick={onOpen}>
      {/* 形の出典: Lucide（https://lucide.dev）の map。ISC ライセンス */}
      <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true">
        <path d="M14.1 5.9 9.9 3.8a2 2 0 0 0-1.8 0L3.6 6A1 1 0 0 0 3 7v12.4a.6.6 0 0 0 .9.6l4.2-2.1a2 2 0 0 1 1.8 0l4.2 2.1a2 2 0 0 0 1.8 0l4.5-2.3a1 1 0 0 0 .6-.9V4.6a.6.6 0 0 0-.9-.6l-4.2 2.1a2 2 0 0 1-1.8 0zM15 6v15M9 3v15" />
      </svg>
      {W.map}
    </button>,
    document.body,
  )
}

const L = tr({
  ja: { title: '凡例', order: '回る順', start: '出発地', walk: '徒歩', ride: '電車・バス（路線の色）', stn: '乗る・降りる所', cand: 'ほかの候補' },
  en: { title: 'Legend', order: 'Stop order', start: 'Start', walk: 'Walk', ride: 'Train or bus (line color)', stn: 'Get on / off', cand: 'Other options' },
})
const LEGEND_KEY = 'intentrip:map-legend'
const readLegend = () => {
  try {
    const v = window.localStorage.getItem(LEGEND_KEY)
    if (v) return v === '1'
  } catch {
    // 端末に書けないときは、画面の幅で決める
  }
  return window.matchMedia('(min-width: 960px)').matches
}

// 左下の凡例。cands: 地図に候補の印を出しているか
export function MapLegend({ cands }: { cands: boolean }) {
  const [open, setOpen] = useState(readLegend)
  // 開け閉めしたら、地図に描き直してもらう（手で動かしていなければ、凡例に隠れないように映し直す）
  const toggle = () => {
    setOpen(!open)
    window.requestAnimationFrame(askMapRedraw)
    try {
      window.localStorage.setItem(LEGEND_KEY, open ? '0' : '1')
    } catch {
      // 覚えられなくても、開け閉めはできる
    }
  }
  return (
    <div className="map-legend">
      {open && (
        <ul className="map-legend-list" aria-label={L.title}>
          <li>
            <span className="lg-pin num" aria-hidden="true">
              1
            </span>
            {L.order}
          </li>
          <li>
            <span className="lg-start" aria-hidden="true" />
            {L.start}
          </li>
          <li>
            <svg className="lg-walk" viewBox="0 0 22 8" aria-hidden="true">
              <circle cx="3" cy="4" r="2.5" />
              <circle cx="11" cy="4" r="2.5" />
              <circle cx="19" cy="4" r="2.5" />
            </svg>
            {L.walk}
          </li>
          <li>
            <svg className="lg-ride" viewBox="0 0 22 8" aria-hidden="true">
              <path d="M2 4h18" />
            </svg>
            {L.ride}
          </li>
          <li>
            <span className="lg-stn" aria-hidden="true" />
            {L.stn}
          </li>
          {cands && (
            <li>
              <svg className="lg-cand" viewBox="0 0 24 24" aria-hidden="true">
                {KIND_ICON.temple.map((d) => (
                  <path key={d} d={d} />
                ))}
              </svg>
              {L.cand}
            </li>
          )}
        </ul>
      )}
      <button type="button" className="map-legend-toggle" aria-expanded={open} onClick={toggle}>
        {L.title}
        {/* 形の出典: Lucide（https://lucide.dev）の chevron-up・chevron-down。ISC ライセンス */}
        <svg viewBox="0 0 24 24" width="14" height="14" aria-hidden="true">
          <path d={open ? 'm6 9 6 6 6-6' : 'm18 15-6-6-6 6'} />
        </svg>
      </button>
    </div>
  )
}

// スケジュールの場所の行（data-stop-id）にマウスを乗せている・キーボードでフォーカスしている場所を知らせる（離れたら null）。
// 指で押したときは、そのまま場所の画面が開くので知らせない
export function useRowHover(on: (id: string | null) => void) {
  useEffect(() => {
    let now: string | null = null
    const set = (id: string | null) => {
      if (id === now) return
      now = id
      on(id)
    }
    const rowOf = (t: EventTarget | null) => (t instanceof Element ? (t.closest<HTMLElement>('[data-stop-id]')?.dataset.stopId ?? null) : null)
    const over = (e: PointerEvent) => {
      if (e.pointerType === 'mouse') set(rowOf(e.target))
    }
    const focus = (e: FocusEvent) => set(rowOf(e.target))
    const blur = (e: FocusEvent) => {
      if (!rowOf(e.relatedTarget)) set(null)
    }
    document.addEventListener('pointerover', over)
    document.addEventListener('focusin', focus)
    document.addEventListener('focusout', blur)
    return () => {
      document.removeEventListener('pointerover', over)
      document.removeEventListener('focusin', focus)
      document.removeEventListener('focusout', blur)
    }
    // on は呼んだ側で毎回作り直されるので、最初の 1 回だけ付ける
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])
}
