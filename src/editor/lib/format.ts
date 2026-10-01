export function formatClock(seconds: number | null | undefined): string {
  const total = Math.max(0, Math.round(Number(seconds) || 0))
  const minutes = Math.floor(total / 60)
  const rest = total % 60
  return `${minutes}:${String(rest).padStart(2, '0')}`
}

export function formatSeconds(seconds: number | null | undefined, digits = 2): string {
  return `${(Number(seconds) || 0).toFixed(digits)}s`
}

export function formatBytes(bytes: number | null | undefined): string {
  const value = Number(bytes) || 0
  if (value >= 1024 * 1024) {
    return `${(value / (1024 * 1024)).toFixed(1)} MB`
  }
  if (value >= 1024) {
    return `${(value / 1024).toFixed(0)} KB`
  }
  return `${value} B`
}

export function firstLine(text: string | null | undefined): string {
  return String(text ?? '').split(/\r?\n/u)[0] ?? ''
}

export function formatDateCompact(value: string | null | undefined): string {
  const text = String(value ?? '')
  const match = /^(\d{4})(\d{2})(\d{2})$/u.exec(text)
  if (match) {
    return `${match[1]}-${match[2]}-${match[3]}`
  }
  return text
}

export async function copyText(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text)
    return true
  } catch {
    return false
  }
}
