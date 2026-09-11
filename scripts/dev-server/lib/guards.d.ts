export type LocalRequestInput = {
  method?: string;
  remoteAddress?: string;
  host?: string;
  origin?: string;
  secFetchSite?: string;
  contentType?: string;
};

export type LocalRequestResult =
  | { ok: true }
  | { ok: false; status: 403 | 415; reason: string };

export function checkLocalRequest(input: LocalRequestInput): LocalRequestResult;
export function presetFileName(name: unknown, options?: { allowDefault?: boolean }): string | null;
export function assertNoForbiddenKeys(value: unknown, label?: string): void;
export function assertSafePath(path: unknown): void;
export function outputBaseName(name: unknown): string | null;
export function clipBase(name: unknown): string | null;
