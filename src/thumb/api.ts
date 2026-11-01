import type { Project, Recipe } from '../../scripts/create-video/thumbnail.js'
export type Template = { name: string; template: Project }
export type Face = { src: string; preview: string; kind: string; rating: number }
export type Assets = { faces: Face[]; images: { src: string }[]; templates: Template[] }
export type Clip = { base: string; serif: string; source: string | null; duration: number }
export type Context = { title: string; clips: Clip[]; project: Project | null }
export type Frame = { src: string; recipe: Recipe; fallback: boolean; reason: string | null }
export async function api<T>(endpoint: string, body?: unknown): Promise<T> {
  const response = await fetch(
    `/__cv/thumbnail/${endpoint}`,
    body === undefined
      ? undefined
      : { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) },
  )
  const data = await response.json()
  if (!response.ok) {
    throw new Error(data.error || response.statusText)
  }
  return data as T
}
export async function upload(endpoint: string, body: Blob): Promise<{ src: string }> {
  const response = await fetch(`/__cv/thumbnail/${endpoint}`, {
    method: 'POST',
    headers: { 'Content-Type': body.type },
    body,
  })
  const data = await response.json()
  if (!response.ok) {
    throw new Error(data.error || response.statusText)
  }
  return data
}
export function assetUrl(src: string) {
  return `/__cv/file?kind=thumbnail-asset&name=${encodeURIComponent(src)}`
}
