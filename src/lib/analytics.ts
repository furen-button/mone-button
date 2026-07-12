import type { PlaybackMode, SortType, VoiceClip } from '../voiceData'

export const ANALYTICS_CONSENT_STORAGE_KEY = 'mone-button-analytics-consent'

export type AnalyticsConsent = 'granted' | 'denied' | 'unknown'
type AnalyticsParam = string | number | boolean
type AnalyticsParams = Record<string, AnalyticsParam | undefined>

export type PlaybackStartSource =
  | 'voice_card'
  | 'random_button'
  | 'waiwai_button'
  | 'sequential_single'
  | 'sequential_waiwai'

export type LinkClickFrom = 'info_modal' | 'voice_group' | 'app_guide'
export type LinkType = 'clip' | 'source_video' | 'channel'

declare global {
  interface Window {
    dataLayer?: unknown[]
    gtag?: (...args: unknown[]) => void
  }
}

let isInitialized = false

function getMeasurementId(): string | null {
  const measurementId = import.meta.env.VITE_GA_MEASUREMENT_ID?.trim()
  return measurementId ? measurementId : null
}

export function isAnalyticsConfigured(): boolean {
  return !import.meta.env.DEV && getMeasurementId() !== null
}

function canTrack(): boolean {
  return isAnalyticsConfigured() && typeof window !== 'undefined'
}

function sanitizeParams(params: AnalyticsParams): Record<string, AnalyticsParam> {
  return Object.fromEntries(Object.entries(params).filter(([, value]) => value !== undefined)) as Record<string, AnalyticsParam>
}

function ensureGtag(): boolean {
  if (!canTrack()) {
    return false
  }

  if (!window.dataLayer) {
    window.dataLayer = []
  }

  if (!window.gtag) {
    window.gtag = (...args: unknown[]) => {
      window.dataLayer?.push(args)
    }
  }

  return true
}

export function getAnalyticsConsent(): AnalyticsConsent {
  if (typeof window === 'undefined') {
    return 'unknown'
  }

  const value = window.localStorage.getItem(ANALYTICS_CONSENT_STORAGE_KEY)
  if (value === 'granted' || value === 'denied') {
    return value
  }

  return 'unknown'
}

export function setAnalyticsConsent(granted: boolean): void {
  if (typeof window === 'undefined') {
    return
  }

  window.localStorage.setItem(ANALYTICS_CONSENT_STORAGE_KEY, granted ? 'granted' : 'denied')
}

export function initializeAnalytics(): boolean {
  if (!canTrack()) {
    return false
  }

  if (getAnalyticsConsent() !== 'granted') {
    return false
  }

  if (!ensureGtag()) {
    return false
  }

  const measurementId = getMeasurementId()
  if (!measurementId) {
    return false
  }

  if (!isInitialized) {
    const existingScript = document.querySelector(`script[src="https://www.googletagmanager.com/gtag/js?id=${measurementId}"]`)

    if (!existingScript) {
      const script = document.createElement('script')
      script.async = true
      script.src = `https://www.googletagmanager.com/gtag/js?id=${measurementId}`
      document.head.appendChild(script)
    }

    window.gtag?.('js', new Date())
    window.gtag?.('config', measurementId, { send_page_view: false })
    isInitialized = true
  }

  return true
}

export function trackEvent(eventName: string, params: AnalyticsParams = {}): void {
  if (!initializeAnalytics()) {
    return
  }

  window.gtag?.('event', eventName, sanitizeParams(params))
}

export function trackPageView(path: string): void {
  const pagePath = path || window.location.pathname
  const pageLocation = new URL(pagePath, window.location.origin).toString()

  trackEvent('page_view', {
    page_path: pagePath,
    page_location: pageLocation,
    page_title: document.title,
  })
}

export function trackPlaybackStart(clip: VoiceClip, playbackMode: PlaybackMode, sourceAction: PlaybackStartSource): void {
  trackEvent('playback_start', {
    fileBaseName: clip.fileBaseName,
    videoId: clip.videoId,
    videoPath: clip.videoPath,
    playbackMode,
    sourceAction,
  })
}

export function trackSequentialToggle(enabled: boolean, playbackMode: PlaybackMode): void {
  trackEvent('sequential_toggle', {
    enabled,
    playbackMode,
  })
}

export function trackSequentialAdvance(
  playbackMode: PlaybackMode,
  fromFileBaseName: string,
  toFileBaseName: string,
): void {
  trackEvent('sequential_advance', {
    playbackMode,
    fromFileBaseName,
    toFileBaseName,
  })
}

export function trackYoutubeLinkClick(linkType: LinkType, from: LinkClickFrom, url: string, videoId?: string): void {
  trackEvent('youtube_link_click', {
    linkType,
    from,
    url,
    videoId,
  })
}

export function trackCategoryToggle(category: string, enabled: boolean): void {
  trackEvent('category_toggle', {
    category,
    enabled,
  })
}

export function trackSortChange(sortType: SortType): void {
  trackEvent('sort_change', {
    sortType,
  })
}
