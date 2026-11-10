// 出発地・到着地の欄。書いた文字を地図のデータで引くのは、欄を離れたときと作るときだけ（打つたびには引かない）。
// 文字を書き換えたら、前に引いた場所は使わない
import { useCallback, useMemo, useRef, useState } from 'react'
import { findPlace, type GeoHit } from './api'
import { isEn } from './i18n'

export type FieldState = 'idle' | 'finding' | 'found' | 'miss' | 'error'
export type PlaceField = {
  text: string
  hit: GeoHit | null
  state: FieldState
  setText: (v: string) => void
  set: (text: string, hit: GeoHit | null) => void
  lookup: () => Promise<GeoHit | null>
}

export function usePlaceField(): PlaceField {
  const [text, setTextState] = useState('')
  const [hit, setHit] = useState<GeoHit | null>(null)
  const [state, setState] = useState<FieldState>('idle')
  const cur = useRef<{ text: string; hit: GeoHit | null }>({ text: '', hit: null })
  const asking = useRef<{ text: string; p: Promise<GeoHit | null> } | null>(null)
  const setText = useCallback((v: string) => {
    const same = v.trim() === cur.current.text.trim()
    cur.current = { text: v, hit: same ? cur.current.hit : null }
    setTextState(v)
    if (!same) {
      setHit(null)
      setState('idle')
    }
  }, [])
  const set = useCallback((t: string, h: GeoHit | null) => {
    cur.current = { text: t, hit: h }
    setTextState(t)
    setHit(h)
    setState(h ? 'found' : 'idle')
  }, [])
  const lookup = useCallback((): Promise<GeoHit | null> => {
    const t = cur.current.text.trim()
    if (!t) {
      setState('idle')
      return Promise.resolve(null)
    }
    if (cur.current.hit) return Promise.resolve(cur.current.hit)
    if (asking.current?.text === t) return asking.current.p
    setState('finding')
    const p = findPlace(t)
      .then(
        (h) => {
          if (cur.current.text.trim() !== t) return null
          cur.current = { text: cur.current.text, hit: h }
          setHit(h)
          setState(h ? 'found' : 'miss')
          return h
        },
        () => {
          if (cur.current.text.trim() === t) setState('error')
          return null
        },
      )
      .finally(() => {
        if (asking.current?.text === t) asking.current = null
      })
    asking.current = { text: t, p }
    return p
  }, [])
  return useMemo(() => ({ text, hit, state, setText, set, lookup }), [text, hit, state, setText, set, lookup])
}

// 欄の下に出す、引けた場所（例「市ヶ谷駅（東京都新宿区）」）
export function placeLabel(h: GeoHit): string {
  if (isEn) {
    const at = [h.city, h.pref].filter(Boolean).join(', ')
    return at ? `${h.name} (${at})` : h.name
  }
  const at = `${h.pref ?? ''}${h.city && h.city !== h.pref ? h.city : ''}`
  return at ? `${h.name}（${at}）` : h.name
}
