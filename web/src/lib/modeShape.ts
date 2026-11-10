// 乗り物の小さな線のアイコンの形（24×24 の枠。線の太さ 2）。画面の部品（components/ModeIcon.tsx）と、Canvas に描く画像（lib/planImage.ts）が使う。
// 形の出典: Lucide（https://lucide.dev）の bus・train-front・footprints。ISC ライセンス（https://lucide.dev/license）。著作権は Lucide Contributors にある
export type Mode = 'bus' | 'train' | 'walk'

export const MODE_SHAPE: Record<Mode, { paths: string[]; circles?: [number, number][] }> = {
  bus: {
    paths: ['M8 6v6', 'M15 6v6', 'M2 12h19.6', 'M18 18h3s.5-1.7.8-2.8c.1-.4.2-.8.2-1.2 0-.4-.1-.8-.2-1.2l-1.4-5C20.1 6.8 19.1 6 18 6H4a2 2 0 0 0-2 2v10h3', 'M9 18h5'],
    circles: [
      [7, 18],
      [16, 18],
    ],
  },
  train: { paths: ['M8 3.1V7a4 4 0 0 0 8 0V3.1', 'm9 15-1-1', 'm15 15 1-1', 'M9 19c-2.8 0-5-2.2-5-5v-4a8 8 0 0 1 16 0v4c0 2.8-2.2 5-5 5Z', 'm8 19-2 3', 'm16 19 2 3'] },
  walk: {
    paths: [
      'M4 16v-2.38C4 11.5 2.97 10.5 3 8c.03-2.72 1.49-6 4.5-6C9.37 2 10 3.8 10 5.5c0 3.11-2 5.66-2 8.68V16a2 2 0 1 1-4 0Z',
      'M20 20v-2.38c0-2.12 1.03-3.12 1-5.62-.03-2.72-1.49-6-4.5-6C14.63 6 14 7.8 14 9.5c0 3.11 2 5.66 2 8.68V20a2 2 0 1 0 4 0Z',
      'M16 17h4',
      'M4 13h4',
    ],
  },
}
