const TOKEN_KEY = 'hotel_dashboard_token'

export function getToken() {
  return localStorage.getItem(TOKEN_KEY)
}

export function setToken(token) {
  if (token) localStorage.setItem(TOKEN_KEY, token)
  else localStorage.removeItem(TOKEN_KEY)
}

export class ApiError extends Error {
  constructor(message, status) {
    super(message)
    this.status = status
  }
}

async function request(
  path,
  { method = 'GET', body, params, isForm = false, isLogin = false } = {}
) {
  const url = new URL(path, window.location.origin)
  if (params) {
    Object.entries(params).forEach(([key, value]) => {
      if (value !== undefined && value !== null && value !== '') {
        url.searchParams.set(key, value)
      }
    })
  }

  const headers = {}
  const token = getToken()
  if (token) headers.Authorization = `Bearer ${token}`
  if (body && !isForm) headers['Content-Type'] = 'application/json'

  const res = await fetch(url, {
    method,
    headers,
    body: isForm ? body : body ? JSON.stringify(body) : undefined,
  })

  // A 401 on the sign-in call means bad credentials, not a lapsed session — let
  // it fall through so the server's own message reaches the form.
  if (res.status === 401 && !isLogin) {
    setToken(null)
    // Let the auth layer redirect rather than throwing a raw 401 at the caller.
    window.dispatchEvent(new CustomEvent('auth:expired'))
    throw new ApiError('Your session has expired. Please sign in again.', 401)
  }

  if (!res.ok) {
    let detail = `Request failed (${res.status})`
    try {
      const data = await res.json()
      if (typeof data.detail === 'string') detail = data.detail
      else if (Array.isArray(data.detail)) {
        detail = data.detail.map((d) => d.msg || JSON.stringify(d)).join('; ')
      }
    } catch {
      /* keep the generic message */
    }
    throw new ApiError(detail, res.status)
  }

  if (res.status === 204) return null
  return res.json()
}

export const api = {
  login: (email, password) =>
    request('/api/auth/login', {
      method: 'POST',
      body: { email, password },
      isLogin: true,
    }),
  me: () => request('/api/auth/me'),
  changePassword: (current_password, new_password) =>
    request('/api/auth/change-password', {
      method: 'POST',
      body: { current_password, new_password },
    }),
  listUsers: () => request('/api/auth/users'),
  createUser: (payload) => request('/api/auth/users', { method: 'POST', body: payload }),
  deactivateUser: (id) => request(`/api/auth/users/${id}`, { method: 'DELETE' }),

  hotels: (params) => request('/api/hotels', { params }),
  createHotel: (payload) => request('/api/hotels', { method: 'POST', body: payload }),
  updateHotel: (id, payload) =>
    request(`/api/hotels/${id}`, { method: 'PATCH', body: payload }),
  hotelUsage: (id) => request(`/api/hotels/${id}/usage`),
  deleteHotel: (id, cascade = false) =>
    request(`/api/hotels/${id}`, { method: 'DELETE', params: { cascade } }),

  periods: () => request('/api/dashboard/periods'),
  dashboard: (params) => request('/api/dashboard', { params }),
  trend: (params) => request('/api/dashboard/trend', { params }),
  growth: (params) => request('/api/dashboard/growth', { params }),

  upload: (formData) => request('/api/uploads', { method: 'POST', body: formData, isForm: true }),
  commitUpload: (id) => request(`/api/uploads/${id}/commit`, { method: 'POST' }),
  discardUpload: (id) => request(`/api/uploads/${id}`, { method: 'DELETE' }),
  uploads: (params) => request('/api/uploads', { params }),
  coverage: (params) => request('/api/uploads/coverage', { params }),

  /**
   * Download a stored workbook.
   *
   * The endpoint needs the bearer token, so a plain link will not do — fetch the
   * bytes, then hand the browser a temporary object URL to save.
   */
  async downloadUpload(id, filename) {
    const res = await fetch(`/api/uploads/${id}/download`, {
      headers: { Authorization: `Bearer ${getToken()}` },
    })
    if (!res.ok) {
      let detail = `Download failed (${res.status})`
      try {
        const data = await res.json()
        if (typeof data.detail === 'string') detail = data.detail
      } catch {
        /* keep the generic message */
      }
      throw new ApiError(detail, res.status)
    }
    const blob = await res.blob()
    const url = URL.createObjectURL(blob)
    const link = document.createElement('a')
    link.href = url
    link.download = filename || 'workbook.xlsx'
    document.body.appendChild(link)
    link.click()
    link.remove()
    URL.revokeObjectURL(url)
  },
}
