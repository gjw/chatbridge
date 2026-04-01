import bcrypt from 'bcryptjs'
import { pool } from './pool.js'

async function seed(): Promise<void> {
  const hash = await bcrypt.hash('admin123', 10)

  await pool.query(
    `INSERT INTO users (email, password, role, name)
     VALUES ($1, $2, $3, $4)
     ON CONFLICT (email) DO NOTHING`,
    ['admin@chatbridge.local', hash, 'admin', 'Default Admin'],
  )

  console.info('Seed complete: default admin user created')
  await pool.end()
}

seed().catch((err: unknown) => {
  console.error('Seed failed:', err)
  process.exit(1)
})
