// 例のプラン（server/sample.json・sample.en.json）に入れてある写真を、場所の名前と一緒に取り出す（写真の試験で使う）
import { readFileSync } from 'node:fs'

export function samplePhotos(file) {
  const data = JSON.parse(readFileSync(new URL(`../../server/${file}`, import.meta.url), 'utf8'))
  const out = []
  const walk = (o) => {
    if (Array.isArray(o)) return o.forEach(walk)
    if (!o || typeof o !== 'object') return
    if (o.photo && typeof o.photo === 'object' && typeof o.photo.url === 'string') out.push({ name: o.name ?? o.photo.title ?? '?', photo: o.photo })
    Object.values(o).forEach(walk)
  }
  walk(data)
  return out
}
