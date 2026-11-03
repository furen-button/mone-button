import { parseEmphasis } from '../../scripts/create-video/emphasis.js'
import type { Project, Layer, TextLayer, ImageLayer } from '../../scripts/create-video/thumbnail.js'
import { assetUrl } from './api'
import { loadFonts } from './fonts'
export type Images = Map<string, HTMLImageElement>
export type Box = { x: number; y: number; w: number; h: number }
const imageCache = new Map<string, Promise<HTMLImageElement>>()
export async function prepareProject(project: Project): Promise<Images> {
  await loadFonts(project)
  const images: Images = new Map()
  await Promise.all(
    project.layers.map(async (l) => {
      if (l.type !== 'image' || !l.src || l.hidden) {
        return
      }
      const src = l.src
      let promise = imageCache.get(src)
      if (!promise) {
        promise = new Promise((resolve, reject) => {
          const img = new Image()
          img.onload = () => resolve(img)
          img.onerror = () => {
            imageCache.delete(src)
            reject(new Error(`画像を読み込めません: ${src}`))
          }
          img.src = assetUrl(src)
        })
        imageCache.set(src, promise)
      }
      images.set(src, await promise)
    }),
  )
  return images
}
function setupText(ctx: CanvasRenderingContext2D, l: TextLayer) {
  ctx.font = `${l.weight} ${l.size}px "${l.font}"`
  ctx.textBaseline = 'middle'
  ctx.lineJoin = 'round'
  ctx.textAlign = 'left'
}
function textWidth(ctx: CanvasRenderingContext2D, l: TextLayer, text: string) {
  const chars = [...text]
  return (
    chars.reduce((sum, char) => sum + ctx.measureText(char).width, 0) + Math.max(0, chars.length - 1) * l.letterSpacing
  )
}
export function layerBox(ctx: CanvasRenderingContext2D, l: Layer, images: Images): Box {
  if (l.type === 'rect') {
    return { x: 0, y: 0, w: l.w, h: l.h }
  }
  if (l.type === 'image') {
    const img = l.src ? images.get(l.src) : undefined
    const factor = l.fit === 'cover' && img ? Math.max(1280 / img.width, 720 / img.height) : 1
    const w = (img?.width || 1280) * l.scale * factor
    const h = (img?.height || 720) * l.scale * factor
    return { x: -w / 2, y: -h / 2, w, h }
  }
  setupText(ctx, l)
  const lines = parseEmphasis(l.text).plain.split('\n')
  const w = Math.max(1, ...lines.map((line) => textWidth(ctx, l, line)))
  const h = lines.length * l.size * l.lineHeight
  return { x: l.align === 'left' ? 0 : l.align === 'right' ? -w : -w / 2, y: -h / 2, w, h }
}
function drawText(ctx: CanvasRenderingContext2D, l: TextLayer) {
  setupText(ctx, l)
  const { plain, spans } = parseEmphasis(l.text)
  const lines = plain.split('\n')
  let index = 0
  const widths: number[] = []
  let accumulated = 0
  for (const outline of l.outlines) {
    accumulated += outline.width
    widths.push(accumulated * 2)
  }
  const glyphs: { char: string; x: number; y: number; color: string }[] = []
  lines.forEach((line, row) => {
    const width = textWidth(ctx, l, line)
    let x = l.align === 'left' ? 0 : l.align === 'right' ? -width : -width / 2
    for (const char of line) {
      const span = spans.find((s) => index >= s.start && index < s.end)
      glyphs.push({
        char,
        x,
        y: (row - (lines.length - 1) / 2) * l.size * l.lineHeight,
        color: span ? (span.color ? `#${span.color}` : l.emphasisColor) : l.color,
      })
      x += ctx.measureText(char).width + l.letterSpacing
      index++
    }
    index++
  })
  for (let i = l.outlines.length - 1; i >= 0; i--) {
    ctx.lineWidth = widths[i]
    ctx.strokeStyle = l.outlines[i].color
    if (widths[i] > 0) {
      for (const g of glyphs) {
        ctx.strokeText(g.char, g.x, g.y)
      }
    }
  }
  for (const g of glyphs) {
    ctx.fillStyle = g.color
    ctx.fillText(g.char, g.x, g.y)
  }
}
const stickers = new Map<string, HTMLCanvasElement>()
function silhouette(img: HTMLImageElement, color: string) {
  const key = `${img.src}:${color}`
  let result = stickers.get(key)
  if (!result) {
    result = document.createElement('canvas')
    result.width = img.width
    result.height = img.height
    const ctx = result.getContext('2d')!
    ctx.drawImage(img, 0, 0)
    ctx.globalCompositeOperation = 'source-in'
    ctx.fillStyle = color
    ctx.fillRect(0, 0, img.width, img.height)
    stickers.set(key, result)
  }
  return result
}
function drawImage(ctx: CanvasRenderingContext2D, l: ImageLayer, images: Images) {
  const img = l.src ? images.get(l.src) : undefined
  if (!img) {
    return
  }
  const box = layerBox(ctx, l, images)
  ctx.scale(l.flipX ? -1 : 1, 1)
  ctx.filter = `blur(${l.filter.blur}px) brightness(${l.filter.brightness})`
  if (l.shadow) {
    ctx.shadowBlur = l.shadow.blur
    ctx.shadowOffsetX = l.shadow.x
    ctx.shadowOffsetY = l.shadow.y
    ctx.shadowColor = l.shadow.color
  }
  if (l.outline?.width) {
    const mask = silhouette(img, l.outline.color)
    // 切り抜き（face-focus）は正方形で切られていて、画像の端に接した部分まで縁取ると切り口に白い線が出る。
    // 縁取りは画像の矩形の内側だけに描く（端から縁取りの太さより内側にある輪郭だけが縁取られる）。
    ctx.save()
    ctx.beginPath()
    ctx.rect(box.x, box.y, box.w, box.h)
    ctx.clip()
    for (let i = 0; i < 24; i++) {
      const angle = (i * Math.PI) / 12
      ctx.drawImage(
        mask,
        box.x + Math.cos(angle) * l.outline.width,
        box.y + Math.sin(angle) * l.outline.width,
        box.w,
        box.h,
      )
      // 影を24回重ねない。
      ctx.shadowColor = 'transparent'
    }
    ctx.restore()
    // restore で影の設定が戻るので、本体には影を付けない（影は縁取りの 1 回目だけ）。
    ctx.shadowColor = 'transparent'
  }
  ctx.drawImage(img, box.x, box.y, box.w, box.h)
}
// 表示と保存は同じ論理サイズ・描画経路を使う。操作の枠は別の SVG に描く。
export function renderProject(ctx: CanvasRenderingContext2D, project: Project, images: Images) {
  ctx.setTransform(1, 0, 0, 1, 0, 0)
  ctx.clearRect(0, 0, 1280, 720)
  ctx.fillStyle = '#2A1446'
  ctx.fillRect(0, 0, 1280, 720)
  for (const l of project.layers) {
    if (l.hidden) {
      continue
    }
    ctx.save()
    ctx.translate(l.x, l.y)
    ctx.rotate((l.rotation * Math.PI) / 180)
    ctx.globalAlpha = l.opacity
    if (l.type === 'text') {
      drawText(ctx, l)
    } else if (l.type === 'image') {
      drawImage(ctx, l, images)
    } else {
      if (typeof l.fill === 'string') {
        ctx.fillStyle = l.fill
      } else {
        const rad = (l.fill.angle * Math.PI) / 180
        const dx = (Math.sin(rad) * l.w) / 2
        const dy = (Math.cos(rad) * l.h) / 2
        const gradient = ctx.createLinearGradient(l.w / 2 - dx, l.h / 2 - dy, l.w / 2 + dx, l.h / 2 + dy)
        gradient.addColorStop(0, l.fill.from)
        gradient.addColorStop(1, l.fill.to)
        ctx.fillStyle = gradient
      }
      ctx.beginPath()
      ctx.roundRect(0, 0, l.w, l.h, Math.min(l.radius, l.w / 2, l.h / 2))
      ctx.fill()
    }
    ctx.restore()
  }
}
export async function exportProject(project: Project, format: 'jpg' | 'png') {
  const images = await prepareProject(project)
  const canvas = document.createElement('canvas')
  canvas.width = 1280
  canvas.height = 720
  renderProject(canvas.getContext('2d')!, project, images)
  let quality = 0.92
  for (;;) {
    const blob = await new Promise<Blob>((resolve, reject) =>
      canvas.toBlob(
        (value) => (value ? resolve(value) : reject(new Error('画像を書き出せません。'))),
        format === 'jpg' ? 'image/jpeg' : 'image/png',
        quality,
      ),
    )
    if (blob.size <= 2 * 1024 ** 2) {
      return blob
    }
    if (format === 'png' || quality <= 0.32) {
      throw new Error('画像が2MBを超えています。JPEG または単純な配置で保存してください。')
    }
    quality -= 0.1
  }
}
