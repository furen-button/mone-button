export class TrimValidationError extends Error {
  status: number
  constructor(status: number, message: string)
}

export type ParsedTrimPayload = {
  fileBaseName: string
  keepStart: number
  keepEnd: number
}

export type TrimPlan = ParsedTrimPayload & {
  noop: boolean
  updated: Record<string, unknown>
}

export function parseTrimPayload(payload: unknown): ParsedTrimPayload

export function createTrimPlan(
  payload: unknown,
  current: Record<string, unknown>,
  sourceDuration: number,
): TrimPlan

export type ExcerptPlan = ParsedTrimPayload & {
  targetBaseName: string
  created: Record<string, unknown>
}

export function createExcerptPlan(
  payload: unknown,
  current: Record<string, unknown>,
  sourceDuration: number,
): ExcerptPlan

export type ParsedExtendPayload = {
  fileBaseName: string
  extendStart: number
  extendEnd: number
}

export type ExtendPlan = {
  fileBaseName: string
  videoId: string
  addedStart: number
  addedEnd: number
  updated: Record<string, unknown> & { trimming: { startTime: number, endTime: number } }
}

export function parseExtendPayload(payload: unknown): ParsedExtendPayload

export function createExtendPlan(
  payload: unknown,
  current: Record<string, unknown>,
): ExtendPlan
