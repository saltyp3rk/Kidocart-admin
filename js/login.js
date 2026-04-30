// js/login.js

document.addEventListener('DOMContentLoaded', function () {
  // If already logged in, skip to dashboard
  if (isLoggedIn()) {
    window.location.href = '/pages/dashboard.html';
    return;
  }

  const form = document.getElementById('admin-login-form');
  const btn  = form.querySelector('button[type="submit"]');
  const errorBox = document.getElementById('login-error');

  form.addEventListener('submit', async function (e) {
    e.preventDefault();

    const username = document.getElementById('username').value.trim();
    const password = document.getElementById('password').value;

    if (!username || !password) return;

    btn.disabled = true;
    btn.innerHTML = '<span class="loading-spinner" style="width:16px;height:16px;border-width:2px;"></span> Logging in...';
    if (errorBox) errorBox.style.display = 'none';

    try {
      const res = await fetch('/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username, password }),
      });

      const data = await res.json();

      if (res.ok && data.token) {
        saveToken(data.token);
        window.location.href = '/pages/dashboard.html';
      } else {
        showError(data.error || 'Invalid credentials');
      }
    } catch (err) {
      showError('Connection error. Please try again.');
    } finally {
      btn.disabled = false;
      btn.innerHTML = '<i class="fas fa-sign-in-alt"></i> Login to Admin Panel';
    }
  });

  function showError(msg) {
    if (errorBox) {
      errorBox.textContent = msg;
      errorBox.style.display = 'block';
    } else {
      alert(msg);
    }
  }
});
