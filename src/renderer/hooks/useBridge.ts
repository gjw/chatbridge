import { useCallback, useRef, useState } from 'react'
import type { AppHostHandle } from '@/components/apps/AppHost'

/**
 * Hook for interacting with an AppHost component via its ref handle.
 *
 * Usage:
 * ```tsx
 * const { hostRef, invoke, isReady, destroy } = useBridge()
 * return <AppHost ref={hostRef} ... />
 * ```
 */
export function useBridge() {
  const hostRef = useRef<AppHostHandle>(null)
  const [isReady, setIsReady] = useState(false)

  const invoke = useCallback(
    async (toolName: string, parameters: Record<string, unknown>): Promise<unknown> => {
      if (!hostRef.current) {
        throw new Error('AppHost not mounted')
      }
      return hostRef.current.invoke(toolName, parameters)
    },
    [],
  )

  const destroy = useCallback(() => {
    hostRef.current?.destroy()
    setIsReady(false)
  }, [])

  const onReady = useCallback(() => {
    setIsReady(true)
  }, [])

  return {
    hostRef,
    invoke,
    isReady,
    destroy,
    onReady,
  }
}
