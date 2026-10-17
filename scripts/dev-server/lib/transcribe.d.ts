export function toRuby(text: string): Promise<string>

export type WhisperConfig = { cli: string; modelPath: string; language: string }
export type TranscribeResult = { serif: string; ruby: string; raw: string; ms: number }
export function resolveWhisperConfig(env: Record<string, string | undefined>, repoRoot: string): WhisperConfig
export function buildWhisperArgs(options: { config: WhisperConfig; wavPath: string; outputPrefix: string }): string[]
export function cleanTranscript(raw: string): string
export function transcribeFile(options: { ffmpeg: string; videoPath: string; config: WhisperConfig }): Promise<TranscribeResult>
