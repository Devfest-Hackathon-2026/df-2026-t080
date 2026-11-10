// マップ（Google マップ・Maps JavaScript API）。MapView（MapLibre）と同じ受け取り方で、同じものを描く。
// 下地は mapStyle の見た目（店や名所の印を出さない灰色の地図）。経路の線は Google マップの線で、
// 番号・名前・出発地・所要時間・候補・現在地は MapLayer（MapLibre 版と共通の札の層）が描く
import { useEffect, useRef, useState, type CSSProperties } from 'react'
import type { AreaBox } from '../lib/areaSearch'
import { giveUpGoogleMaps, loadGoogleMaps, markMapsShown } from '../lib/gmaps'
import { MapLayer, fitPad, keepOutOf, litOf, sheetCover, type Projector } from '../lib/mapLayer'
import { mapLand, mapStyle } from '../lib/mapStyle'
import { lineEdge } from '../lib/lineColor'
import { laneGap, lanesOf, shiftLine } from '../lib/routeLanes'
import { WALK_BACK, WALK_DOT, WALK_EDGE, WALK_STEP } from '../lib/walkDots'
import { MapTools } from './MapTools'
import { MapFloat, MapLegend, MapPeek, readingStop, useRowHover } from './MapExtras'
import { useMapGestures } from './mapGesture'
import { ROUTE_WAIT_MAX, RouteWait } from './RouteWait'
import { MAPW, NO_BUSES, NO_FOUND, NO_PICKS, REDRAW_EVENT, SEEN, followLines, legKey, legPoints, lineCache, toSeg, watchSheet, type LL, type LegIn, type MapProps, type Seg } from './mapShared'
import { goalOf } from '../lib/geo'
import { kindOf } from '../lib/kindIcon'

const pos = ([lng, lat]: LL): google.maps.LatLngLiteral => ({ lat, lng })
const cssVar = (name: string, fallback: string) => getComputedStyle(document.documentElement).getPropertyValue(name).trim() || fallback
// ラスターの地図は、線を拡大の整数の段（四捨五入）で描き、端数の分だけ伸び縮みさせて見せる。
// 徒歩の点はその逆の割合で描いて、どの拡大でも画面で lib/walkDots の大きさと間に見せる
const dotFit = (zoom: number) => 2 ** (Math.round(zoom) - zoom)
const isDark = () => window.matchMedia('(prefers-color-scheme: dark)').matches
const FIT_PAD = { top: 48, bottom: 44, left: 44, right: 64 }
const FOCUS_PAD = { top: 56, left: 56, right: 76, bottom: 76 }

