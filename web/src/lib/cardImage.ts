// 縦長の画像（1080×1920）を Canvas に直接描くための共通の部品。旅の振り返りカード（lib/recap.ts）と、プランの画像（lib/planImage.ts）が使う。
// 保存の仕方も共通: 共有できる端末（スマホなど）では共有の画面を開き、できなければ画像をダウンロードする
import { isEn } from './i18n'
import { MODE_SHAPE, type Mode } from './modeShape'

export const CARD_W = 1080
export const CARD_H = 1920
export const INK = '#15233a'
export const INK2 = '#566377'
export const INK3 = '#8994a3'
export const ROUTE = '#0d8492'
export const PAPER = '#f3f5f7'
export const FONT = '"M PLUS 2", "Hiragino Sans", "Noto Sans JP", "Yu Gothic UI", Meiryo, sans-serif'
export const NUM = `"Barlow Semi Condensed", ${FONT}`

const MORE = isEn ? '…' : '……'

export function rrect(c: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  c.beginPath()
  c.moveTo(x + r, y)
  c.arcTo(x + w, y, x + w, y + h, r)
  c.arcTo(x + w, y + h, x, y + h, r)
  c.arcTo(x, y + h, x, y, r)
  c.arcTo(x, y, x + w, y, r)
  c.closePath()
}

// 幅に収まるように折り返す（行数を超えたら、最後に「……」）。英語は単語の途中で折り返さない
export function wrap(c: CanvasRenderingContext2D, text: string, maxW: number, maxLines: number): string[] {
  const lines: string[] = []
  let cur = ''
  for (const ch of isEn ? (text.match(/\S+\s*/g) ?? []) : text) {
    if (isEn && !cur && c.measureText(ch).width > maxW) {
      cur = ch
      continue
    }
    if (c.measureText(cur + ch).width > maxW && cur) {
      lines.push(cur)
      cur = ch
      if (lines.length === maxLines) break
    } else cur += ch
  }
  if (lines.length < maxLines && cur) lines.push(cur)
  if (lines.join('').length < text.length && lines.length) {
    let last = lines[lines.length - 1].trimEnd()
    while (last && c.measureText(last + MORE).width > maxW) last = last.slice(0, -1)
    lines[lines.length - 1] = last.trimEnd() + MORE
  }
  return lines.map((l) => l.trimEnd())
}

// 乗り物のアイコン（lib/modeShape.ts の Lucide の形）を、左の端 x・縦の真ん中 cy・一辺 s で、線で描く
export function drawModeIcon(c: CanvasRenderingContext2D, mode: Mode, x: number, cy: number, s: number, color: string) {
  const shape = MODE_SHAPE[mode]
  c.save()
  c.translate(x, cy - s / 2)
  c.scale(s / 24, s / 24)
  c.strokeStyle = color
  c.lineWidth = 2
  c.lineCap = 'round'
  c.lineJoin = 'round'
  for (const d of shape.paths) c.stroke(new Path2D(d))
  for (const [cx, cy2] of shape.circles ?? []) {
    c.beginPath()
    c.arc(cx, cy2, 2, 0, Math.PI * 2)
    c.stroke()
  }
  c.restore()
}

// 1 行に収まらなければ、後ろを「……」にする
export const fit = (c: CanvasRenderingContext2D, text: string, maxW: number) => wrap(c, text, maxW, 1)[0] ?? ''

export async function loadFonts() {
  try {
    await Promise.all([
      document.fonts.load(`800 40px ${FONT}`),
      document.fonts.load(`700 40px ${FONT}`),
      document.fonts.load(`500 28px ${FONT}`),
      document.fonts.load(`400 28px ${FONT}`),
      document.fonts.load(`700 30px ${NUM}`),
      document.fonts.load(`600 30px ${NUM}`),
    ])
  } catch {
    /* フォントが読めなくても、代わりの書体で描く */
  }
}

// 縦長の画像の Canvas（地の色で塗ってある）。h: 高さ（中身が多い画像は 1920 より高くする）
export function newCard(h = CARD_H): { cv: HTMLCanvasElement; c: CanvasRenderingContext2D } {
  const cv = document.createElement('canvas')
  cv.width = CARD_W
  cv.height = h
  const c = cv.getContext('2d')!
  c.textBaseline = 'alphabetic'
  c.fillStyle = PAPER
  c.fillRect(0, 0, CARD_W, h)
  return { cv, c }
}

export const toPng = (cv: HTMLCanvasElement) => new Promise<Blob>((resolve, reject) => cv.toBlob((b) => (b ? resolve(b) : reject(new Error('toBlob'))), 'image/png'))

// 画像のファイルの名前（intentrip-エリア.png。kind があれば intentrip-エリア-kind.png）
export const cardFileName = (area: string, kind?: string) => `intentrip-${area}${kind ? `-${kind}` : ''}.png`

// 共有できる端末（スマホなど）では共有の画面を開き、できなければ、画像をダウンロードする
export async function saveCard(blob: Blob, url: string, name: string, title: string) {
  const file = new File([blob], name, { type: 'image/png' })
  try {
    if (navigator.canShare?.({ files: [file] })) {
      await navigator.share({ files: [file], title })
      return
    }
  } catch (e) {
    if (e instanceof DOMException && e.name === 'AbortError') return
  }
  const a = document.createElement('a')
  a.href = url
  a.download = file.name
  a.click()
}
