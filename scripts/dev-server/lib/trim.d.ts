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