export function GoogleMapView({ data, plan, focusId, candidates, candId = null, showId = null, legIdx = null, buses = NO_BUSES, picked = NO_PICKS, changed, onOpen, onCandidate, onLeg, onAreaSearch, areaBox, searching = false, found = NO_FOUND, foundId = null, onFound }: MapProps) {
  const box = useRef<HTMLDivElement>(null)
  const map = useRef<google.maps.Map | null>(null)
  const overlay = useRef<google.maps.OverlayView | null>(null)
  const [ready, setReady] = useState(false)
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
  const foundRef = useRef(found)
  foundRef.current = found
  const onFoundRef = useRef(onFound)
  onFoundRef.current = onFound
  const lines = useRef<google.maps.Polyline[]>([])
  const layer = useRef<MapLayer | null>(null)
  const segs = useRef<Seg[]>([])
  // 今のプランの区間（見つけた便が届いたら、ここから線を作り直す）
  const legsIn = useRef<LegIn[]>([])
  const busesRef = useRef(buses)
  busesRef.current = buses
  // 選んでいる場所の番号（0 から）。その場所へ来る区間と出る区間だけを濃く描く
  const sel = useRef(-1)
  // 区間だけを見ている画面の区間の番号。その区間だけを濃く描く（sel より先に見る）
  const legSel = useRef(-1)
  // 区間の画面を開く前の映し方と、開いている間に手で動かしたか（閉じたら元の映し方に戻す）
  const legSave = useRef<{ center: google.maps.LatLng; zoom: number; moved: boolean } | null>(null)
  // 線を描いたときの拡大（線をずらす幅を決める）と、横にずらした線（拡大が変わったら、ずらす幅だけを直す）
  const drawnZoom = useRef(-1)
  const shifted = useRef<{ line: google.maps.Polyline; coords: LL[]; lane: number }[]>([])
  // 徒歩の点の線と、その拡大での点の形（拡大が変わったら点の大きさを付け直す）
  const dotted = useRef<{ line: google.maps.Polyline; icons: (zoom: number) => google.maps.IconSequence[] }[]>([])
  const lastFit = useRef<google.maps.LatLngBounds | null>(null)
  const handMoved = useRef(false)
  const fitted = useRef('')
  const wasFocused = useRef(false)
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
      stops: has ? p.stops.map((s) => ({ id: s.spot.id, name: s.spot.name, ll: [s.spot.lng, s.spot.lat] as LL })) : [],
      legs: segs.current.map((s, k) => ({ coords: s.coords, mode: s.mode, minutes: s.minutes, idx: s.idx, pieces: s.pieces, lane: lane[k] })),
      // プランが無い候補の地図では、希望に合う候補だけ、拡大していなくても名前を出す
      cands: candRef.current.map((c) => ({ id: c.id, name: c.name, ll: [c.lng, c.lat] as LL, kind: kindOf(c), picked: pickedRef.current.includes(c.id), named: !has && c.source === 'wish' })),
      found: foundRef.current.map((f) => ({ id: f.id, name: f.name, ll: [f.lng, f.lat] as LL })),
    })
  }

  useEffect(() => {
    let alive = true
    loadGoogleMaps()
      .then(() => {
        if (!alive || !box.current) return
        const dark = isDark()
        const m = new google.maps.Map(box.current, {
          center: { lat: data.start.lat, lng: data.start.lng },
          zoom: 12,
          styles: mapStyle(dark),
          backgroundColor: mapLand(dark),
          renderingType: google.maps.RenderingType.RASTER,
          isFractionalZoomEnabled: true,
          disableDefaultUI: true,
          clickableIcons: false,
          keyboardShortcuts: false,
          gestureHandling: oneFingerRef.current ? 'greedy' : 'cooperative',
        })
        google.maps.event.addListenerOnce(m, 'tilesloaded', markMapsShown)
        m.addListener('click', (e: google.maps.MapMouseEvent) => {
          const t = e.domEvent?.target
          if (bigRef.current && !(t instanceof Element && t.closest('.mlayer'))) setPeek(null)
        })
        m.addListener('dragstart', () => {
          handMoved.current = true
          if (legSave.current) legSave.current.moved = true
        })
        // 地図の上の位置を札の層の点に直すための重ね。札の層はここに入れる（押せる札は overlayMouseTarget に置く）
        const ov = new google.maps.OverlayView()
        const projector: Projector = () => {
          const pr = ov.getProjection()
          const b = box.current
          if (!pr || !b) return null
          const tl = pr.fromContainerPixelToLatLng(new google.maps.Point(0, 0))
          const o = tl && pr.fromLatLngToDivPixel(tl)
          if (!o) return null
          return {
            project: ([lng, lat]) => {
              const q = pr.fromLatLngToDivPixel(new google.maps.LatLng(lat, lng))
              return q ? { x: q.x, y: q.y } : null
            },
            view: { x: o.x, y: o.y, w: b.clientWidth, h: b.clientHeight, zoom: m.getZoom() ?? 0, keepOut: keepOutOf(b) },
          }
        }
        const L = new MapLayer(
          projector,
          (id) => (bigRef.current ? setPeek(id) : onOpenRef.current(id)),
          (id) => onCandRef.current(id),
          (id) => onFoundRef.current?.(id),
          (idx) => onLegRef.current?.(idx),
        )
        layer.current = L
        ov.onAdd = () => {
          ov.getPanes()?.overlayMouseTarget.appendChild(L.root)
        }
        ov.onRemove = () => L.destroy()
        ov.draw = () => L.draw()
        ov.setMap(m)
        overlay.current = ov
        m.addListener('zoom_changed', reshift)
        m.addListener('idle', () => L.draw())
        map.current = m
        setReady(true)
      })
      .catch(giveUpGoogleMaps)
    return () => {
      alive = false
    }
    // 地図は 1 度だけ作る（出発地は最初の中心に使うだけ）
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // fitBounds は 1 か所だけのときに寄りすぎるので、16 までにする
  const fit = (b: google.maps.LatLngBounds, padding: typeof FIT_PAD) => {
    const m = map.current
    if (!m) return
    m.fitBounds(b, fitPad(box.current, padding))
    google.maps.event.addListenerOnce(m, 'idle', () => {
      if ((m.getZoom() ?? 0) > 16) m.setZoom(16)
    })
  }

  // 経路の線。交通機関は実線、徒歩は浅葱の丸い点の列（lib/walkDots）、道に沿った線が届くまでは薄い破線。
  // どの線も地図の地の色で縁取り、重なったところでも 1 本ずつ見分けられるようにする。最後に出発地へ戻る区間は細く薄く。
  // 便か乗換を入れた区間は、乗る所を路線の色（濃い縁取り）、歩く所を浅葱の丸い点の列にする。
  // 同じ道を通る区間の線は、区間ごとに少し横にずらして並べる（lib/routeLanes。ずらす幅は拡大に合わせるので、拡大が変わったら reshift で直す）
  const drawLines = () => {
    const m = map.current
    if (!m) return
    const zoom = m.getZoom() ?? 12
    drawnZoom.current = zoom
    const lane = lanesOf(segs.current)
    lines.current.forEach((l) => l.setMap(null))
    lines.current = []
    shifted.current = []
    dotted.current = []
    const tint = cssVar('--route', '#0d8492')
    const dark = isDark()
    const land = mapLand(dark)
    const back = planRef.current?.stops.length ?? -1
    const lit = litOf(sel.current, legSel.current)
    segs.current.forEach((s, k) => {
      const ln = lane[k]
      const at = (coords: LL[]) => shiftLine(coords, ln * laneGap(zoom), zoom).map(pos)
      const add = (coords: LL[], path: google.maps.LatLngLiteral[], o: google.maps.PolylineOptions) => {
        const line = new google.maps.Polyline({ map: m, clickable: false, path, ...o })
        lines.current.push(line)
        if (ln) shifted.current.push({ line, coords, lane: ln })
        return line
      }
      const dim = !lit.legLit(s.idx)
      const isBack = s.idx === back
      const op = dim ? 0.2 : isBack && !lit.any ? 0.55 : 1
      const z = dim || isBack ? 1 : 3
      const solid = (coords: LL[], color: string, edge: string) => {
        const path = at(coords)
        add(coords, path, { strokeColor: edge, strokeOpacity: op, strokeWeight: isBack ? 6 : 7, zIndex: z })
        add(coords, path, { strokeColor: color, strokeOpacity: op, strokeWeight: isBack ? 3 : 4, zIndex: z + 1 })
      }
      const icons = (zoom: number): google.maps.IconSequence[] => {
        const k = (isBack ? WALK_BACK : 1) * dotFit(zoom)
        const icon: google.maps.Symbol = {
          path: google.maps.SymbolPath.CIRCLE,
          scale: ((WALK_DOT + WALK_EDGE) / 2) * k,
          fillColor: tint,
          fillOpacity: op,
          strokeColor: land,
          strokeOpacity: op,
          strokeWeight: WALK_EDGE * k,
        }
        return [{ icon, offset: '0', repeat: `${WALK_STEP * k}px` }]
      }
      const dots = (coords: LL[]) => dotted.current.push({ line: add(coords, at(coords), { strokeOpacity: 0, zIndex: z + 2, icons: icons(zoom) }), icons })
      if (s.pieces) {
        for (const p of s.pieces) {
          if (p.kind === 'walk') dots(p.coords)
          else solid(p.coords, p.color ?? tint, lineEdge(p.color ?? tint, dark, land))
        }
      } else if (!s.exact) {
        add(s.coords, at(s.coords), { strokeOpacity: 0, zIndex: z, icons: [{ icon: { path: 'M 0,-1 0,1', strokeColor: tint, strokeOpacity: 0.45 * op, scale: 2 }, offset: '0', repeat: '8px' }] })
      } else if (s.mode === 'transit') solid(s.coords, tint, land)
      else dots(s.coords)
    })
  }

  // 拡大が変わったら、横にずらした線だけを、今の拡大で同じ px だけずれる所へ置き直す（指で広げている途中も、札と同じだけずれる）。
  // 徒歩の点も、今の拡大に合わせて大きさと間を付け直す
  const reshift = () => {
    const m = map.current
    const zoom = m?.getZoom()
    if (!m || zoom === undefined || zoom === drawnZoom.current) return
    drawnZoom.current = zoom
    for (const s of shifted.current) s.line.setPath(shiftLine(s.coords, s.lane * laneGap(zoom), zoom).map(pos))
    for (const d of dotted.current) d.line.setOptions({ icons: d.icons(zoom) })
  }

  useEffect(() => {
    map.current?.setOptions({ gestureHandling: oneFinger ? 'greedy' : 'cooperative' })
  }, [oneFinger, ready])

  // 暗い画面に切り替わったら、下地と線を描き直す（札の色は CSS の変数で切り替わる）
  useEffect(() => {
    const q = window.matchMedia('(prefers-color-scheme: dark)')
    const on = () => {
      map.current?.setOptions({ styles: mapStyle(q.matches), backgroundColor: mapLand(q.matches) })
      drawLines()
      layer.current?.draw()
    }
    q.addEventListener('change', on)
    return () => q.removeEventListener('change', on)
  })

  useEffect(() => {
    const m = map.current
    if (!m || !ready) return
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
        m.setCenter(pos(start))
        m.setZoom(12)
        return
      }
      // 候補が届いて増えたときは、手で動かしておらず映っていない点が出たときだけ映し直す
      const b = new google.maps.LatLngBounds(pos(start))
      b.extend(pos(goal))
      cands.forEach((c) => b.extend({ lat: c.lat, lng: c.lng }))
      const first = !lastFit.current
      lastFit.current = b
      const view = m.getBounds()
      const hidden = !view || cands.some((c) => !view.contains({ lat: c.lat, lng: c.lng }))
      if (first || (hidden && !handMoved.current)) fit(b, FIT_PAD)
      return
    }
    const pts: LL[] = [start, ...plan.stops.map((s) => [s.spot.lng, s.spot.lat] as LL), goal]
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
    const b = new google.maps.LatLngBounds()
    pts.forEach((p) => b.extend(pos(p)))
    lastFit.current = b
    if (fitted.current !== data.area.name) handMoved.current = false
    const view = m.getBounds()
    const hidden = !view || pts.some((p) => !view.contains(pos(p)))
    if (fitted.current !== data.area.name || hidden || !handMoved.current) {
      fit(b, FIT_PAD)
      fitted.current = data.area.name
    }
    return () => {
      stop()
      if (cap !== null) window.clearTimeout(cap)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data, plan, ready])

  // 見つけた便が届いた・変わったら、その区間の線と札を描き直す（駅や停留所まで歩く所の道の線が届いたら、もう一度）
  useEffect(() => {
    if (!ready || !legsIn.current.length) return
    const redraw = () => {
      segs.current = legsIn.current.map((l, i) => toSeg(l, i, buses[i]))
      drawLines()
      feed()
    }
    redraw()
    return followLines([], () => segs.current, redraw)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [buses, ready])

  // プランに入っていない候補（押すと候補の画面を開く）と、この付近で検索の結果
  useEffect(() => {
    if (ready) feed()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [candidates, picked, found, ready])
  useEffect(() => {
    layer.current?.setState({ foundId })
  }, [foundId])

  // 見えている範囲（下から出る画面に隠れる所は除く）。この付近で検索が、探すときに測る
  const visibleBox = (): AreaBox | null => {
    const b = map.current?.getBounds()
    const el = box.current
    if (!b || !el) return null
    const ne = b.getNorthEast()
    const sw = b.getSouthWest()
    const hidden = el.clientHeight ? sheetCover(el) / el.clientHeight : 0
    return [sw.lat() + (ne.lat() - sw.lat()) * hidden, sw.lng(), ne.lat(), ne.lng()]
  }
  if (areaBox) areaBox.current = visibleBox
  useEffect(
    () => () => {
      if (areaBox && areaBox.current === visibleBox) areaBox.current = null
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [],
  )

  // 開いた候補が地図に映っていない（下から出る画面に隠れるときも）ときは、映っている所の真ん中へ動かす
  useEffect(() => {
    layer.current?.setState({ candId })
    const m = map.current
    const c = candId ? candRef.current.find((x) => x.id === candId) : undefined
    if (!m || !c || !ready) return
    const raf = window.requestAnimationFrame(() => {
      const el = box.current
      const p = overlay.current?.getProjection()?.fromLatLngToContainerPixel(new google.maps.LatLng(c.lat, c.lng))
      if (!el || !p) return
      const w = el.clientWidth
      const h = el.clientHeight - sheetCover(el)
      if (p.x >= SEEN && p.x <= w - SEEN && p.y >= SEEN && p.y <= h - SEEN) return
      m.panBy(p.x - w / 2, p.y - h / 2)
    })
    return () => window.cancelAnimationFrame(raf)
  }, [candId, ready])

  // 選んだ場所は、前・その場所・次の 3 か所が入るように映す（showId の候補があるときは、その場所と候補の 2 か所）
  const fitFocus = (i: number) => {
    if (!plan) return
    const start: LL = [data.start.lng, data.start.lat]
    const goal: LL = data.end ? [data.end.lng, data.end.lat] : start
    const at = (k: number): LL => (k < 0 ? start : k >= plan.stops.length ? goal : [plan.stops[k].spot.lng, plan.stops[k].spot.lat])
    const show = showId ? candidates.find((c) => c.id === showId) : undefined
    const b = new google.maps.LatLngBounds()
    ;(show ? [at(i), [show.lng, show.lat] as LL] : [at(i - 1), at(i), at(i + 1)]).forEach((p) => b.extend(pos(p)))
    // 下から出る画面が開き切ってから、その画面に隠れない所に収める
    window.requestAnimationFrame(() => {
      const cover = sheetCover(box.current)
      fit(b, cover > 0 ? { ...FOCUS_PAD, bottom: cover + 44 } : FOCUS_PAD)
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
      const pr = overlay.current?.getProjection()
      const m = map.current
      if (!el || !pr || !m) return
      const q = pr.fromLatLngToContainerPixel(new google.maps.LatLng(s.spot.lat, s.spot.lng))
      if (!q || (q.x >= 48 && q.x <= el.clientWidth - 72 && q.y >= 48 && q.y <= el.clientHeight - 72)) return
      m.panTo({ lat: s.spot.lat, lng: s.spot.lng })
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
  }, [focusId, legIdx, candId, foundId])
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
    if (!m || !plan || !ready) return
    if (i >= 0) {
      wasFocused.current = true
      if (legSel.current < 0) fitFocus(i)
    } else if (wasFocused.current) {
      wasFocused.current = false
      if (legSel.current < 0 && !handMoved.current && lastFit.current) fit(lastFit.current, FIT_PAD)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [shownId, plan, showId, ready])

  // 区間だけを見ている画面では、その区間の両端と線が入るように映す（下から出る画面の高さが変わったら映し直す）。
  // 開いている間に手で動かしたら、もう動かさない。閉じたら、開く前の映し方に戻す（手で動かしていなければプラン全体か選んだ場所）
  useEffect(() => {
    const k = plan && legIdx !== null && legIdx >= 0 && legIdx <= plan.stops.length ? legIdx : -1
    const was = legSel.current
    legSel.current = k
    drawLines()
    layer.current?.setState({ leg: k })
    const m = map.current
    if (!m || !plan || !ready) return
    if (k >= 0) {
      const center = m.getCenter()
      if ((was < 0 || !legSave.current) && center) legSave.current = { center, zoom: m.getZoom() ?? 12, moved: false }
      const fitLeg = () => {
        if (legSave.current?.moved) return
        const b = new google.maps.LatLngBounds()
        const goal = goalOf(data)
        legPoints(plan, [data.start.lng, data.start.lat], [goal.lng, goal.lat], segs.current, k).forEach((p) => b.extend(pos(p)))
        const cover = sheetCover(box.current)
        fit(b, cover > 0 ? { ...FOCUS_PAD, bottom: cover + 44 } : FOCUS_PAD)
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
    if (handMoved.current) m.moveCamera({ center: saved.center, zoom: saved.zoom })
    else if (sel.current >= 0) fitFocus(sel.current)
    else if (lastFit.current) fit(lastFit.current, FIT_PAD)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [legIdx, plan, ready])

  useEffect(() => {
    layer.current?.setState({ changed: changed ?? new Set() })
  }, [changed, plan, ready])

  // 地図の大きさが変わったら（向きを変えた・広い画面になった）と、描き直しの合図（凡例の開け閉めなど）が来たら、手で動かしていなければ映し直す
  useEffect(() => {
    const b = box.current
    if (!b || !ready) return
    const again = () => {
      if (!handMoved.current && sel.current < 0 && legSel.current < 0 && lastFit.current) fit(lastFit.current, FIT_PAD)
      layer.current?.draw()
    }
    const ro = new ResizeObserver(again)
    ro.observe(b)
    window.addEventListener(REDRAW_EVENT, again)
    return () => {
      ro.disconnect()
      window.removeEventListener(REDRAW_EVENT, again)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ready])

  const fitAll = () => {
    if (!lastFit.current) return
    handMoved.current = false
    if (legSave.current) legSave.current.moved = true
    fit(lastFit.current, FIT_PAD)
  }

  // 右下の拡大・縮小（手で動かしたのと同じに扱い、あとで勝手に映し直さない）
  const zoomBy = (d: 1 | -1) => {
    const m = map.current
    if (!m) return
    handMoved.current = true
    if (legSave.current) legSave.current.moved = true
    m.setZoom(Math.round(m.getZoom() ?? 12) + d)
  }

  // 現在地：押すと位置を取り、青い点を出してそこへ移る。出ている間は動きに合わせて点を動かす
  const locate = () => {
    const m = map.current
    if (!m) return
    const mine = me.current
    handMoved.current = true
    if (legSave.current) legSave.current.moved = true
    if (mine.at) {
      m.panTo(pos(mine.at))
      if ((m.getZoom() ?? 0) < 15) m.setZoom(15)
      return
    }
    if (mine.watch !== null) return
    if (!('geolocation' in navigator) || !window.isSecureContext) {
      say(MAPW.noGeo)
      return
    }
    setLocating('wait')
    let first = true
    mine.watch = navigator.geolocation.watchPosition(
      (p) => {
        const ll: LL = [p.coords.longitude, p.coords.latitude]
        mine.at = ll
        layer.current?.setState({ me: ll })
        setLocating('on')
        if (first) {
          first = false
          m.panTo(pos(ll))
          if ((m.getZoom() ?? 0) < 15) m.setZoom(15)
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
  useEffect(
    () => () => {
      const w = me.current.watch
      if (w !== null) navigator.geolocation.clearWatch(w)
    },
    [],
  )

  const peekAt = peek && plan ? plan.stops.findIndex((x) => x.spot.id === peek) : -1
  const hasPlan = !!plan && plan.stops.length > 0
  return (
    <div ref={setWrap} className={big ? 'map-wrap big' : 'map-wrap'}>
      <div ref={box} className="map gmap" role="region" aria-label={MAPW.map} />
      <RouteWait on={routing} />
      {onAreaSearch && ready && (
        <button type="button" className="map-search" onClick={onAreaSearch} disabled={searching}>
          {/* 形の出典: Lucide（https://lucide.dev）の search。ISC ライセンス */}
          <svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true">
            <circle cx="11" cy="11" r="7" />
            <path d="m20 20-3.5-3.5" />
          </svg>
          {MAPW.searchHere}
        </button>
      )}
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
