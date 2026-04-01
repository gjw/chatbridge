import type { PlatformToAppMessage, AppToPlatformMessage } from '@shared/types/bridge'
import { AppToPlatformMessageSchema } from '@shared/types/bridge'

const INVOCATION_TIMEOUT_MS = 30_000
const MAX_MESSAGE_SIZE = 1_048_576 // 1MB

/**
 * Send a typed message to an app iframe.
 */
export function postToApp(
  iframe: HTMLIFrameElement,
  message: PlatformToAppMessage,
  targetOrigin: string,
): void {
  iframe.contentWindow?.postMessage(message, targetOrigin)
}

/**
 * Validate that a MessageEvent origin matches the app's registered entry URL.
 * Compares origin (scheme + host + port) against the entryUrl.
 */
export function isValidOrigin(event: MessageEvent, entryUrl: string): boolean {
  try {
    const expected = new URL(entryUrl)
    return event.origin === expected.origin
  } catch {
    return false
  }
}

/**
 * Parse and validate an incoming message from an app iframe.
 * Returns the parsed message or null if invalid.
 */
export function parseAppMessage(data: unknown): AppToPlatformMessage | null {
  // Size check: reject oversized messages
  const serialized = typeof data === 'string' ? data : JSON.stringify(data)
  if (serialized.length > MAX_MESSAGE_SIZE) {
    console.warn('[bridge] Message exceeds 1MB size limit, ignoring')
    return null
  }

  const result = AppToPlatformMessageSchema.safeParse(data)
  if (!result.success) {
    return null
  }
  return result.data
}

/**
 * Generate a unique invocation ID for correlating tool invoke/result pairs.
 */
export function createInvocationId(): string {
  return crypto.randomUUID()
}

export { INVOCATION_TIMEOUT_MS }
