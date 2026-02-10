const listEl = document.getElementById('todo-list')
const formEl = document.getElementById('todo-form')
const inputEl = document.getElementById('todo-input')
const authStatusEl = document.getElementById('auth-status')
const userEmailEl = document.getElementById('user-email')
const logoutBtn = document.getElementById('logout-btn')
const registerFormEl = document.getElementById('register-form')
const registerEmailEl = document.getElementById('register-email')
const registerPasswordEl = document.getElementById('register-password')
const loginFormEl = document.getElementById('login-form')
const loginEmailEl = document.getElementById('login-email')
const loginPasswordEl = document.getElementById('login-password')
const authErrorEl = document.getElementById('auth-error')
const todoSectionEl = document.getElementById('todo-section')
const showRegisterBtn = document.getElementById('show-register-btn')
const showLoginBtn = document.getElementById('show-login-btn')
const authTitleEl = document.getElementById('auth-title')

let API_BASE = 'http://localhost:3000'
let currentUser = null
let authMode = 'login'

function setCurrentUser(u, token) {
  currentUser = u
  localStorage.setItem('currentUser', JSON.stringify(u))
  if (token) localStorage.setItem('token', token)
  updateAuthUI()
  loadTodosForCurrentUser()
}

function getToken() {
  return localStorage.getItem('token') || ''
}

async function fetchJSON(url, options = {}) {
  const headers = options.headers || {}
  const token = getToken()
  if (token) headers['Authorization'] = `Bearer ${token}`
  headers['Content-Type'] = 'application/json'
  const res = await fetch(url, { ...options, headers })
  const data = await res.json().catch(() => null)
  if (!res.ok) throw new Error((data && data.error) || 'request_failed')
  return data
}

function updateAuthUI() {
  const logged = !!currentUser
  if (logged) {
    authStatusEl.classList.remove('hidden')
    userEmailEl.textContent = currentUser.email
    registerFormEl.classList.add('hidden')
    loginFormEl.classList.add('hidden')
    todoSectionEl.classList.remove('hidden')
  } else {
    authStatusEl.classList.add('hidden')
    userEmailEl.textContent = ''
    if (authMode === 'login') {
      authTitleEl.textContent = 'Login'
      loginFormEl.classList.remove('hidden')
      registerFormEl.classList.add('hidden')
    } else {
      authTitleEl.textContent = 'Create account'
      registerFormEl.classList.remove('hidden')
      loginFormEl.classList.add('hidden')
    }
    todoSectionEl.classList.add('hidden')
  }
  authErrorEl.textContent = ''
}

function renderTodos(todos) {
  listEl.innerHTML = ''
  for (const t of todos) {
    const li = document.createElement('li')
    li.dataset.id = String(t.id)
    const span = document.createElement('span')
    span.textContent = t.title
    const btn = document.createElement('button')
    btn.textContent = 'Delete'
    btn.addEventListener('click', async () => {
      try {
        await fetchJSON(`${API_BASE}/api/todos/${t.id}`, { method: 'DELETE' })
        const el = listEl.querySelector(`li[data-id="${t.id}"]`)
        if (el) el.remove()
      } catch {}
    })
    li.appendChild(span)
    li.appendChild(btn)
    listEl.appendChild(li)
  }
}

async function loadTodosForCurrentUser() {
  try {
    const todos = await fetchJSON(`${API_BASE}/api/todos`)
    renderTodos(todos)
  } catch (err) {
    authErrorEl.textContent = 'Cannot reach server'
  }
}

formEl.addEventListener('submit', async e => {
  e.preventDefault()
  const title = inputEl.value.trim()
  if (!title || !currentUser) return
  try {
    const created = await fetchJSON(`${API_BASE}/api/todos`, { method: 'POST', body: JSON.stringify({ title }) })
    const li = document.createElement('li')
    li.dataset.id = String(created.id)
    const span = document.createElement('span')
    span.textContent = created.title
    const btn = document.createElement('button')
    btn.textContent = 'Delete'
    btn.addEventListener('click', async () => {
      try {
        await fetchJSON(`${API_BASE}/api/todos/${created.id}`, { method: 'DELETE' })
        const el = listEl.querySelector(`li[data-id="${created.id}"]`)
        if (el) el.remove()
      } catch {}
    })
    li.appendChild(span)
    li.appendChild(btn)
    listEl.insertBefore(li, listEl.firstChild)
    inputEl.value = ''
    inputEl.focus()
  } catch (err) {
    authErrorEl.textContent = 'Cannot reach server'
  }
})

registerFormEl.addEventListener('submit', async e => {
  e.preventDefault()
  const email = registerEmailEl.value.trim()
  const password = registerPasswordEl.value
  if (!email || !password) {
    authErrorEl.textContent = 'Email and password required'
    return
  }
  try {
    const data = await fetchJSON(`${API_BASE}/api/auth/register`, { method: 'POST', body: JSON.stringify({ email, password }) })
    setCurrentUser(data.user, data.token)
  } catch (err) {
    authErrorEl.textContent = 'Email already registered'
  }
})

loginFormEl.addEventListener('submit', async e => {
  e.preventDefault()
  const email = loginEmailEl.value.trim()
  const password = loginPasswordEl.value
  if (!email || !password) {
    authErrorEl.textContent = 'Email and password required'
    return
  }
  try {
    const data = await fetchJSON(`${API_BASE}/api/auth/login`, { method: 'POST', body: JSON.stringify({ email, password }) })
    setCurrentUser(data.user, data.token)
  } catch {
    authErrorEl.textContent = 'Invalid credentials'
  }
})

logoutBtn.addEventListener('click', async () => {
  localStorage.removeItem('currentUser')
  localStorage.removeItem('token')
  currentUser = null
  updateAuthUI()
  listEl.innerHTML = ''
})

showRegisterBtn.addEventListener('click', () => {
  authMode = 'register'
  updateAuthUI()
})
showLoginBtn.addEventListener('click', () => {
  authMode = 'login'
  updateAuthUI()
})

async function loadEnv() {
  try {
    const res = await fetch('./.env', { cache: 'no-store' })
    if (res.ok) {
      const txt = await res.text()
      const m = txt.match(/BACKEND_URL\s*=\s*(.+)/)
      if (m && m[1]) {
        API_BASE = m[1].trim()
      }
      return
    }
  } catch {}
  try {
    const resJson = await fetch('./env.json', { cache: 'no-store' })
    if (resJson.ok) {
      const cfg = await resJson.json().catch(() => null)
      if (cfg && typeof cfg.BACKEND_URL === 'string' && cfg.BACKEND_URL) {
        API_BASE = cfg.BACKEND_URL.trim()
      }
    }
  } catch {}
}

;(async () => {
  await loadEnv()
  try {
    const storedUser = localStorage.getItem('currentUser')
    if (storedUser) {
      currentUser = JSON.parse(storedUser)
    }
  } catch {}
  updateAuthUI()
  if (currentUser) {
    loadTodosForCurrentUser()
  }
})()
