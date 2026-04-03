import { useCallback, useEffect, useImperativeHandle, useRef, useState, forwardRef } from 'react'
import type { AppToPlatformMessage } from '@shared/types/bridge'
import {
  postToApp,
  isValidOrigin,
  parseAppMessage,
  createInvocationId,
  INVOCATION_TIMEOUT_MS,
} from '@/lib/bridge'
import { proxyApiRequest } from '@/lib/api'

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface AppHostProps {
  /** The app's unique ID */
  appId: string
  /** URL to load in the iframe */
  entryUrl: string
  /** Current session/conversation ID */
  sessionId: string
  /** Trust tier of the app (determines sandbox permissions) */
  trustTier?: string
  /** Auth token for API proxy requests */
  accessToken?: string
  /** Theme to pass to the app */
  theme?: { mode: 'light' | 'dark'; accent: string }
  /** Callback when tool invocation result comes back */
  onToolResult?: (invocationId: string, result: unknown) => void
  /** Callback when tool invocation errors */
  onToolError?: (invocationId: string, error: { code: string; message: string }) => void
  /** Callback when app signals ready */
  onReady?: () => void
  /** Optional className for the container */
  className?: string
}

export interface AppHostHandle {
  /** Invoke a tool in the app. Returns a promise that resolves with the result. */
  invoke: (toolName: string, parameters: Record<string, unknown>) => Promise<unknown>
  /** Send destroy message and clean up */
  destroy: () => void
  /** Whether the app has sent bridge:ready */
  isReady: boolean
}

interface PendingInvocation {
  resolve: (result: unknown) => void
  reject: (error: Error) => void
  timeoutId: ReturnType<typeof setTimeout>
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export const AppHost = forwardRef<AppHostHandle, AppHostProps>(function AppHost(
  { appId, entryUrl, trustTier, sessionId, accessToken, theme, onToolResult, onToolError, onReady, className },
  ref,
) {
  const iframeRef = useRef<HTMLIFrameElement>(null)
  const [ready, setReady] = useState(false)
  const [height, setHeight] = useState(400)
  const pendingRef = useRef<Map<string, PendingInvocation>>(new Map())

  // Derive target origin from entryUrl
  const targetOrigin = (() => {
    try {
      return new URL(entryUrl).origin
    } catch {
      return '*'
    }
  })()

  // --- Message handler ---
  const handleMessage = useCallback(
    (event: MessageEvent) => {
      // Origin validation
      if (!isValidOrigin(event, entryUrl)) {
        return
      }

      // Parse and validate
      const message = parseAppMessage(event.data)
      if (!message) {
        return
      }

      handleBridgeMessage(message)
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [entryUrl],
  )

  function handleBridgeMessage(message: AppToPlatformMessage): void {
    switch (message.type) {
      case 'bridge:ready': {
        setReady(true)
        onReady?.()
        break
      }

      case 'bridge:tool:result': {
        const pending = pendingRef.current.get(message.invocationId)
        if (pending) {
          clearTimeout(pending.timeoutId)
          pendingRef.current.delete(message.invocationId)
          pending.resolve(message.result)
          onToolResult?.(message.invocationId, message.result)
        }
        break
      }

      case 'bridge:tool:error': {
        const pending = pendingRef.current.get(message.invocationId)
        if (pending) {
          clearTimeout(pending.timeoutId)
          pendingRef.current.delete(message.invocationId)
          pending.reject(new Error(`${message.error.code}: ${message.error.message}`))
          onToolError?.(message.invocationId, message.error)
        }
        break
      }

      case 'bridge:ui:resize': {
        setHeight(Math.min(Math.max(message.height, 100), 2000))
        break
      }

      case 'bridge:api:request': {
        if (!accessToken) {
          console.warn('[AppHost] bridge:api:request received but no accessToken available')
          break
        }
        const iframe = iframeRef.current
        if (!iframe) break

        void (async () => {
          try {
            const proxyResult = await proxyApiRequest(
              accessToken,
              appId,
              message.url,
              message.method,
              message.headers ?? undefined,
              message.body ?? undefined,
            )
            postToApp(iframe, {
              type: 'bridge:api:response',
              requestId: message.requestId,
              status: proxyResult.status as number,
              body: proxyResult.body,
            }, targetOrigin)
          } catch (err: unknown) {
            postToApp(iframe, {
              type: 'bridge:api:response',
              requestId: message.requestId,
              status: 500,
              body: { error: err instanceof Error ? err.message : 'Proxy request failed' },
            }, targetOrigin)
          }
        })()
        break
      }

      default: {
        const _exhaustive: never = message
        console.warn('[AppHost] Unknown message type', _exhaustive)
      }
    }
  }

  // --- Listen for messages ---
  useEffect(() => {
    window.addEventListener('message', handleMessage)
    return () => window.removeEventListener('message', handleMessage)
  }, [handleMessage])

  // --- Send init when iframe loads ---
  const handleIframeLoad = useCallback(() => {
    const iframe = iframeRef.current
    if (!iframe) return

    postToApp(iframe, {
      type: 'bridge:init',
      appId,
      sessionId,
      theme: theme ?? { mode: 'light', accent: '#228be6' },
    }, targetOrigin)
  }, [appId, sessionId, theme, targetOrigin])

  // --- Invoke method ---
  const invoke = useCallback(
    (toolName: string, parameters: Record<string, unknown>): Promise<unknown> => {
      return new Promise((resolve, reject) => {
        const iframe = iframeRef.current
        if (!iframe) {
          reject(new Error('Iframe not mounted'))
          return
        }
        if (!ready) {
          reject(new Error('App not ready'))
          return
        }

        const invocationId = createInvocationId()

        const timeoutId = setTimeout(() => {
          pendingRef.current.delete(invocationId)
          // Send destroy on timeout
          postToApp(iframe, { type: 'bridge:destroy' }, targetOrigin)
          reject(new Error(`Tool invocation "${toolName}" timed out after ${INVOCATION_TIMEOUT_MS}ms`))
        }, INVOCATION_TIMEOUT_MS)

        pendingRef.current.set(invocationId, { resolve, reject, timeoutId })

        postToApp(iframe, {
          type: 'bridge:tool:invoke',
          invocationId,
          toolName,
          parameters,
        }, targetOrigin)
      })
    },
    [ready, targetOrigin],
  )

  // --- Destroy method ---
  const destroy = useCallback(() => {
    const iframe = iframeRef.current
    if (iframe) {
      postToApp(iframe, { type: 'bridge:destroy' }, targetOrigin)
    }

    // Reject all pending invocations
    for (const [id, pending] of pendingRef.current) {
      clearTimeout(pending.timeoutId)
      pending.reject(new Error('App destroyed'))
      pendingRef.current.delete(id)
    }

    setReady(false)
  }, [targetOrigin])

  // Clean up on unmount
  useEffect(() => {
    return () => {
      destroy()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // --- Expose handle ---
  useImperativeHandle(ref, () => ({
    invoke,
    destroy,
    get isReady() {
      return ready
    },
  }), [invoke, destroy, ready])

  return (
    <div className={className} style={{ position: 'relative' }}>
      <iframe
        ref={iframeRef}
        src={entryUrl}
        sandbox={trustTier === 'external_auth' ? 'allow-scripts allow-same-origin allow-popups' : 'allow-scripts allow-same-origin'}
        referrerPolicy="no-referrer"
        loading="lazy"
        tabIndex={-1}
        onLoad={handleIframeLoad}
        style={{
          width: '100%',
          height: `${String(height)}px`,
          border: 'none',
          display: 'block',
        }}
        title={`App: ${appId}`}
      />
    </div>
  )
})
