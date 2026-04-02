/**
 * Content safety filter — Tier 1: Keyword blocklist.
 *
 * Streaming-aware with sliding window buffer for word boundary handling.
 * Logs all matches to content_filter_log table.
 */

import { execute } from '../db/queries.js'
import { openai } from '@ai-sdk/openai'
import { generateText } from 'ai'

// ---------------------------------------------------------------------------
// Blocklist
// ---------------------------------------------------------------------------

type Severity = 'low' | 'medium' | 'critical'

interface BlocklistEntry {
  pattern: RegExp
  severity: Severity
}

// Default blocklist — intentionally abbreviated/hashed for source control.
// Real deployment would load from DB or config file.
const DEFAULT_WORDS: Array<{ word: string; severity: Severity }> = [
  // Low severity: common profanity
  { word: 'damn', severity: 'low' },
  { word: 'hell', severity: 'low' },
  { word: 'crap', severity: 'low' },
  { word: 'ass', severity: 'low' },
  { word: 'piss', severity: 'low' },
  // Medium severity: stronger language / slurs
  { word: 'shit', severity: 'medium' },
  { word: 'fuck', severity: 'medium' },
  { word: 'bitch', severity: 'medium' },
  { word: 'bastard', severity: 'medium' },
  // Critical severity: crisis/safety signals (these log but don't redact — they need human review)
  { word: 'kill myself', severity: 'critical' },
  { word: 'want to die', severity: 'critical' },
  { word: 'self-harm', severity: 'critical' },
  { word: 'suicide', severity: 'critical' },
]

let currentWords: Array<{ word: string; severity: Severity }> = [...DEFAULT_WORDS]
let blocklist: BlocklistEntry[] = buildBlocklist(currentWords)

function buildBlocklist(words: Array<{ word: string; severity: Severity }>): BlocklistEntry[] {
  return words.map(({ word, severity }) => ({
    pattern: new RegExp(`\\b${escapeRegex(word)}\\b`, 'gi'),
    severity,
  }))
}

