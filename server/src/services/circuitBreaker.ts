/**
 * Per-app circuit breaker.
 * Disables an app temporarily after 3 failures in 5 minutes.
 */

const FAILURE_THRESHOLD = 3
const WINDOW_MS = 5 * 60 * 1000 // 5 minutes

const failures = new Map<string, number[]>()

function pruneOld(timestamps: number[]): number[] {
  const cutoff = Date.now() - WINDOW_MS
  return timestamps.filter((t) => t > cutoff)
}

/**
 * Record a tool invocation failure for an app.
 */
export function recordFailure(appSlug: string): void {
  const existing = failures.get(appSlug) ?? []
  const pruned = pruneOld(existing)
  pruned.push(Date.now())
  failures.set(appSlug, pruned)
  if (pruned.length >= FAILURE_THRESHOLD) {
    console.warn(`[circuit-breaker] App "${appSlug}" tripped: ${String(pruned.length)} failures in 5min`)
  }
}

/**
 * Check if the circuit breaker is open (app should be disabled).
 */
export function isOpen(appSlug: string): boolean {
  const existing = failures.get(appSlug)
  if (!existing) return false
  const pruned = pruneOld(existing)
  failures.set(appSlug, pruned)
  return pruned.length >= FAILURE_THRESHOLD
}

/**
 * Record a success — resets the failure counter for the app.
 */
export function recordSuccess(appSlug: string): void {
  failures.delete(appSlug)
}
