export const EMPHASIS_PATTERN: RegExp;
export function parseEmphasis(text: unknown): { plain: string; spans: { start: number; end: number; color: string | null }[] };