function escapeRegex(str: string): string {
  return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

// ---------------------------------------------------------------------------
// Filter API
// ---------------------------------------------------------------------------

export interface FilterResult {
  clean: string
  matched: string[]
  severity: Severity | null
}

/**
 * Filter a complete text string against the blocklist.
 * Returns cleaned text with matches replaced by [redacted].
 */
export function filterText(text: string): FilterResult {
  const matched: string[] = []
  let maxSeverity: Severity | null = null
  let clean = text

  for (const entry of blocklist) {
    const matches = text.match(entry.pattern)
    if (matches) {
      for (const m of matches) {
        matched.push(m.toLowerCase())
      }
      if (!maxSeverity || severityRank(entry.severity) > severityRank(maxSeverity)) {
        maxSeverity = entry.severity
      }
      // Critical severity: log but don't redact (needs human review of full context)
      if (entry.severity !== 'critical') {
        clean = clean.replace(entry.pattern, '[redacted]')
      }
    }
  }

  return { clean, matched: [...new Set(matched)], severity: maxSeverity }
}

/**
 * Streaming-aware filter with sliding window buffer.
 * Buffers the tail of each chunk to handle words split across chunks.
 *
 * Returns { output: string to send, buffer: string to carry forward }
 */
export function filterStreamChunk(
  chunk: string,
  buffer: string,
): { output: string; buffer: string; matched: string[]; severity: Severity | null } {
  // Combine buffer + new chunk
  const combined = buffer + chunk

  // Keep the last MAX_WORD_LEN characters in the buffer
  // to catch words that span chunk boundaries
  const MAX_WORD_LEN = 20
  const safeEnd = Math.max(0, combined.length - MAX_WORD_LEN)

  // Find the last word boundary in the safe zone
  let splitPoint = safeEnd
  for (let i = safeEnd; i < combined.length; i++) {
    if (/\s/.test(combined[i] ?? '')) {
      splitPoint = i + 1
    }
  }

  // If the entire combined string fits in the buffer, hold everything
  if (splitPoint === 0 && combined.length <= MAX_WORD_LEN) {
    return { output: '', buffer: combined, matched: [], severity: null }
  }

  const toFilter = combined.slice(0, splitPoint)
  const newBuffer = combined.slice(splitPoint)

  const result = filterText(toFilter)

  return {
    output: result.clean,
    buffer: newBuffer,
    matched: result.matched,
    severity: result.severity,
  }
}

/**
 * Flush any remaining buffer content through the filter.
 * Call this when the stream ends.
 */
export function flushBuffer(buffer: string): FilterResult {
  return filterText(buffer)
}

// ---------------------------------------------------------------------------
// Logging
// ---------------------------------------------------------------------------

export async function logFilterMatch(params: {
  userId: string | null
  conversationId: string | null
  content: string
  matchedWords: string[]
  severity: Severity
  source: 'llm_output' | 'tool_result' | 'user_input'
  actionTaken: 'redacted' | 'blocked' | 'logged'
}): Promise<void> {
  try {
    await execute(
      `INSERT INTO content_filter_log (user_id, conversation_id, content, matched_words, severity, source, action_taken)
       VALUES ($1, $2, $3, $4, $5, $6, $7)`,
      [
        params.userId,
        params.conversationId,
        params.content.slice(0, 500), // Truncate for storage
        params.matchedWords,
        params.severity,
        params.source,
        params.actionTaken,
      ],
    )
    if (params.severity === 'critical') {
      console.warn('[content-filter] CRITICAL match detected:', params.matchedWords, 'user:', params.userId)
    }
  } catch (err) {
    console.error('[content-filter] Failed to log filter match:', err)
  }
}

// ---------------------------------------------------------------------------
// Blocklist management
// ---------------------------------------------------------------------------

/** Get the current blocklist words */
export function getBlocklistWords(): Array<{ word: string; severity: Severity }> {
  return currentWords.map(({ word, severity }) => ({ word, severity }))
}

/** Replace the blocklist with new words */
export function setBlocklistWords(words: Array<{ word: string; severity: Severity }>): void {
  currentWords = [...words]
  blocklist = buildBlocklist(currentWords)
  console.info('[content-filter] Blocklist updated:', words.length, 'entries')
}

// ---------------------------------------------------------------------------
// Tier 2: Sentiment / Crisis Classifier
// ---------------------------------------------------------------------------

const TIER2_PROMPT = `You are a K-12 student safety classifier. Analyze the student message for concerning content.

Classify as exactly one of:
- SAFE — normal student message
- LOW — mild rudeness or frustration (not a safety concern)
- MEDIUM — bullying, harassment, sexually inappropriate content
- CRITICAL — self-harm, suicide ideation, violence threats, abuse disclosure

Respond with ONLY the classification word and a brief reason, e.g.:
CRITICAL: student expressing suicidal ideation
SAFE: normal question about homework`

/**
 * Tier 2 classifier — uses a fast LLM to detect crisis signals that
 * keyword matching would miss. Only called when Tier 1 doesn't flag critical.
 */
export async function classifyContent(text: string): Promise<{
  severity: Severity | null
  reason: string
} | null> {
  try {
    const result = await generateText({
      model: openai('gpt-4o-mini'),
      system: TIER2_PROMPT,
      prompt: text,
      maxTokens: 50,
    })

    const response = result.text.trim()
    const upper = response.toUpperCase()

    if (upper.startsWith('CRITICAL')) {
      return { severity: 'critical', reason: response }
    }
    if (upper.startsWith('MEDIUM')) {
      return { severity: 'medium', reason: response }
    }
    // LOW and SAFE don't need logging
    return null
  } catch (err) {
    console.error('[content-filter] Tier 2 classifier failed:', err)
    return null
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function severityRank(s: Severity): number {
  switch (s) {
    case 'low': return 1
    case 'medium': return 2
    case 'critical': return 3
  }
}
