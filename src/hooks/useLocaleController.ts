import { useCallback, useEffect, useRef, useState } from 'react'
import { loadLocale, t, type Locale } from '../i18n'

const LOCALE_STORAGE_KEY = 'mone-button-locale'

// ロケールの読み込み・永続化・<html lang>・document.title の管理をまとめたフック。
export function useLocaleController() {
  const [locale, setLocale] = useState<Locale>(() => {
    const saved = window.localStorage.getItem(LOCALE_STORAGE_KEY)

    if (saved === 'ja' || saved === 'en') {
      return saved
    }

    return 'ja'
  })
  const [isLocaleReady, setIsLocaleReady] = useState(false)
  const localeChangeRequestRef = useRef(0)

  useEffect(() => {
    let isActive = true

    void loadLocale(locale)
      .then(() => {
        if (isActive) {
          setIsLocaleReady(true)
        }
      })
      .catch(() => {
        if (isActive) {
          setIsLocaleReady(true)
        }
      })

    return () => {
      isActive = false
    }
  }, [locale])

  useEffect(() => {
    if (!isLocaleReady) {
      return
    }

    document.documentElement.lang = locale
    window.localStorage.setItem(LOCALE_STORAGE_KEY, locale)
  }, [isLocaleReady, locale])

  useEffect(() => {
    if (!isLocaleReady) {
      return
    }

    document.title = t('app.title', {}, locale)
  }, [isLocaleReady, locale])

  const changeLocale = useCallback(
    async (nextLocale: Locale) => {
      if (nextLocale === locale) {
        return
      }

      const requestId = ++localeChangeRequestRef.current
      await loadLocale(nextLocale)

      if (localeChangeRequestRef.current !== requestId) {
        return
      }

      setLocale(nextLocale)
    },
    [locale],
  )

  return { locale, isLocaleReady, changeLocale }
}
