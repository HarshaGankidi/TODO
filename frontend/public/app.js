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

let db
let currentUser = null
let authMode = 'login'
const SUPABASE_URL = window.SUPABASE_URL || ''
const SUPABASE_ANON_KEY = window.SUPABASE_ANON_KEY || ''
let sb = null
let storageMode = 'indexeddb'
if (SUPABASE_URL && SUPABASE_ANON_KEY && window.supabase) {
  sb = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY)
  storageMode = 'supabase'
}

async function hashPassword(pwd) {
  const enc = new TextEncoder().encode(pwd)
  const buf = await crypto.subtle.digest('SHA-256', enc)
  const arr = Array.from(new Uint8Array(buf))
  return arr.map(b => b.toString(16).padStart(2, '0')).join('')
}

function openDB() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open('todo-db', 2)
    req.onupgradeneeded = () => {
      const d = req.result
      if (!d.objectStoreNames.contains('todos')) {
        d.createObjectStore('todos', { keyPath: 'id', autoIncrement: true })
      }
      if (!d.objectStoreNames.contains('users')) {
        const us = d.createObjectStore('users', { keyPath: 'id', autoIncrement: true })
        us.createIndex('email', 'email', { unique: true })
      }
    }
    req.onsuccess = () => resolve(req.result)
    req.onerror = () => reject(req.error)
  })
}

function getStore(name, mode = 'readonly') {
  const tx = db.transaction(name, mode)
  return tx.objectStore(name)
}

function getAllTodos() {
  if (storageMode === 'supabase') {
    return sb.from('todos').select('*').eq('user_id', currentUser.id).order('created_at', { ascending: false }).then(({ data, error }) => {
      if (error) throw error
      return data.map(r => ({ id: r.id, title: r.title, completed: !!r.completed, created_at: r.created_at }))
    })
  }
  return new Promise((resolve, reject) => {
    const store = getStore('todos', 'readonly')
    const req = store.getAll()
    req.onsuccess = () => {
      const rows = req.result.filter(t => currentUser && t.userId === currentUser.id)
      const todos = rows.sort((a, b) => b.id - a.id)
      resolve(todos)
    }
    req.onerror = () => reject(req.error)
  })
}

function addTodoToDB(title) {
  if (storageMode === 'supabase') {
    const created_at = new Date().toISOString()
    return sb.from('todos').insert({ title, completed: false, created_at, user_id: currentUser.id }).select().single().then(({ data, error }) => {
      if (error) throw error
      return { id: data.id, title: data.title, completed: !!data.completed, created_at: data.created_at }
    })
  }
  return new Promise((resolve, reject) => {
    const store = getStore('todos', 'readwrite')
    const created_at = new Date().toISOString()
    const req = store.add({ title, completed: false, created_at, userId: currentUser.id })
    req.onsuccess = () => {
      const id = req.result
      resolve({ id, title, completed: false, created_at })
    }
    req.onerror = () => reject(req.error)
  })
}

function deleteTodoFromDB(id) {
  if (storageMode === 'supabase') {
    return sb.from('todos').delete().eq('id', id).then(({ error }) => {
      if (error) throw error
      return true
    })
  }
  return new Promise((resolve, reject) => {
    const store = getStore('todos', 'readwrite')
    const req = store.delete(id)
    req.onsuccess = () => resolve(true)
    req.onerror = () => reject(req.error)
  })
}

function findUserByEmail(email) {
  return new Promise((resolve, reject) => {
    const store = getStore('users', 'readonly')
    let idx
    try {
      idx = store.index('email')
    } catch (e) {
      resolve(null)
      return
    }
    const req = idx.get(email)
    req.onsuccess = () => resolve(req.result || null)
    req.onerror = () => reject(req.error)
  })
}

