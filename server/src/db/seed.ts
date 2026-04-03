import bcrypt from 'bcryptjs'
import { readFileSync } from 'fs'
import { resolve, dirname } from 'path'
import { fileURLToPath } from 'url'
import { pool } from './pool.js'

const __dirname = dirname(fileURLToPath(import.meta.url))

async function seed(): Promise<void> {
  const adminHash = await bcrypt.hash('admin123', 10)
  const teacherHash = await bcrypt.hash('teacher123', 10)
  const studentHash = await bcrypt.hash('student123', 10)

  // --- Users ---
  const adminResult = await pool.query(
    `INSERT INTO users (email, password, role, name)
     VALUES ($1, $2, $3, $4)
     ON CONFLICT (email) DO UPDATE SET name = EXCLUDED.name
     RETURNING id`,
    ['admin@chatbridge.local', adminHash, 'admin', 'Admin User'],
  )
  const adminId: string = adminResult.rows[0].id

  const teacherResult = await pool.query(
    `INSERT INTO users (email, password, role, name)
     VALUES ($1, $2, $3, $4)
     ON CONFLICT (email) DO UPDATE SET name = EXCLUDED.name
     RETURNING id`,
    ['teacher@chatbridge.local', teacherHash, 'teacher', 'Ms. Johnson'],
  )
  const teacherId: string = teacherResult.rows[0].id

  const studentResult = await pool.query(
    `INSERT INTO users (email, password, role, name)
     VALUES ($1, $2, $3, $4)
     ON CONFLICT (email) DO UPDATE SET name = EXCLUDED.name
     RETURNING id`,
    ['student@chatbridge.local', studentHash, 'student', 'Alex Rivera'],
  )
  const studentId: string = studentResult.rows[0].id

  console.info('  Users: admin, teacher, student')

  // --- Apps ---
  // Load manifests from apps/ directory
  const baseUrl = process.env.APP_BASE_URL ?? ''

  let chessManifest: Record<string, unknown>
  let wordleManifest: Record<string, unknown>
  let quizManifest: Record<string, unknown>
  let githubManifest: Record<string, unknown>
  let googleQuizManifest: Record<string, unknown>
  try {
    chessManifest = JSON.parse(readFileSync(resolve(__dirname, '../../../apps/chess/manifest.json'), 'utf-8')) as Record<string, unknown>
    wordleManifest = JSON.parse(readFileSync(resolve(__dirname, '../../../apps/wordle/manifest.json'), 'utf-8')) as Record<string, unknown>
    quizManifest = JSON.parse(readFileSync(resolve(__dirname, '../../../apps/quiz/manifest.json'), 'utf-8')) as Record<string, unknown>
    githubManifest = JSON.parse(readFileSync(resolve(__dirname, '../../../apps/github/manifest.json'), 'utf-8')) as Record<string, unknown>
    googleQuizManifest = JSON.parse(readFileSync(resolve(__dirname, '../../../apps/google-quiz/manifest.json'), 'utf-8')) as Record<string, unknown>
  } catch {
    console.warn('  Could not load app manifests from apps/ directory, using inline defaults')
    chessManifest = { slug: 'chess', name: 'Chess', description: 'Chess game', trustTier: 'internal', entryUrl: 'http://localhost:3200', tools: [{ name: 'start_game', description: 'Start game', parameters: {}, rendersUi: true }], permissions: ['ui:render'] }
    wordleManifest = { slug: 'wordle', name: 'Wordle', description: 'Word guessing game', trustTier: 'external_public', entryUrl: 'http://localhost:3201', tools: [{ name: 'start_game', description: 'Start game', parameters: {}, rendersUi: true }], permissions: ['ui:render', 'api:proxy'] }
    quizManifest = { slug: 'quiz', name: 'Vocabulary Quiz', description: 'Vocabulary quiz with flashcards', trustTier: 'internal', entryUrl: 'http://localhost:3202', tools: [{ name: 'start_quiz', description: 'Start quiz', parameters: {}, rendersUi: true }], permissions: ['ui:render'] }
    githubManifest = { slug: 'github', name: 'GitHub Profile', description: 'GitHub profile viewer', trustTier: 'external_auth', entryUrl: 'http://localhost:3205', tools: [{ name: 'authorize_github', description: 'Connect GitHub', parameters: {}, rendersUi: true }], permissions: ['ui:render', 'api:proxy'] }
    googleQuizManifest = { slug: 'google-quiz', name: 'Vocab Quiz (Google Sheets)', description: 'Quiz from Google Sheets', trustTier: 'external_auth', entryUrl: 'http://localhost:3205', tools: [{ name: 'authorize_google', description: 'Connect Google', parameters: {}, rendersUi: true }], permissions: ['ui:render', 'api:proxy'] }
  }

  // In production, rewrite entryUrl to use the public base URL
  if (baseUrl) {
    chessManifest.entryUrl = `${baseUrl}/apps/chess/`
    wordleManifest.entryUrl = `${baseUrl}/apps/wordle/`
    quizManifest.entryUrl = `${baseUrl}/apps/quiz/`
    githubManifest.entryUrl = `${baseUrl}/apps/github/`
    googleQuizManifest.entryUrl = `${baseUrl}/apps/google-quiz/`
    console.info(`  App URLs rewritten to ${baseUrl}/apps/...`)
  }

  const chessResult = await pool.query(
    `INSERT INTO apps (slug, manifest, status, trust_tier, created_by, approved_by)
     VALUES ($1, $2, 'approved', $3, $4, $4)
     ON CONFLICT (slug) DO UPDATE SET manifest = EXCLUDED.manifest, status = 'approved'
     RETURNING id`,
    ['chess', JSON.stringify(chessManifest), 'internal', adminId],
  )
  const chessId: string = chessResult.rows[0].id

  const wordleResult = await pool.query(
    `INSERT INTO apps (slug, manifest, status, trust_tier, created_by, approved_by)
     VALUES ($1, $2, 'approved', $3, $4, $4)
     ON CONFLICT (slug) DO UPDATE SET manifest = EXCLUDED.manifest, status = 'approved'
     RETURNING id`,
    ['wordle', JSON.stringify(wordleManifest), 'external_public', adminId],
  )
  const wordleId: string = wordleResult.rows[0].id

  const quizResult = await pool.query(
    `INSERT INTO apps (slug, manifest, status, trust_tier, created_by, approved_by)
     VALUES ($1, $2, 'approved', $3, $4, $4)
     ON CONFLICT (slug) DO UPDATE SET manifest = EXCLUDED.manifest, status = 'approved'
     RETURNING id`,
    ['quiz', JSON.stringify(quizManifest), 'internal', adminId],
  )
  const quizId: string = quizResult.rows[0].id

  const githubResult = await pool.query(
    `INSERT INTO apps (slug, manifest, status, trust_tier, created_by, approved_by)
     VALUES ($1, $2, 'approved', $3, $4, $4)
     ON CONFLICT (slug) DO UPDATE SET manifest = EXCLUDED.manifest, status = 'approved', trust_tier = EXCLUDED.trust_tier
     RETURNING id`,
    ['github', JSON.stringify(githubManifest), 'external_auth', adminId],
  )
  const githubId: string = githubResult.rows[0].id

  const googleQuizResult = await pool.query(
    `INSERT INTO apps (slug, manifest, status, trust_tier, created_by, approved_by)
     VALUES ($1, $2, 'approved', $3, $4, $4)
     ON CONFLICT (slug) DO UPDATE SET manifest = EXCLUDED.manifest, status = 'approved', trust_tier = EXCLUDED.trust_tier
     RETURNING id`,
    ['google-quiz', JSON.stringify(googleQuizManifest), 'external_auth', adminId],
  )
  const googleQuizId: string = googleQuizResult.rows[0].id

  console.info('  Apps: chess (internal), wordle (external_public), quiz (internal), github (external_auth), google-quiz (external_auth)')

  // --- App Installations ---
  const installPairs = [
    [chessId, adminId], [chessId, teacherId], [chessId, studentId],
    [wordleId, adminId], [wordleId, teacherId], [wordleId, studentId],
    [quizId, adminId], [quizId, teacherId], [quizId, studentId],
    [githubId, adminId], [githubId, teacherId], [githubId, studentId],
    [googleQuizId, adminId], [googleQuizId, teacherId], [googleQuizId, studentId],
  ]
  for (const [appId, userId] of installPairs) {
    await pool.query(
      `INSERT INTO app_installations (app_id, user_id, enabled)
       VALUES ($1, $2, true)
       ON CONFLICT (app_id, user_id) DO UPDATE SET enabled = true`,
      [appId, userId],
    )
  }
  console.info('  Installations: chess, wordle, quiz, github for all users')

  // --- Sample Conversation ---
  const convResult = await pool.query(
    `INSERT INTO conversations (user_id, title)
     VALUES ($1, 'Welcome Chat')
     RETURNING id`,
    [studentId],
  )
  const convId: string = convResult.rows[0].id

  await pool.query(
    `INSERT INTO messages (conversation_id, role, content)
     VALUES ($1, 'user', $2)`,
    [convId, JSON.stringify([{ type: 'text', text: 'Hi! Can we play chess?' }])],
  )
  await pool.query(
    `INSERT INTO messages (conversation_id, role, content, model)
     VALUES ($1, 'assistant', $2, 'gpt-4o-mini')`,
    [convId, JSON.stringify([{ type: 'text', text: "Sure! I'd love to play chess with you. Let me start a game." }])],
  )
  console.info('  Conversation: sample welcome chat for student')

  // --- Content Filter Log (sample entries for dashboard demo) ---
  const filterEntries = [
    {
      userId: studentId, convId,
      content: 'this is so damn hard', matchedWords: ['damn'],
      severity: 'low', source: 'user_input', action: 'redacted',
    },
    {
      userId: studentId, convId,
      content: 'what the hell is going on', matchedWords: ['hell'],
      severity: 'low', source: 'user_input', action: 'redacted',
    },
    {
      userId: null, convId,
      content: 'The assistant generated inappropriate language', matchedWords: ['shit'],
      severity: 'medium', source: 'llm_output', action: 'redacted',
    },
    {
      userId: studentId, convId: null,
      content: 'I hate my life and want to die', matchedWords: ['want to die'],
      severity: 'critical', source: 'user_input', action: 'logged',
    },
    {
      userId: null, convId,
      content: 'Tool returned content with profanity', matchedWords: ['crap'],
      severity: 'low', source: 'tool_result', action: 'redacted',
    },
  ]

  for (const entry of filterEntries) {
    await pool.query(
      `INSERT INTO content_filter_log (user_id, conversation_id, content, matched_words, severity, source, action_taken)
       VALUES ($1, $2, $3, $4, $5, $6, $7)`,
      [
        entry.userId, entry.convId, entry.content,
        entry.matchedWords, entry.severity, entry.source, entry.action,
      ],
    )
  }
  console.info('  Filter log: 5 sample entries (low, medium, critical)')

  console.info('\nSeed complete!')
  console.info('  Admin:   admin@chatbridge.local / admin123')
  console.info('  Teacher: teacher@chatbridge.local / teacher123')
  console.info('  Student: student@chatbridge.local / student123')

  await pool.end()
}

seed().catch((err: unknown) => {
  console.error('Seed failed:', err)
  process.exit(1)
})
