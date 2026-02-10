const express = require('express')
const cors = require('cors')
const { Pool } = require('pg')
const crypto = require('crypto')
const dotenv = require('dotenv')

dotenv.config({ path: require('path').join(__dirname, '.env') })

const DATABASE_URL = process.env.database_url
const JWT_SECRET = process.env.JWT_SECRET || 'change-me'

const pool = new Pool({ connectionString: DATABASE_URL, max: 5 })

async function migrate() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS users (
      id TEXT PRIMARY KEY,
      email TEXT UNIQUE NOT NULL,
      password_hash TEXT NOT NULL,
      password_salt TEXT NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );
  `)
  await pool.query(`
    CREATE TABLE IF NOT EXISTS todos (
      id BIGSERIAL PRIMARY KEY,
      user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      title TEXT NOT NULL,
      completed BOOLEAN NOT NULL DEFAULT FALSE,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );
  `)
}

function base64url(input) {
  return Buffer.from(input).toString('base64').replace(/=/g, '').replace(/\+/g, '-').replace(/\//g, '_')
}
function signJWT(payload, opts = {}) {
  const header = { alg: 'HS256', typ: 'JWT' }
  const exp = Math.floor(Date.now() / 1000) + (opts.expiresInSec || 7 * 24 * 60 * 60)
  const body = { ...payload, exp }
  const h = base64url(JSON.stringify(header))
  const p = base64url(JSON.stringify(body))
  const data = `${h}.${p}`
  const sig = crypto.createHmac('sha256', JWT_SECRET).update(data).digest('base64').replace(/=/g, '').replace(/\+/g, '-').replace(/\//g, '_')
  return `${data}.${sig}`
}
function verifyJWT(token) {
  try {
    const [h, p, s] = token.split('.')
    const data = `${h}.${p}`
    const expected = crypto.createHmac('sha256', JWT_SECRET).update(data).digest('base64').replace(/=/g, '').replace(/\+/g, '-').replace(/\//g, '_')
    if (expected !== s) return null
    const payload = JSON.parse(Buffer.from(p.replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString('utf8'))
    if (payload.exp && payload.exp < Math.floor(Date.now() / 1000)) return null
    return payload
  } catch {
    return null
  }
}

function hashPassword(password, salt) {
  const hash = crypto.pbkdf2Sync(password, salt, 100_000, 32, 'sha256')
  return hash.toString('hex')
}

const app = express()
const FRONTEND_URL = process.env.FRONTEND_URL
app.use(cors({ origin: FRONTEND_URL ? FRONTEND_URL : true, credentials: true }))
app.use(express.json())

app.get('/env.js', (req, res) => {
  const origin = `${req.protocol}://${req.get('host')}`
  res.type('application/javascript').send(`window.BACKEND_URL="${origin}";`)
})

app.get('/api/health', (req, res) => {
  res.json({ ok: true })
})

app.post('/api/auth/register', async (req, res) => {
  const emailRaw = req.body && req.body.email
  const password = req.body && req.body.password
  const email = typeof emailRaw === 'string' ? emailRaw.trim().toLowerCase() : ''
  if (!email || !password || password.length < 6) {
    return res.status(400).json({ error: 'invalid_input' })
  }
  try {
    const existing = await pool.query('SELECT id FROM users WHERE email = $1', [email])
    if (existing.rows.length) {
      return res.status(409).json({ error: 'email_exists' })
    }
    const id = crypto.randomUUID()
    const salt = crypto.randomBytes(16).toString('hex')
    const passwordHash = hashPassword(password, salt)
    await pool.query(
      'INSERT INTO users (id, email, password_hash, password_salt) VALUES ($1, $2, $3, $4)',
      [id, email, passwordHash, salt]
    )
    const token = signJWT({ sub: id, email })
    return res.status(201).json({ token, user: { id, email } })
  } catch (e) {
    return res.status(500).json({ error: 'server_error' })
  }
})

app.post('/api/auth/login', async (req, res) => {
  const emailRaw = req.body && req.body.email
  const password = req.body && req.body.password
  const email = typeof emailRaw === 'string' ? emailRaw.trim().toLowerCase() : ''
  if (!email || !password) {
    return res.status(400).json({ error: 'invalid_input' })
  }
  try {
    const result = await pool.query('SELECT id, password_hash, password_salt FROM users WHERE email = $1', [email])
    if (!result.rows.length) {
      return res.status(401).json({ error: 'invalid_credentials' })
    }
    const row = result.rows[0]
    const cmp = hashPassword(password, row.password_salt)
    if (cmp !== row.password_hash) {
      return res.status(401).json({ error: 'invalid_credentials' })
    }
    const token = signJWT({ sub: row.id, email })
    return res.json({ token, user: { id: row.id, email } })
  } catch (e) {
    return res.status(500).json({ error: 'server_error' })
  }
})

function requireAuth(req, res, next) {
  const hdr = req.headers['authorization'] || ''
  const m = hdr.match(/^Bearer (.+)$/i)
  if (!m) return res.status(401).json({ error: 'unauthorized' })
  const payload = verifyJWT(m[1])
  if (!payload || !payload.sub) return res.status(401).json({ error: 'unauthorized' })
  req.user = { id: payload.sub, email: payload.email }
  next()
}

app.get('/api/todos', requireAuth, async (req, res) => {
  try {
    const result = await pool.query(
      'SELECT id, title, completed, created_at FROM todos WHERE user_id = $1 ORDER BY created_at DESC',
      [req.user.id]
    )
    res.json(result.rows.map(r => ({ id: r.id, title: r.title, completed: !!r.completed, created_at: r.created_at })))
  } catch {
    res.status(500).json({ error: 'server_error' })
  }
})

app.post('/api/todos', requireAuth, async (req, res) => {
  const titleRaw = req.body && req.body.title
  const title = typeof titleRaw === 'string' ? titleRaw.trim() : ''
  if (!title) return res.status(400).json({ error: 'title_required' })
  try {
    const result = await pool.query(
      'INSERT INTO todos (user_id, title, completed) VALUES ($1, $2, FALSE) RETURNING id, title, completed, created_at',
      [req.user.id, title]
    )
    const r = result.rows[0]
    res.status(201).json({ id: r.id, title: r.title, completed: !!r.completed, created_at: r.created_at })
  } catch {
    res.status(500).json({ error: 'server_error' })
  }
})

app.delete('/api/todos/:id', requireAuth, async (req, res) => {
  const id = Number(req.params.id)
  if (!Number.isInteger(id) || id <= 0) return res.status(400).json({ error: 'invalid_id' })
  try {
    const result = await pool.query('DELETE FROM todos WHERE id = $1 AND user_id = $2', [id, req.user.id])
    if (result.rowCount === 0) return res.status(404).json({ error: 'not_found' })
    res.json({ deleted: true, id })
  } catch {
    res.status(500).json({ error: 'server_error' })
  }
})

const port = process.env.PORT ? Number(process.env.PORT) : 3000
migrate().then(() => {
  app.listen(port, () => {
    console.log(`Backend running on http://localhost:${port}`)
  })
}).catch(err => {
  console.error('Migration failed', err)
  process.exit(1)
})
