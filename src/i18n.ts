import { createContext, useContext } from 'react'

type TranslationTree = {
  [key: string]: string | TranslationTree
}

export type Locale = 'ja' | 'en'

const localeCache: Partial<Record<Locale, TranslationTree>> = {}
const localePromiseCache: Partial<Record<Locale, Promise<TranslationTree>>> = {}

const LocaleContext = createContext<Locale>('ja')

export const LocaleProvider = LocaleContext.Provider

export function useLocale(): Locale {
  return useContext(LocaleContext)
}

export const localeOptions: Locale[] = ['ja', 'en']

function resolveTranslation(tree: TranslationTree, key: string): string | undefined {
  return key.split('.').reduce<string | TranslationTree | undefined>((current, segment) => {
    if (!current || typeof current === 'string') {
      return undefined
    }

    return current[segment]
  }, tree) as string | undefined
}

async function fetchLocaleFile(locale: Locale): Promise<TranslationTree> {
  const response = await fetch(`${import.meta.env.BASE_URL}i18n/${locale}.json`)

  if (!response.ok) {
    throw new Error(`Failed to load locale: ${locale}`)
  }

  return (await response.json()) as TranslationTree
}

export async function loadLocale(locale: Locale): Promise<TranslationTree> {
  const cached = localeCache[locale]
  if (cached) {
    return cached
  }

  const pending = localePromiseCache[locale]
  if (pending) {
    return pending
  }

  const request = fetchLocaleFile(locale).then((dictionary) => {
    localeCache[locale] = dictionary
    return dictionary
  })

  localePromiseCache[locale] = request

  return request.finally(() => {
    delete localePromiseCache[locale]
  })
}

export function t(key: string, values: Record<string, string | number> = {}, locale: Locale = 'ja'): string {
  const current = localeCache[locale]
  const fallback = localeCache.ja
  const template = (current ? resolveTranslation(current, key) : undefined) ?? (fallback ? resolveTranslation(fallback, key) : undefined)

  if (!template) {
    return key
  }

  return template.replace(/\{\{(\w+)\}\}/g, (_match, placeholder: string) => {
    const value = values[placeholder]
    return value === undefined ? '' : String(value)
  })
}
