import { useEffect } from 'react'
import { parkLabels } from './pages/labels'

/** Keep the browser title aligned with the configured park name. */
export function useParkTitle(displayName: string) {
  useEffect(() => {
    document.title = displayName.trim() || parkLabels.brand
  }, [displayName])
}
