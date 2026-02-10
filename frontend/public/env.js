window.BACKEND_URL = (function() {
  try {
    return new URLSearchParams(location.search).get('backend') || undefined
  } catch {
    return undefined
  }
})() || undefined
