import type { CompactionPoint, Message } from '@shared/types/session'
import { getLatestCompactionBoundaryId } from './context-tokens'

/**
 * Return messages that are part of the active context after compaction.
 * Includes all messages after the latest compaction boundary, plus any
 * summary messages.
 */
export function computeContextAfterCompaction(
  messages: Message[],
  compactionPoints?: CompactionPoint[]
): Message[] {
  const boundaryId = getLatestCompactionBoundaryId(compactionPoints)
  if (!boundaryId) return messages

  const boundaryIndex = messages.findIndex((m) => m.id === boundaryId)
  if (boundaryIndex === -1) return messages

  // Include summary messages from before the boundary + everything after
  const summaries = messages.slice(0, boundaryIndex + 1).filter((m) => m.isSummary)
  const afterBoundary = messages.slice(boundaryIndex + 1)
  return [...summaries, ...afterBoundary]
}
