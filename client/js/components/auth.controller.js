document.addEventListener('DOMContentLoaded', () => {
  // Elements
  const tabLogin = document.getElementById('tab-login');
  const tabRegister = document.getElementById('tab-register');
  const formLogin = document.getElementById('form-login');
  const formRegister = document.getElementById('form-register');
  const alertBox = document.getElementById('auth-alert');

  // Check if already logged in
  if (window.apiService.getToken()) {
    window.apiService.get('/api/auth/me')
      .then((data) => {
        if (data.success) {
          showAlert('Already authenticated! Redirecting to dashboard...', 'success');
          setTimeout(() => {
            window.location.href = '/';
          }, 800);
        }
      })
      .catch(() => {
        window.apiService.clearSession();
      });
  }

  // Switch tabs
  const setTab = (tab) => {
    hideAlert();
    if (tab === 'login') {
      tabLogin.classList.add('active');
      tabRegister.classList.remove('active');
      formLogin.style.display = 'flex';
      formRegister.style.display = 'none';
    } else {
      tabRegister.classList.add('active');
      tabLogin.classList.remove('active');
      formRegister.style.display = 'flex';
      formLogin.style.display = 'none';
    }
  };

  tabLogin.addEventListener('click', () => setTab('login'));
  tabRegister.addEventListener('click', () => setTab('register'));

  const showAlert = (message, type = 'error') => {
    alertBox.textContent = message;
    alertBox.className = `auth-alert ${type}`;
    alertBox.style.display = 'flex';
  };

  const hideAlert = () => {
    alertBox.style.display = 'none';
    alertBox.textContent = '';
  };

  // Handle Login
  formLogin.addEventListener('submit', async (e) => {
    e.preventDefault();
    hideAlert();

    const email = document.getElementById('login-email').value.trim();
    const password = document.getElementById('login-password').value;
    const submitBtn = formLogin.querySelector('button[type="submit"]');

    if (!email || !password) {
      showAlert('Please enter both email and password.');
      return;
    }

    try {
      submitBtn.disabled = true;
      submitBtn.textContent = 'Logging in...';

      const res = await window.apiService.post('/api/auth/login', { email, password });

      if (res.success) {
        window.apiService.setToken(res.token);
        window.apiService.setCurrentUser(res.user);
        showAlert('Login successful! Redirecting...', 'success');
        setTimeout(() => {
          window.location.href = '/';
        }, 800);
      }
    } catch (err) {
      showAlert(err.message || 'Login failed');
    } finally {
      submitBtn.disabled = false;
      submitBtn.textContent = 'Sign In';
    }
  });

  // Handle Register
  formRegister.addEventListener('submit', async (e) => {
    e.preventDefault();
    hideAlert();

    const username = document.getElementById('reg-username').value.trim();
    const email = document.getElementById('reg-email').value.trim();
    const password = document.getElementById('reg-password').value;
    const bio = document.getElementById('reg-bio').value.trim();
    const submitBtn = formRegister.querySelector('button[type="submit"]');

    if (!username || !email || !password) {
      showAlert('Please complete all required fields.');
      return;
    }

    if (username.length < 3) {
      showAlert('Username must be at least 3 characters.');
      return;
    }

    if (password.length < 6) {
      showAlert('Password must be at least 6 characters.');
      return;
    }

    try {
      submitBtn.disabled = true;
      submitBtn.textContent = 'Creating account...';

      const res = await window.apiService.post('/api/auth/register', {
        username,
        email,
        password,
        bio: bio || undefined
      });

      if (res.success) {
        window.apiService.setToken(res.token);
        window.apiService.setCurrentUser(res.user);
        showAlert('Account created successfully! Redirecting...', 'success');
        setTimeout(() => {
          window.location.href = '/';
        }, 800);
      }
    } catch (err) {
      showAlert(err.message || 'Registration failed');
    } finally {
      submitBtn.disabled = false;
      submitBtn.textContent = 'Create Account';
    }
  });
});
