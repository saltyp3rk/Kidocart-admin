// js/auth.js — shared across all admin pages

const TOKEN_KEY = 'kidocart_admin_token';

// Get token from localStorage
function getToken() {
  return localStorage.getItem(TOKEN_KEY);
}

// Save token
function saveToken(token) {
  localStorage.setItem(TOKEN_KEY, token);
}

// Remove token (logout)
function clearToken() {
  localStorage.removeItem(TOKEN_KEY);
}

// Decode JWT payload (no verification — that happens server-side)
function decodeToken(token) {
  try {
    const payload = token.split('.')[1];
    return JSON.parse(atob(payload));
  } catch {
    return null;
  }
}

// Check if token exists and is not expired
function isLoggedIn() {
  const token = getToken();
  if (!token) return false;

  const decoded = decodeToken(token);
  if (!decoded) return false;

  // exp is in seconds, Date.now() is ms
  const isExpired = decoded.exp * 1000 < Date.now();
  if (isExpired) {
    clearToken();
    return false;
  }

  return true;
}

// Redirect to login if not authenticated
function requireAuth() {
  if (!isLoggedIn()) {
    window.location.href = '/pages/login.html';
    return false;
  }
  return true;
}

// Logout
function adminLogout() {
  clearToken();
  window.location.href = '/pages/login.html';
}

// Attach Authorization header to every fetch call automatically
function authFetch(url, options = {}) {
  const token = getToken();
  return fetch(url, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      ...(options.headers || {}),
      Authorization: `Bearer ${token}`,
    },
  });
}
