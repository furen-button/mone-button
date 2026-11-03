export const LOUDNESS_TARGET_LUFS: number
export const TRUE_PEAK_LIMIT_DBTP: number

export type LoudnessMeasurement = {
  integrated: number | null
  truePeak: number | null
}

export type LoudnessGain = {
  gainDb: number
  reason: 'target' | 'peak' | 'unmeasurable'
}

export function parseEbur128Summary(stderr: string): LoudnessMeasurement

export function loudnessGain(measurement: LoudnessMeasurement): LoudnessGain

export function volumeFilter(gainDb: number): string | null

export function measureLoudness(options: {
  ffmpeg: string
  input: string
  start?: number
  end?: number
}): Promise<LoudnessMeasurement>
