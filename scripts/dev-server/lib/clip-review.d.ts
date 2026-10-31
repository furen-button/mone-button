export const MAX_RUN_UNITS: number
export const IMPORT_WINDOW_SECONDS: number

export type ClipIssueKind = 'video' | 'trim' | 'ruby' | 'serif'
export type AcknowledgeableIssueKind = Exclude<ClipIssueKind, 'video'>

export const ISSUE_KINDS: readonly ClipIssueKind[]
export const ISSUE_LABELS: Readonly<Record<ClipIssueKind, string>>
export const ISSUE_ICONS: Readonly<Record<ClipIssueKind, string>>
export const ACKNOWLEDGEABLE_KINDS: readonly AcknowledgeableIssueKind[]

export type ClipIssue = {
  kind: ClipIssueKind
  message: string
}

export type ClipReviewResult = {
  issues: ClipIssue[]
  acknowledged: ClipIssueKind[]
}

// public/data の JSON に任意で入る「このままで良い」の記録。
// ruby / serif は確認したときの値を持ち、値が変わると無効になる。
export type ClipReview = {
  trim?: true
  ruby?: string
  serif?: string
}

export type SerifRun = {
  text: string
  units: number
}

export type ReviewSummary = {
  total: number
  counts: Record<ClipIssueKind, number>
}

export function charWidth(ch: string): number
export function serifPreviewText(text: string): string
export function runUnits(run: string): number
export function formatUnits(units: number): string
export function splitSerifTokens(serif: string): string[]
export function isSerifSeparator(token: string): boolean
export function findLongSerifRuns(serif: string): SerifRun[]
export function findInvalidRubyChars(ruby: string): string[]
export function isUntrimmedImportWindow(data: unknown): boolean
export function normalizeReview(review: unknown, data: unknown): ClipReview | undefined
export function reviewClip(data: unknown, options?: { hasVideo?: boolean }): ClipReviewResult
export function summarizeReviews(reviews: Iterable<ClipReviewResult>): ReviewSummary
