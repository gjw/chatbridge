/**
 * In-memory pending tool call store.
 *
 * When the LLM emits a tool_use, the server's execute() function
 * creates a pending promise here. The client invokes the app iframe,
 * then POSTs the result back, which resolves the promise.
 */

const TOOL_CALL_TIMEOUT_MS = 120_000 // 2 minutes — OAuth flows need more time

interface PendingCall {
  resolve: (result: unknown) => void
  reject: (error: Error) => void
  timeoutId: ReturnType<typeof setTimeout>
}

const pending = new Map<string, PendingCall>()

/**
 * Wait for a tool call result from the client.
 * Creates a promise that resolves when submitResult is called,
 * or rejects after 30s timeout.
 */
export function waitForResult(toolCallId: string): Promise<unknown> {
  return new Promise((resolve, reject) => {
    const timeoutId = setTimeout(() => {
      pending.delete(toolCallId)
      reject(new Error(`Tool call ${toolCallId} timed out after ${String(TOOL_CALL_TIMEOUT_MS)}ms`))
    }, TOOL_CALL_TIMEOUT_MS)

    pending.set(toolCallId, { resolve, reject, timeoutId })
  })
}

/**
 * Submit a tool call result (called from the tool-result HTTP endpoint).
 * Returns true if the call was pending, false if not found.
 */
export function submitResult(toolCallId: string, result: unknown): boolean {
  const entry = pending.get(toolCallId)
  if (!entry) return false

  clearTimeout(entry.timeoutId)
  pending.delete(toolCallId)
  entry.resolve(result)
  return true
}

/**
 * Submit a tool call error.
 */
export function submitError(toolCallId: string, error: string): boolean {
  const entry = pending.get(toolCallId)
  if (!entry) return false

  clearTimeout(entry.timeoutId)
  pending.delete(toolCallId)
  entry.reject(new Error(error))
  return true
}

export { TOOL_CALL_TIMEOUT_MS }