async function register(email, password) {
  if (storageMode === 'supabase') {
    const { data, error } = await sb.auth.signUp({ email, password })
    if (error) throw error
    const user = data.user
    return { id: user.id, email: user.email }
  }
  const existing = await findUserByEmail(email.toLowerCase())
  if (existing) throw new Error('exists')
  const hash = await hashPassword(password)
  return new Promise((resolve, reject) => {
    const store = getStore('users', 'readwrite')
    const created_at = new Date().toISOString()
    const req = store.add({ email: email.toLowerCase(), passwordHash: hash, created_at })
    req.onsuccess = () => resolve({ id: req.result, email: email.toLowerCase() })
    req.onerror = () => reject(req.error)
  })
}

async function login(email, password) {
  if (storageMode === 'supabase') {
    const { data, error } = await sb.auth.signInWithPassword({ email, password })
    if (error) throw error
    const user = data.user
    setCurrentUser({ id: user.id, email: user.email })
    return
  }
  const user = await findUserByEmail(email.toLowerCase())
  if (!user) throw new Error('invalid')
  const hash = await hashPassword(password)
  if (user.passwordHash !== hash) throw new Error('invalid')
  setCurrentUser({ id: user.id, email: user.email })
}

function setCurrentUser(u) {
  currentUser = u
  localStorage.setItem('currentUser', JSON.stringify(u))
  updateAuthUI()
  loadTodosForCurrentUser()
}

function getStoredUser() {
  try {
    const s = localStorage.getItem('currentUser')
    return s ? JSON.parse(s) : null
  } catch {
    return null
  }
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
      await deleteTodoFromDB(t.id)
      const el = listEl.querySelector(`li[data-id="${t.id}"]`)
      if (el) el.remove()
    })
    li.appendChild(span)
    li.appendChild(btn)
    listEl.appendChild(li)
  }
}

async function addTodo(title) {
  const created = await addTodoToDB(title)
  const li = document.createElement('li')
  li.dataset.id = String(created.id)
  const span = document.createElement('span')
  span.textContent = created.title
  const btn = document.createElement('button')
  btn.textContent = 'Delete'
  btn.addEventListener('click', async () => {
    await deleteTodoFromDB(created.id)
    const el = listEl.querySelector(`li[data-id="${created.id}"]`)
    if (el) el.remove()
  })
  li.appendChild(span)
  li.appendChild(btn)
  listEl.insertBefore(li, listEl.firstChild)
}

async function loadTodosForCurrentUser() {
  const todos = await getAllTodos()
  renderTodos(todos)
}

formEl.addEventListener('submit', async e => {
  e.preventDefault()
  const title = inputEl.value.trim()
  if (!title || !currentUser) return
  await addTodo(title)
  inputEl.value = ''
  inputEl.focus()
})

registerFormEl.addEventListener('submit', async e => {
  e.preventDefault()
  const email = registerEmailEl.value.trim()
  const pwd = registerPasswordEl.value
  if (!email || !pwd) {
    authErrorEl.textContent = 'Email and password required'
    return
  }
  try {
    const u = await register(email, pwd)
    setCurrentUser(u)
  } catch {
    authErrorEl.textContent = 'Email already registered'
  }
})

loginFormEl.addEventListener('submit', async e => {
  e.preventDefault()
  const email = loginEmailEl.value.trim()
  const pwd = loginPasswordEl.value
  if (!email || !pwd) {
    authErrorEl.textContent = 'Email and password required'
    return
  }
  try {
    await login(email, pwd)
  } catch {
    authErrorEl.textContent = 'Invalid credentials'
  }
})

logoutBtn.addEventListener('click', async () => {
  localStorage.removeItem('currentUser')
  if (storageMode === 'supabase') {
    await sb.auth.signOut()
  }
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

if (storageMode === 'supabase') {
  sb.auth.getUser().then(({ data }) => {
    const user = data && data.user
    if (user) {
      currentUser = { id: user.id, email: user.email }
      localStorage.setItem('currentUser', JSON.stringify(currentUser))
    }
    updateAuthUI()
    if (currentUser) {
      loadTodosForCurrentUser()
    }
  })
} else {
  openDB().then(async d => {
    db = d
    const stored = getStoredUser()
    if (stored) {
      currentUser = stored
    }
    updateAuthUI()
    if (currentUser) {
      await loadTodosForCurrentUser()
    }
  })
}
