import { FONT_WEIGHTS } from '../../scripts/create-video/thumbnail.js'
import type { Project } from '../../scripts/create-video/thumbnail.js'

const FONT_GROUPS: Record<string, string[]> = {
  ゴシック: [
    'Noto Sans JP',
    'M PLUS 1p',
    'M PLUS 2',
    'Zen Kaku Gothic New',
    'Zen Kaku Gothic Antique',
    'BIZ UDPGothic',
    'Murecho',
    'IBM Plex Sans JP',
    'Sawarabi Gothic',
  ],
  丸ゴシック: ['M PLUS Rounded 1c', 'Zen Maru Gothic'],
  '太字・見出し': [
    'Dela Gothic One',
    'Mochiy Pop One',
    'Potta One',
    'RocknRoll One',
    'Reggae One',
    'Rampart One',
    'Train One',
    'Darumadrop One',
    'Rock 3D',
    'Chokokutai',
  ],
  '手書き・筆': ['Hachi Maru Pop', 'Yusei Magic', 'Yuji Boku'],
  明朝: ['Kaisei Decol', 'Kaisei Tokumin'],
}

// Google Fonts 公式 google/fonts の各 ofl/<family>/METADATA.pb で OFL と weight を確認（2026-11-02）。
export const FONTS = Object.entries(FONT_WEIGHTS).map(([family, weights]) => ({
  family,
  weights,
  group: Object.entries(FONT_GROUPS).find(([, families]) => families.includes(family))?.[0] || 'その他',
  note: ['Darumadrop One', 'Rock 3D', 'Chokokutai'].includes(family) ? 'かな・英数字のみ' : undefined,
  license: 'SIL Open Font License 1.1',
  specimen: `https://fonts.google.com/specimen/${family.replaceAll(' ', '+')}`,
  metadata: `https://raw.githubusercontent.com/google/fonts/main/ofl/${family.toLowerCase().replaceAll(' ', '')}/METADATA.pb`,
}))

const loaded = new Map<string, Promise<void>>()
function loadCss(family: string): Promise<void> {
  const link = Array.from(document.querySelectorAll<HTMLLinkElement>('link[data-font]')).find(
    (item) => item.dataset.font === family,
  )
  if (!link) {
    return Promise.reject(new Error(`フォントの CSS がありません: ${family}`))
  }
  if (link.sheet) {
    return Promise.resolve()
  }
  return new Promise((resolve, reject) => {
    const timer = window.setTimeout(() => reject(new Error(`フォントの CSS を読み込めません: ${family}`)), 20000)
    link.addEventListener(
      'load',
      () => {
        clearTimeout(timer)
        resolve()
      },
      { once: true },
    )
    link.addEventListener(
      'error',
      () => {
        clearTimeout(timer)
        reject(new Error(`フォントの CSS を読み込めません: ${family}`))
      },
      { once: true },
    )
  })
}
export async function loadFonts(project: Project) {
  await Promise.all(
    project.layers
      .filter((l) => l.type === 'text' && !l.hidden)
      .map(async (layer) => {
        if (layer.type !== 'text') {
          return
        }
        let css = loaded.get(layer.font)
        if (!css) {
          css = loadCss(layer.font)
          loaded.set(layer.font, css)
          css.catch(() => loaded.delete(layer.font))
        }
        await css
        const faces = await document.fonts.load(`${layer.weight} 100px "${layer.font}"`, layer.text || 'あ')
        if (!faces.length) {
          throw new Error(`フォントを読み込めません: ${layer.font}`)
        }
      }),
  )
}
