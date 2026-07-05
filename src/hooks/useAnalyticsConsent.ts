import { useCallback, useEffect, useRef, useState } from 'react'
import {
  getAnalyticsConsent,
  initializeAnalytics,
  isAnalyticsConfigured,
  setAnalyticsConsent,
  trackPageView,
  type AnalyticsConsent,
} from '../lib/analytics'

// アナリティクス同意状態・初回 pageview 送信・同意/拒否ハンドラをまとめたフック。
export function useAnalyticsConsent() {
  const [consent, setConsentState] = useState<AnalyticsConsent>(() => getAnalyticsConsent())
  const pageViewSentRef = useRef(false)
  const shouldShowBanner = isAnalyticsConfigured() && consent === 'unknown'

  useEffect(() => {
    if (consent !== 'granted') {
      return
    }

    const initialized = initializeAnalytics()
    if (!initialized || pageViewSentRef.current) {
      return
    }

    trackPageView(`${window.location.pathname}${window.location.search}`)
    pageViewSentRef.current = true
  }, [consent])

  const acceptConsent = useCallback(() => {
    setAnalyticsConsent(true)
    setConsentState('granted')
  }, [])

  const declineConsent = useCallback(() => {
    setAnalyticsConsent(false)
    setConsentState('denied')
  }, [])

  return { shouldShowBanner, acceptConsent, declineConsent }
}
