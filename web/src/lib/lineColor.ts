// 路線の色。時刻表（GTFS）の route_color があれば、書いてあるとおりに使う（公共交通オープンデータセンターのガイドライン 4: 加工しない）。
// 無ければ路線の名前から決まる色にする。同じ名前ならいつも同じ色で、下の色の並びから選ぶ。
// 並びの色は、明るい画面と暗い画面のどちらの地図の地の色とも 3:1 以上の差があり、決めていない区間の浅葱と灰には寄せない
import type { BusTrip, RailOpt, TransitRoute, TransitStep } from '../types'
import { busName } from './bus'

const PALETTE = ['#d23c3c', '#d9622b', '#a2861a', '#5c9a2e', '#2e9b5e', '#2f7fd1', '#6a5fd0', '#b0479e', '#d04783', '#8d6a4a']

// 終わりの括弧の注記と、内回り・外回りを外す（NFKC でならしたあとの名前に使う）
const dropNotes = (s: string) =>
  s
    .trim()
    .replace(/\([^()]*\)$/, '')
    .trim()
    .replace(/[内外]回り$/, '')
    .trim()

// 書き方の揺れ（全角と半角・前後の空白・終わりの括弧の注記・内回りと外回り）をならした路線名
export const bareLine = (s: string) => dropNotes(s.normalize('NFKC'))

// さらに空白を除いて小文字にした名前（色を決めるときは、これが同じなら同じ路線）
const plain = (s: string) => dropNotes(s.normalize('NFKC').replace(/\s+/g, '')).toLowerCase()

export function nameColor(name: string): string {
  let h = 0x811c9dc5
  for (const ch of plain(name)) {
    h ^= ch.codePointAt(0) ?? 0
    h = Math.imul(h, 0x01000193) >>> 0
  }
  return PALETTE[h % PALETTE.length]
}

const HEX6 = /^[0-9a-f]{6}$/i
export const gtfsColor = (c: string | null | undefined) => (c && HEX6.test(c) ? `#${c}` : null)

export const busColor = (t: BusTrip) => gtfsColor(t.color) ?? nameColor(busName(t))

// 電車の目安の路線の色（地図データの colour。無ければ名前から決まる色）
export const railColor = (r: RailOpt) => gtfsColor(r.color) ?? nameColor(r.line)

// 経路の段の色（歩く段と、路線の名前が読めなかった段は null）
export function stepColor(s: TransitStep, r: TransitRoute): string | null {
  if (s.mode === 'walk') return null
  if (r.bus && s.line === busName(r.bus)) return busColor(r.bus)
  return s.line.trim() ? nameColor(s.line) : null
}

// 路線の色で塗った札の文字の色（札の字は太字）。
// 1. 時刻表が黒のほかの文字の色を決めていて、地の色と 3:1 以上の差があればその色（黒は時刻表の既定の値なので、決めた色とは見ない）
// 2. 白と 3:1 以上の差がある地の色（赤・青・緑など）は白。計算の差は黒の方が大きくても、濃い色の上の太字は白の方が読みやすい
// 3. 白との差が足りない明るい地の色（橙・黄など）は黒
export function inkOn(bg: string, text?: string | null): string {
  const t = gtfsColor(text)?.toLowerCase() ?? null
  if (!HEX.test(bg)) return t ?? '#ffffff'
  const l = luminance(bg)
  const ratio = (x: number) => (Math.max(l, x) + 0.05) / (Math.min(l, x) + 0.05)
  if (t && t !== '#000000' && ratio(luminance(t)) >= 3) return t
  return ratio(1) >= 3 ? '#ffffff' : '#000000'
}

const HEX = /^#[0-9a-f]{6}$/i
const rgb = (hex: string) => [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16))
const toHex = (c: number[]) => `#${c.map((v) => Math.round(v).toString(16).padStart(2, '0')).join('')}`
const luminance = (hex: string) => {
  const [r, g, b] = rgb(hex).map((v) => {
    const x = v / 255
    return x <= 0.04045 ? x / 12.92 : ((x + 0.055) / 1.055) ** 2.4
  })
  return 0.2126 * r + 0.7152 * g + 0.0722 * b
}

// 乗る区間の線の縁取り。明るい画面ではその色を濃くした色、暗い画面では地図の地の色。
// 暗い画面で線の色と地の色の差が 5:1 に届かない色（京都市バスの青・黒など）だけは、その色を明るくした色で縁取る（線の色そのものは変えない）。
// 路線の色が白や黄のような明るい色でも、暗い青や黒でも、地の色に埋もれない
export function lineEdge(color: string, dark: boolean, land: string): string {
  if (!/^#[0-9a-f]{6}$/i.test(color)) return land
  if (!dark) return toHex(rgb(color).map((v) => v * 0.55))
  const l = luminance(color)
  const g = /^#[0-9a-f]{6}$/i.test(land) ? luminance(land) : 0.01
  const ratio = (Math.max(l, g) + 0.05) / (Math.min(l, g) + 0.05)
  return ratio < 5 ? toHex(rgb(color).map((v) => v + (255 - v) * 0.5)) : land
}

// 乗る区間の縁取りを、ふだんより何 px 太くするか。
// 明るい画面で、線の色と地の色の差が 3:1 に届かない色（京都市バスの橙・黄など）は、線の色を変えずに濃い縁取りを左右 1px ずつ太くして、縁取りで地図から浮かせる
// 地の色は、地図の下地から取った rgb()・hsl() の書き方でもよい
export function lineEdgeGrow(color: string, dark: boolean, land: string): number {
  const ground = cssHex(land)
  if (dark || !/^#[0-9a-f]{6}$/i.test(color) || !ground) return 0
  const l = luminance(color)
  const g = luminance(ground)
  return (Math.max(l, g) + 0.05) / (Math.min(l, g) + 0.05) < 3 ? 2 : 0
}

// #rgb・#rrggbb・rgb()・rgba()・hsl()・hsla() を #rrggbb に（読めなければ null）
function cssHex(c: string): string | null {
  const t = c.trim().toLowerCase()
  if (/^#[0-9a-f]{6}$/.test(t)) return t
  if (/^#[0-9a-f]{3}$/.test(t)) return `#${[...t.slice(1)].map((x) => x + x).join('')}`
  const n = t.match(/-?[\d.]+/g)?.map(Number)
  if (!n || n.length < 3) return null
  if (t.startsWith('rgb')) return toHex(n.slice(0, 3))
  if (t.startsWith('hsl')) {
    const [h, sat, li] = [n[0], n[1] / 100, n[2] / 100]
    const a = sat * Math.min(li, 1 - li)
    const f = (k: number) => {
      const x = (k + h / 30) % 12
      return (li - a * Math.max(-1, Math.min(x - 3, 9 - x, 1))) * 255
    }
    return toHex([f(0), f(8), f(4)])
  }
  return null
}
