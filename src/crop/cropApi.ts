import { EditorApiError } from '../editor/api'
import type { JobSummary } from '../editor/types'
import type { ClipMatch, CropRequest, CropStillMeta, UploadResult } from './types'

const API_BASE = '/__cv'

// 本文をそのまま送る。fetch では送信の進捗が取れないので XHR を使う。
export function uploadVideo(file: File, onProgress: (ratio: number) => void): { promise: Promise<UploadResult>; abort: () => void } {
  const xhr = new XMLHttpRequest()
  const promise = new Promise<UploadResult>((resolve, reject) => {
    xhr.open('POST', `${API_BASE}/crop/upload?name=${encodeURIComponent(file.name)}`)
    xhr.setRequestHeader('Content-Type', file.type.startsWith('video/') ? file.type : 'application/octet-stream')
    xhr.upload.onprogress = (event) => {
      if (event.lengthComputable) {
        onProgress(event.loaded / event.total)
      }
    }
    xhr.onload = () => {
      const payload = parseJson(xhr.responseText)
      if (xhr.status >= 200 && xhr.status < 300) {
        resolve(payload as UploadResult)
      } else {
        reject(new EditorApiError(xhr.status, { error: errorText(payload) ?? xhr.statusText }))
      }
    }
    xhr.onerror = () => reject(new EditorApiError(0, { error: 'アップロードに失敗しました' }))
    xhr.onabort = () => reject(new EditorApiError(499, { error: 'aborted' }))
    xhr.send(file)
  })
  return { promise, abort: () => xhr.abort() }
}

// 照合できなければ null（404）。
export async function getClip(base: string): Promise<ClipMatch | null> {
  const response = await fetch(`${API_BASE}/crop/clip/${encodeURIComponent(base)}`)
  if (response.status === 404) {
    return null
  }
  const payload = await response.json().catch(() => null)
  if (!response.ok) {
    throw new EditorApiError(response.status, { error: errorText(payload) ?? response.statusText })
  }
  return (payload as { clip: ClipMatch }).clip
}

export async function renderCropStill(body: CropRequest & { at: number }, signal?: AbortSignal): Promise<{ blob: Blob; meta: CropStillMeta }> {
  const response = await fetch(`${API_BASE}/crop/still`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
    signal,
  })
  if (!response.ok) {
    const payload = await response.json().catch(() => null)
    throw new EditorApiError(response.status, { error: errorText(payload) ?? response.statusText })
  }
  const encoded = response.headers.get('X-Crop-Meta')
  const meta = encoded ? (JSON.parse(decodeURIComponent(encoded)) as CropStillMeta) : null
  if (!meta) {
    throw new EditorApiError(500, { error: 'X-Crop-Meta header is missing' })
  }
  return { blob: await response.blob(), meta }
}

export async function startCropExport(body: CropRequest): Promise<{ job: JobSummary; outName: string }> {
  const response = await fetch(`${API_BASE}/crop/export`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
  const payload = await response.json().catch(() => null)
  if (!response.ok) {
    throw new EditorApiError(response.status, { error: errorText(payload) ?? response.statusText })
  }
  return payload as { job: JobSummary; outName: string }
}

function parseJson(text: string): unknown {
  try {
    return JSON.parse(text)
  } catch {
    return null
  }
}

function errorText(payload: unknown): string | null {
  if (payload && typeof payload === 'object' && typeof (payload as { error?: unknown }).error === 'string') {
    return (payload as { error: string }).error
  }
  return null
}
