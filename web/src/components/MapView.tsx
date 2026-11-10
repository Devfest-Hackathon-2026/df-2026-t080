// マップ（MapLibre ＋ OpenFreeMap の地図・鍵なし）。Google マップのキーが無いときに使う。
// 経路の線は MapLibre の線（徒歩は濃い灰色の点線、公共交通機関は実線。線はサーバーが OSRM で作る道に沿った線）で、
// 番号・名前・出発地・所要時間・候補・現在地は MapLayer（Google マップ版と共通の札の層）が描く
import { useEffect, useRef, useState, type CSSProperties } from 'react'
import * as maplibregl from 'maplibre-gl'
import type { Map as MlMap } from 'maplibre-gl'
import 'maplibre-gl/dist/maplibre-gl.css'
import workerUrl from 'maplibre-gl/dist/maplibre-gl-worker.mjs?url'
import { tr } from '../lib/i18n'
import { MapLayer, fitPad, keepOutOf, litOf, sheetCover, type Projector } from '../lib/mapLayer'
import { lineEdge } from '../lib/lineColor'
import { LANE_STOPS, laneGap, lanesOf, shiftLine } from '../lib/routeLanes'
import { WALK_BACK, WALK_DOT, WALK_EDGE, WALK_STEP, along } from '../lib/walkDots'
import { MapTools } from './MapTools'
import { MapFloat, MapLegend, MapPeek, readingStop, useRowHover } from './MapExtras'
import { COOP_LOCALE, useMapGestures } from './mapGesture'
import { ROUTE_WAIT_MAX, RouteWait } from './RouteWait'
import { MAPW, NO_BUSES, NO_PICKS, REDRAW_EVENT, SEEN, followLines, legKey, legPoints, lineCache, toSeg, watchSheet, type LegIn, type LL, type MapProps, type Seg } from './mapShared'
import { goalOf } from '../lib/geo'
import { kindOf } from '../lib/kindIcon'
import type { Spot } from '../types'

maplibregl.setWorkerUrl(workerUrl)

// MapLibre が地図に付ける読み上げの名前（地図の canvas と、出典を開くボタン）
const ML_LOCALE = tr({
  ja: { 'Map.Title': 'マップ', 'AttributionControl.ToggleAttribution': '出典を表示' },
  en: { 'Map.Title': 'Map', 'AttributionControl.ToggleAttribution': 'Toggle attribution' },
})
const LOCALE = { ...ML_LOCALE, ...COOP_LOCALE }

const mq = () => window.matchMedia('(prefers-color-scheme: dark)')
const styleUrl = (dark: boolean) => `https://tiles.openfreemap.org/styles/${dark ? 'dark' : 'positron'}`

// 下地の文字（地名・道路の番号・駅や店の名前）は出さない。Google マップ版と同じく、地図の上の文字はプランの札と名前だけにする
function hideBaseLabels(m: MlMap) {
  for (const l of m.getStyle().layers ?? []) if (l.type === 'symbol') m.setLayoutProperty(l.id, 'visibility', 'none')
}

// この地図に出す場所の位置。Places で照合した場所は、照合の前の位置（guess）にする。
// Places の位置は Google の地図と一緒にしか出せない（lib/planImage の ownPlace と同じ考え。移動時間の計算は照合した位置のまま）
const ownLL = (s: Spot): LL => (Array.isArray(s.guess) && s.guess.length === 2 ? [s.guess[1], s.guess[0]] : [s.lng, s.lat])

const FIT_PAD = { top: 48, bottom: 44, left: 44, right: 64 }
const FOCUS_PAD = { top: 56, left: 56, right: 76, bottom: 76 }

