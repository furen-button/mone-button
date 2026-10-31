// dev 限定: vite-plugin-data-editor の削除エンドポイントを叩き、json と mp4 を trash/ へ退避する。
// 呼び出し側は import.meta.env.DEV でガードする前提。
import type { VoiceData } from '../voiceData'

export async function deleteClipData(fileBaseName: string): Promise<void> {
  const response = await fetch('/__data/delete', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ fileBaseName }),
  })

  if (!response.ok) {
    const detail = (await response.json().catch(() => null)) as { error?: string } | null
    throw new Error(detail?.error ?? `削除に失敗しました (${response.status})`)
  }
}

export async function trimClipData(fileBaseName: string, keepStart: number, keepEnd: number): Promise<VoiceData> {
  const response = await fetch('/__data/trim', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ fileBaseName, keepStart, keepEnd }),
  })

  if (!response.ok) {
    const detail = (await response.json().catch(() => null)) as { error?: string } | null
    throw new Error(detail?.error ?? `トリムに失敗しました (${response.status})`)
  }

  const result = (await response.json()) as { updated: VoiceData }
  return result.updated
}

export async function excerptClipData(
  fileBaseName: string,
  keepStart: number,
  keepEnd: number,
): Promise<{ fileBaseName: string; created: VoiceData }> {
  const response = await fetch('/__data/excerpt', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ fileBaseName, keepStart, keepEnd }),
  })

  if (!response.ok) {
    const detail = (await response.json().catch(() => null)) as { error?: string } | null
    throw new Error(detail?.error ?? `切り出しに失敗しました (${response.status})`)
  }

  return response.json() as Promise<{ fileBaseName: string; created: VoiceData }>
}

export type TranscribeResult = { serif: string; ruby: string; raw: string; ms: number }

export async function transcribeClip(fileBaseName: string, signal?: AbortSignal): Promise<TranscribeResult> {
  const response = await fetch('/__data/transcribe', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ fileBaseName }),
    signal,
  })
  if (!response.ok) {
    const detail = (await response.json().catch(() => null)) as { error?: string } | null
    throw new Error(detail?.error ?? `文字起こしに失敗しました (${response.status})`)
  }
  return response.json() as Promise<TranscribeResult>
}

export async function generateRuby(text: string, signal?: AbortSignal): Promise<{ ruby: string }> {
  const response = await fetch('/__data/ruby', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ text }),
    signal,
  })
  if (!response.ok) {
    const detail = (await response.json().catch(() => null)) as { error?: string } | null
    throw new Error(detail?.error ?? `読みの生成に失敗しました (${response.status})`)
  }
  return response.json() as Promise<{ ruby: string }>
}

// dev 限定: public/videos にある mp4 の一覧（拡張子なし）。未ダウンロードのクリップを見分けるのに使う。
export async function fetchVideoStatus(signal?: AbortSignal): Promise<Set<string>> {
  const response = await fetch('/__data/status', { cache: 'no-store', signal })
  if (!response.ok) {
    throw new Error(`動画一覧の取得に失敗しました (${response.status})`)
  }
  const result = (await response.json()) as { videos?: unknown }
  const videos = Array.isArray(result.videos)
    ? result.videos.filter((entry): entry is string => typeof entry === 'string')
    : []
  return new Set(videos)
}
