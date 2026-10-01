import { useEffect, useState } from 'react'
import { validateDraft } from '../api'
import type { JsonObject, PreflightState } from '../types'

const IDLE_STATE: PreflightState = { state: 'idle', response: null, error: '' }

// nonce は public/data 側の保存など、draft 以外の要因で再検証したいときに増やす。
export function usePreflight(name: string, draft: JsonObject, nonce = 0): PreflightState {
  const [preflight, setPreflight] = useState<PreflightState>(IDLE_STATE)

  useEffect(() => {
    if (!name) {
      return undefined
    }

    const controller = new AbortController()
    const timer = window.setTimeout(() => {
      setPreflight((current) => ({ ...current, state: 'pending', error: '' }))
      void validateDraft({ name, draft }, controller.signal)
        .then((response) => setPreflight({ state: 'ok', response, error: '' }))
        .catch((error: unknown) => {
          if (controller.signal.aborted) {
            return
          }
          setPreflight({ state: 'error', response: null, error: messageFromError(error) })
        })
    }, 500)

    return () => {
      window.clearTimeout(timer)
      controller.abort()
    }
  }, [draft, name, nonce])

  return name ? preflight : IDLE_STATE
}

function messageFromError(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}