export function MapView({ data, plan, focusId, candidates, candId = null, showId = null, legIdx = null, buses = NO_BUSES, picked = NO_PICKS, changed, onOpen, onCandidate, onLeg }: MapProps) {
  const box = useRef<HTMLDivElement>(null)
  const map = useRef<MlMap | null>(null)
  const layer = useRef<MapLayer | null>(null)
  const fitted = useRef('')
  const lastFit = useRef<maplibregl.LngLatBounds | null>(null)
  const handMoved = useRef(false)
  const me = useRef<{ watch: number | null; at: LL | null }>({ watch: null, at: null })
  const [locating, setLocating] = useState<'off' | 'wait' | 'on'>('off')
  // 現在地を取れなかったときの知らせ（右下のボタンのすぐ上に、少しのあいだ出す。同じ言葉でも出し直せるように時刻を持つ）
  const [note, setNote] = useState<{ text: string; at: number } | null>(null)
  const say = (text: string) => setNote({ text, at: Date.now() })
  useEffect(() => {
    if (!note) return
    const t = window.setTimeout(() => setNote(null), 5000)
    return () => window.clearTimeout(t)
  }, [note])
  // 道に沿った線をサーバーに聞いている間（地図の隅に「道を調べています」を出す）
  const [routing, setRouting] = useState(false)
  const { big, setBig, oneFinger } = useMapGestures()
  const oneFingerRef = useRef(oneFinger)
  oneFingerRef.current = oneFinger
  const bigRef = useRef(big)
  bigRef.current = big
  // 全画面の地図で押した場所（下に小さな札を出し、地図ではその場所を選んだときと同じく前後を濃く描く）
  const [peek, setPeek] = useState<string | null>(null)
  const [wrap, setWrap] = useState<HTMLDivElement | null>(null)
  const segs = useRef<Seg[]>([])
  // 徒歩の線（点を置き直すときに使う）
  const walks = useRef<{ coords: LL[]; props: Record<string, string | number> }[]>([])
  const dotsZoom = useRef(0)
  // 今のプランの区間（見つけた便が届いたら、ここから線を作り直す）
  const legsIn = useRef<LegIn[]>([])
  const busesRef = useRef(buses)
  busesRef.current = buses
  const ready = useRef(false)
  const onOpenRef = useRef(onOpen)
  onOpenRef.current = onOpen
  const onCandRef = useRef(onCandidate)
  onCandRef.current = onCandidate
  const onLegRef = useRef(onLeg)
  onLegRef.current = onLeg
  const dataRef = useRef(data)
  dataRef.current = data
  const planRef = useRef(plan)
  planRef.current = plan
  const candRef = useRef(candidates)
  candRef.current = candidates
  const pickedRef = useRef(picked)
  pickedRef.current = picked
  const wasFocused = useRef(false)
  // 選んでいる場所の番号（0 から）。その場所へ来る区間と出る区間だけを濃く描く
  const sel = useRef(-1)
  // 区間だけを見ている画面の区間の番号。その区間だけを濃く描く（sel より先に見る）
  const legSel = useRef(-1)
  // 区間の画面を開く前の映し方と、開いている間に手で動かしたか（閉じたら元の映し方に戻す）
  const legSave = useRef<{ center: maplibregl.LngLat; zoom: number; moved: boolean } | null>(null)

  // 札の層に今のプラン・線・候補を渡す
  const feed = () => {
    const L = layer.current
    if (!L) return
    const d = dataRef.current
    const p = planRef.current
    const has = !!p && p.stops.length > 0
    const lane = lanesOf(segs.current)
    L.setData({
      start: { name: d.start.name, ll: [d.start.lng, d.start.lat] },
      end: d.end ? { name: d.end.name, ll: [d.end.lng, d.end.lat] } : null,
      stops: has ? p.stops.map((s) => ({ id: s.spot.id, name: s.spot.name, ll: ownLL(s.spot) })) : [],
      legs: segs.current.map((s, k) => ({ coords: s.coords, mode: s.mode, minutes: s.minutes, idx: s.idx, pieces: s.pieces, lane: lane[k] })),
      // プランが無い候補の地図では、希望に合う候補だけ、拡大していなくても名前を出す
      cands: candRef.current.map((c) => ({ id: c.id, name: c.name, ll: ownLL(c), kind: kindOf(c), picked: pickedRef.current.includes(c.id), named: !has && c.source === 'wish' })),
    })
  }

  // 経路の線。Google マップ版と同じく、地図の地の色で縁取り、最後に出発地へ戻る区間は細く薄くする。
  // 歩く所は、浅葱の丸い点を地の色で縁取って並べる（lib/walkDots。点は placeDots で置く）。便か乗換を入れた区間は、乗る所を路線の色（濃い縁取り）にする。
  // 同じ道を通る区間の線は、区間ごとに少し横にずらして並べる（lib/routeLanes）
  const drawLines = () => {
    const m = map.current
    if (!m || !ready.current) return
    const css = getComputedStyle(document.documentElement)
    const cssVar = (name: string, fallback: string) => css.getPropertyValue(name).trim() || fallback
    const tint = cssVar('--route', '#0d8492')
    const land = getComputedStyle(m.getContainer()).getPropertyValue('--map-land').trim() || cssVar('--map-land', '#eef1f4')
    const dark = mq().matches
    const back = planRef.current?.stops.length ?? -1
    const lane = lanesOf(segs.current)
    const lit = litOf(sel.current, legSel.current)
    const line = (coords: LL[], props: Record<string, string | number>) => ({ type: 'Feature' as const, properties: props, geometry: { type: 'LineString' as const, coordinates: coords } })
    const fc = {
      type: 'FeatureCollection' as const,
      features: segs.current.flatMap((s, k) => {
        const dim = lit.legLit(s.idx) ? 0 : 1
        const isBack = s.idx === back ? 1 : 0
        const base = { dim, back: isBack, op: dim ? 0.2 : isBack && !lit.any ? 0.55 : 1, order: dim || isBack ? 0 : 1, lane: lane[k] }
        if (!s.pieces) return [line(s.coords, { ...base, mode: s.exact ? s.mode : 'pending' })]
        return s.pieces.map((p) => {
          if (p.kind === 'walk') return line(p.coords, { ...base, mode: 'walk' })
          const color = p.color ?? tint
          return line(p.coords, { ...base, mode: 'ride', color, edge: lineEdge(color, dark, land) })
        })
      }),
    }
    walks.current = fc.features.filter((f) => f.properties.mode === 'walk').map((f) => ({ coords: f.geometry.coordinates, props: f.properties }))
    const src = m.getSource('route') as maplibregl.GeoJSONSource | undefined
    if (src) {
      src.setData(fc)
      placeDots()
      return
    }
    m.addSource('route', { type: 'geojson', data: fc })
    const wide = (a: number, b: number): maplibregl.ExpressionSpecification => ['case', ['==', ['get', 'back'], 1], a, b]
    const op: maplibregl.ExpressionSpecification = ['get', 'op']
    const [[z0, w0], [z1, w1]] = LANE_STOPS
    const off: maplibregl.ExpressionSpecification = ['interpolate', ['linear'], ['zoom'], z0, ['*', ['get', 'lane'], w0], z1, ['*', ['get', 'lane'], w1]]
    m.addLayer({
      id: 'route-transit-casing',
      type: 'line',
      source: 'route',
      filter: ['==', ['get', 'mode'], 'transit'],
      layout: { 'line-cap': 'round', 'line-join': 'round', 'line-sort-key': ['get', 'order'] },
      paint: { 'line-color': land, 'line-width': wide(6, 7), 'line-opacity': op, 'line-offset': off },
    })
    m.addLayer({
      id: 'route-transit',
      type: 'line',
      source: 'route',
      filter: ['==', ['get', 'mode'], 'transit'],
      layout: { 'line-cap': 'round', 'line-join': 'round', 'line-sort-key': ['get', 'order'] },
      paint: { 'line-color': tint, 'line-width': wide(3, 4), 'line-opacity': op, 'line-offset': off },
    })
    m.addLayer({
      id: 'route-ride-casing',
      type: 'line',
      source: 'route',
      filter: ['==', ['get', 'mode'], 'ride'],
      layout: { 'line-cap': 'round', 'line-join': 'round', 'line-sort-key': ['get', 'order'] },
      paint: { 'line-color': ['get', 'edge'], 'line-width': wide(6, 7), 'line-opacity': op, 'line-offset': off },
    })
    m.addLayer({
      id: 'route-ride',
      type: 'line',
      source: 'route',
      filter: ['==', ['get', 'mode'], 'ride'],
      layout: { 'line-cap': 'round', 'line-join': 'round', 'line-sort-key': ['get', 'order'] },
      paint: { 'line-color': ['get', 'color'], 'line-width': wide(3, 4), 'line-opacity': op, 'line-offset': off },
    })
    m.addLayer({
      id: 'route-pending',
      type: 'line',
      source: 'route',
      filter: ['==', ['get', 'mode'], 'pending'],
      layout: { 'line-cap': 'round' },
      paint: { 'line-color': tint, 'line-width': 2, 'line-opacity': ['*', 0.45, op], 'line-dasharray': [1, 2], 'line-offset': off },
    })
    m.addSource('walk-dots', { type: 'geojson', data: { type: 'FeatureCollection', features: [] } })
    m.addLayer({
      id: 'route-walk',
      type: 'circle',
      source: 'walk-dots',
      layout: { 'circle-sort-key': ['get', 'order'] },
      paint: {
        'circle-radius': wide((WALK_DOT / 2) * WALK_BACK, WALK_DOT / 2),
        'circle-color': tint,
        'circle-opacity': op,
        'circle-stroke-width': wide(WALK_EDGE * WALK_BACK, WALK_EDGE),
        'circle-stroke-color': land,
        'circle-stroke-opacity': op,
      },
    })
    placeDots()
  }

  // 徒歩の点を、今の拡大で画面の WALK_STEP px ごとに置く（線の破線の模様は拡大の途中で伸び縮みするので、点を 1 つずつ置く）。
  // 拡大が変わったら置き直す（指で広げている途中も 0.3 段ごと）。同じ道の線は、ほかの線と同じだけ横にずらす（shiftLine の拡大は Google マップの段なので 1 足す）
  const placeDots = () => {
    const m = map.current
    const src = m?.getSource('walk-dots') as maplibregl.GeoJSONSource | undefined
    if (!m || !src) return
    const zoom = m.getZoom()
    dotsZoom.current = zoom
    const features = walks.current.flatMap(({ coords, props }) => {
      const lane = Number(props.lane) || 0
      const line = (lane ? shiftLine(coords, lane * laneGap(zoom), zoom + 1) : coords).map((c) => m.project(c))
      return along(line, WALK_STEP * (props.back ? WALK_BACK : 1)).map((p) => {
        const ll = m.unproject([p.x, p.y])
        return { type: 'Feature' as const, properties: props, geometry: { type: 'Point' as const, coordinates: [ll.lng, ll.lat] } }
      })
    })
    src.setData({ type: 'FeatureCollection', features })
  }

  // 線と名前の縁取りの色を、この下地の地の色に合わせる（地図の要素で --map-land を上書きする）
  const matchLand = (m: MlMap) => {
    const bg = (m.getStyle().layers ?? []).find((l) => l.type === 'background')
    const c = bg && m.getPaintProperty(bg.id, 'background-color')
    if (typeof c === 'string') m.getContainer().style.setProperty('--map-land', c)
    else m.getContainer().style.removeProperty('--map-land')
  }

  useEffect(() => {
    if (!box.current) return
    const m = new maplibregl.Map({
      container: box.current,
      style: styleUrl(mq().matches),
      center: [data.start.lng, data.start.lat],
      zoom: 12,
      attributionControl: { compact: true },
      locale: LOCALE,
      cooperativeGestures: !oneFingerRef.current,
      dragRotate: false,
      pitchWithRotate: false,
    })
    m.touchZoomRotate.disableRotation()
    m.getCanvas().removeAttribute('role')
    const projector: Projector = () => {
      const c = m.getContainer()
      return {
        project: (ll) => {
          const p = m.project(ll)
          return { x: p.x, y: p.y }
        },
        view: { x: 0, y: 0, w: c.clientWidth, h: c.clientHeight, zoom: m.getZoom(), keepOut: keepOutOf(box.current) },
      }
    }
    const L = new MapLayer(
      projector,
      (id) => (bigRef.current ? setPeek(id) : onOpenRef.current(id)),
      (id) => onCandRef.current(id),
      undefined,
      (idx) => onLegRef.current?.(idx),
    )
    layer.current = L
    m.getCanvasContainer().appendChild(L.root)
    m.on('move', () => L.draw())
    m.on('zoom', () => {
      if (Math.abs(m.getZoom() - dotsZoom.current) >= 0.3) placeDots()
    })
    m.on('zoomend', () => placeDots())
    m.on('resize', () => L.draw())
    m.on('click', (e) => {
      const t = e.originalEvent?.target
      if (bigRef.current && !(t instanceof Element && t.closest('.mlayer'))) setPeek(null)
    })
    m.on('movestart', (e) => {
      if (!(e as { originalEvent?: Event }).originalEvent) return
      handMoved.current = true
      if (legSave.current) legSave.current.moved = true
    })
    m.on('style.load', () => {
      ready.current = true
      hideBaseLabels(m)
      matchLand(m)
      drawLines()
      L.draw()
    })
    const q = mq()
    const onTheme = () => {
      ready.current = false
      m.setStyle(styleUrl(q.matches))
    }
    q.addEventListener('change', onTheme)
    // ほかの画面から戻ったときと画面の大きさが変わったときに、地図の大きさを測り直して描き直す
    let again: number | null = null
    const redraw = () => {
      if (document.visibilityState !== 'visible') return
      if (again !== null) window.cancelAnimationFrame(again)
      again = window.requestAnimationFrame(() => {
        again = null
        m.resize()
        if (!handMoved.current && sel.current < 0 && legSel.current < 0 && lastFit.current) m.fitBounds(lastFit.current, { padding: fitPad(box.current, FIT_PAD), maxZoom: 15, duration: 0 })
        m.triggerRepaint()
        L.draw()
      })
    }
    const late = () => window.setTimeout(redraw, 350) // 画面の高さが落ち着いてからもう一度
    const back = () => {
      redraw()
      late()
    }
    document.addEventListener('visibilitychange', back)
    window.addEventListener('focus', back)
    window.addEventListener('pageshow', back)
    window.visualViewport?.addEventListener('resize', redraw)
    window.addEventListener(REDRAW_EVENT, back)
    const watchBox = new ResizeObserver(redraw)
    watchBox.observe(box.current)
    map.current = m
    const mine = me.current
    return () => {
      q.removeEventListener('change', onTheme)
      document.removeEventListener('visibilitychange', back)
      window.removeEventListener('focus', back)
      window.removeEventListener('pageshow', back)
      window.visualViewport?.removeEventListener('resize', redraw)
      window.removeEventListener(REDRAW_EVENT, back)
      watchBox.disconnect()
      if (again !== null) window.cancelAnimationFrame(again)
      if (mine.watch !== null) navigator.geolocation.clearWatch(mine.watch)
      L.destroy()
      m.remove()
      map.current = null
      layer.current = null
    }
    // 最初の 1 回だけ作る
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  useEffect(() => {
    const m = map.current
    if (!m) return
    const start: LL = [data.start.lng, data.start.lat]
    const goal: LL = data.end ? [data.end.lng, data.end.lat] : start
    if (!plan || !plan.stops.length) {
      segs.current = []
      legsIn.current = []
      setRouting(false)
      drawLines()
      feed()
      // プランが無いときは、出発地と候補が全部入るように映す（候補も無ければ出発地を真ん中に）
      const cands = candRef.current
      if (!cands.length) {
        lastFit.current = null
        m.jumpTo({ center: start, zoom: 12 })
        return
      }
      // 候補が届いて増えたときは、手で動かしておらず映っていない点が出たときだけ映し直す
      const b = new maplibregl.LngLatBounds(start, start)
      b.extend(goal)
      cands.forEach((c) => b.extend(ownLL(c)))
      const first = !lastFit.current
      lastFit.current = b
      const view = m.getBounds()
      const hidden = cands.some((c) => !view.contains(ownLL(c)))
      if (first || (hidden && !handMoved.current)) m.fitBounds(b, { padding: fitPad(box.current, FIT_PAD), maxZoom: 15, duration: first ? 0 : 300 })
      return
    }
    const pts: LL[] = [start, ...plan.stops.map((s) => ownLL(s.spot)), goal]
    const legs = [...plan.stops.map((s) => s.leg), plan.back].map((leg, i) => ({ a: pts[i], b: pts[i + 1], mode: leg.mode, minutes: leg.minutes, real: leg.real, rail: leg.rail }))
    // まず薄い直線で描き、道に沿った線が届いたら置き換える（届かなかった区間は少しあとでもう一度）
    legsIn.current = legs
    const paint = () => {
      segs.current = legs.map((l, i) => toSeg(l, i, busesRef.current[i]))
      drawLines()
      feed()
    }
    paint()
    // 線を聞く区間があるときだけ、届くまで（取れなかった区間はもう一度聞き終わるまで）表示を出す
    const waiting = legs.some((l) => !lineCache.has(legKey(l.a, l.b, l.mode)))
    setRouting(waiting)
    const cap = waiting ? window.setTimeout(() => setRouting(false), ROUTE_WAIT_MAX) : null
    const stop = followLines(legs, () => segs.current, paint, () => setRouting(false))
    // 地図を手で動かしていなければ、いつもプラン全体を映す。動かしたあとは、映っていない場所があるときだけ映し直す
    const b = new maplibregl.LngLatBounds()
    pts.forEach((p) => b.extend(p))
    lastFit.current = b
    if (fitted.current !== data.area.name) handMoved.current = false
    const view = m.getBounds()
    const hidden = pts.some((p) => !view.contains(p))
    if (fitted.current !== data.area.name || hidden || !handMoved.current) {
      m.fitBounds(b, { padding: fitPad(box.current, FIT_PAD), maxZoom: 15, duration: fitted.current === data.area.name ? 300 : 0 })
      fitted.current = data.area.name
    }
    return () => {
      stop()
      if (cap !== null) window.clearTimeout(cap)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data, plan])

  // 見つけた便が届いた・変わったら、その区間の線と札を描き直す（駅や停留所まで歩く所の道の線が届いたら、もう一度）
  useEffect(() => {
    if (!legsIn.current.length) return
    const redraw = () => {
      segs.current = legsIn.current.map((l, i) => toSeg(l, i, buses[i]))
      drawLines()
      feed()
    }
    redraw()
    return followLines([], () => segs.current, redraw)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [buses])

  // プランに入っていない候補（押すと候補の画面を開く）
  useEffect(() => {
    feed()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [candidates, picked])

  // 開いた候補が地図に映っていない（下から出る画面に隠れるときも）ときは、映っている所の真ん中へ動かす
  useEffect(() => {
    layer.current?.setState({ candId })
    const m = map.current
    const c = candId ? candRef.current.find((x) => x.id === candId) : undefined
    if (!m || !c) return
    const raf = window.requestAnimationFrame(() => {
      const el = box.current
      if (!el) return
      const p = m.project(ownLL(c))
      const w = el.clientWidth
      const h = el.clientHeight - sheetCover(el)
      if (p.x >= SEEN && p.x <= w - SEEN && p.y >= SEEN && p.y <= h - SEEN) return
      m.panBy([p.x - w / 2, p.y - h / 2], { duration: 400 })
    })
    return () => window.cancelAnimationFrame(raf)
  }, [candId])

  // 選んだ場所は、前・その場所・次の 3 か所が入るように映す（showId の候補があるときは、その場所と候補の 2 か所）
  const fitFocus = (i: number) => {
    const m = map.current
    if (!m || !plan) return
    const start: LL = [data.start.lng, data.start.lat]
    const goal: LL = data.end ? [data.end.lng, data.end.lat] : start
    const at = (k: number): LL => (k < 0 ? start : k >= plan.stops.length ? goal : ownLL(plan.stops[k].spot))
    const show = showId ? candidates.find((c) => c.id === showId) : undefined
    const b = new maplibregl.LngLatBounds()
    ;(show ? [at(i), ownLL(show)] : [at(i - 1), at(i), at(i + 1)]).forEach((p) => b.extend(p))
    // 下から出る画面が開き切ってから、その画面に隠れない所に収める（全画面にした直後でも、地図の大きさを測り直してから）
    window.requestAnimationFrame(() => {
      m.resize()
      const cover = sheetCover(box.current)
      m.fitBounds(b, { padding: fitPad(box.current, cover > 0 ? { ...FOCUS_PAD, bottom: cover + 44 } : FOCUS_PAD), maxZoom: 15, duration: 400 })
    })
  }

  // スケジュールの場所の行にマウスを乗せた・フォーカスした場所は、地図の札を強める。札が地図の端か外にあれば、少しあとで地図をそこへ寄せる
  // （場所や区間の画面を開いている間と、全画面の地図のときは寄せない）
  const hoverPan = useRef<number | null>(null)
  useRowHover((id) => {
    layer.current?.setState({ hover: id })
    if (hoverPan.current !== null) window.clearTimeout(hoverPan.current)
    hoverPan.current = null
    const s = id ? planRef.current?.stops.find((x) => x.spot.id === id) : undefined
    if (!s || bigRef.current) return
    hoverPan.current = window.setTimeout(() => {
      hoverPan.current = null
      if (sel.current >= 0 || legSel.current >= 0) return
      const el = box.current
      const m = map.current
      if (!el || !m) return
      const q = m.project(ownLL(s.spot))
      if (q.x >= 48 && q.x <= el.clientWidth - 72 && q.y >= 48 && q.y <= el.clientHeight - 72) return
      m.easeTo({ center: ownLL(s.spot), duration: 400 })
    }, 250)
  })
  useEffect(
    () => () => {
      if (hoverPan.current !== null) window.clearTimeout(hoverPan.current)
    },
    [],
  )

  // 下から出る画面（場所・区間・候補の画面）に隠れる高さ。右下のボタンと凡例を、その分だけ上げる（地図が 200px も見えないときは隠す）
  const [cover, setCover] = useState(0)
  useEffect(() => {
    const upd = () => setCover(sheetCover(box.current, false))
    const raf = window.requestAnimationFrame(upd)
    const late = window.setTimeout(upd, 400)
    const stop = watchSheet(upd)
    return () => {
      window.cancelAnimationFrame(raf)
      window.clearTimeout(late)
      stop()
    }
  }, [focusId, legIdx, candId])
  const dockStyle = cover > 0 ? ({ '--sheet-cover': `${cover}px` } as CSSProperties) : undefined
  const dockHidden = cover > 0 && (box.current?.clientHeight ?? 0) - cover < 200

  // 全画面をやめたとき・場所の画面を開いたときは、下の札を閉じる
  useEffect(() => {
    if (!big || focusId) setPeek(null)
  }, [big, focusId])
  const shownId = focusId ?? peek

  // 選ぶのをやめたら、手で動かしていなければ全体に戻す。区間の画面が開いている間は、区間の映し方のままにする
  useEffect(() => {
    const i = plan?.stops.findIndex((x) => x.spot.id === shownId) ?? -1
    sel.current = i
    drawLines()
    layer.current?.setState({ focus: i })
    const m = map.current
    if (!m || !plan) return
    if (i >= 0) {
      wasFocused.current = true
      if (legSel.current < 0) fitFocus(i)
    } else if (wasFocused.current) {
      wasFocused.current = false
      if (legSel.current < 0 && !handMoved.current && lastFit.current) m.fitBounds(lastFit.current, { padding: fitPad(box.current, FIT_PAD), maxZoom: 15, duration: 400 })
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [shownId, plan, showId])

  // 区間だけを見ている画面では、その区間の両端と線が入るように映す（下から出る画面の高さが変わったら映し直す）。
  // 開いている間に手で動かしたら、もう動かさない。閉じたら、開く前の映し方に戻す（手で動かしていなければプラン全体か選んだ場所）
  useEffect(() => {
    const k = plan && legIdx !== null && legIdx >= 0 && legIdx <= plan.stops.length ? legIdx : -1
    const was = legSel.current
    legSel.current = k
    drawLines()
    layer.current?.setState({ leg: k })
    const m = map.current
    if (!m || !plan) return
    if (k >= 0) {
      if (was < 0 || !legSave.current) legSave.current = { center: m.getCenter(), zoom: m.getZoom(), moved: false }
      const fitLeg = () => {
        if (legSave.current?.moved) return
        const b = new maplibregl.LngLatBounds()
        const goal = goalOf(data)
        legPoints(plan, [data.start.lng, data.start.lat], [goal.lng, goal.lat], segs.current, k, ownLL).forEach((p) => b.extend(p))
        const cover = sheetCover(box.current)
        m.fitBounds(b, { padding: fitPad(box.current, cover > 0 ? { ...FOCUS_PAD, bottom: cover + 44 } : FOCUS_PAD), maxZoom: 16, duration: 400 })
      }
      const raf = window.requestAnimationFrame(fitLeg)
      const stop = watchSheet(fitLeg)
      return () => {
        window.cancelAnimationFrame(raf)
        stop()
      }
    }
    if (was < 0) return
    const saved = legSave.current
    legSave.current = null
    if (!saved || saved.moved) return
    if (handMoved.current) m.easeTo({ center: saved.center, zoom: saved.zoom, duration: 400 })
    else if (sel.current >= 0) fitFocus(sel.current)
    else if (lastFit.current) m.fitBounds(lastFit.current, { padding: fitPad(box.current, FIT_PAD), maxZoom: 15, duration: 400 })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [legIdx, plan])

  useEffect(() => {
    layer.current?.setState({ changed: changed ?? new Set() })
  }, [changed, plan])

  const fitAll = () => {
    const m = map.current
    if (!m || !lastFit.current) return
    handMoved.current = false
    if (legSave.current) legSave.current.moved = true
    m.fitBounds(lastFit.current, { padding: fitPad(box.current, FIT_PAD), maxZoom: 15, duration: 400 })
  }

  // 右下の拡大・縮小（手で動かしたのと同じに扱い、あとで勝手に映し直さない）
  const zoomBy = (d: 1 | -1) => {
    const m = map.current
    if (!m) return
    handMoved.current = true
    if (legSave.current) legSave.current.moved = true
    m.easeTo({ zoom: Math.round(m.getZoom()) + d, duration: 250 })
  }

  // 現在地：押すと位置を取り、青い点を出してそこへ移る。出ている間は動きに合わせて点を動かす
  const locate = () => {
    const m = map.current
    if (!m) return
    const mine = me.current
    handMoved.current = true
    if (legSave.current) legSave.current.moved = true
    if (mine.at) {
      m.easeTo({ center: mine.at, zoom: Math.max(m.getZoom(), 15), duration: 500 })
      return
    }
    if (mine.watch !== null) return // 位置が届くのを待っている間は、もう一度頼まない
    if (!('geolocation' in navigator) || !window.isSecureContext) {
      say(MAPW.noGeo)
      return
    }
    setLocating('wait')
    let first = true
    mine.watch = navigator.geolocation.watchPosition(
      (pos) => {
        const ll: LL = [pos.coords.longitude, pos.coords.latitude]
        mine.at = ll
        layer.current?.setState({ me: ll })
        setLocating('on')
        if (first) {
          first = false
          m.easeTo({ center: ll, zoom: Math.max(m.getZoom(), 15), duration: 600 })
        }
      },
      (err) => {
        if (mine.watch !== null) navigator.geolocation.clearWatch(mine.watch)
        mine.watch = null
        setLocating('off')
        say(err.code === err.PERMISSION_DENIED ? MAPW.denied : MAPW.failed)
      },
      { enableHighAccuracy: true, maximumAge: 10000, timeout: 15000 },
    )
  }

  useEffect(() => {
    const g = map.current?.cooperativeGestures
    if (!g) return
    if (oneFinger) g.disable()
    else g.enable()
  }, [oneFinger])

  const peekAt = peek && plan ? plan.stops.findIndex((x) => x.spot.id === peek) : -1
  const hasPlan = !!plan && plan.stops.length > 0
  return (
    <div ref={setWrap} className={big ? 'map-wrap big' : 'map-wrap'}>
      <div ref={box} className="map" role="region" aria-label={MAPW.map} />
      <RouteWait on={routing} />
      <div className="map-dock" style={dockStyle} data-hidden={dockHidden ? '' : undefined}>
        <div className="map-dock-row">
          {hasPlan ? <MapLegend cands={candidates.length > 0} /> : <span />}
          <MapTools
            locating={locating}
            fitLabel={plan && plan.stops.length > 0 ? MAPW.fitPlan : MAPW.fitAll}
            onFit={(plan && plan.stops.length > 0) || candidates.length > 0 ? fitAll : null}
            onLocate={locate}
            big={big}
            onBig={setBig}
            onZoom={zoomBy}
            note={note?.text ?? null}
          />
        </div>
        {big && plan && peekAt >= 0 && (
          <MapPeek
            stop={plan.stops[peekAt]}
            index={peekAt}
            onMore={() => onOpenRef.current(plan.stops[peekAt].spot.id)}
            onClose={() => setPeek(null)}
          />
        )}
      </div>
      <MapFloat
        target={wrap}
        on={hasPlan && !big}
        onOpen={() => {
          setPeek(readingStop())
          setBig(true)
        }}
      />
    </div>
  )
}
