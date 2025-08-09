// --- Authentication and Synchronization Logic ---

const API_BASE_URL = 'https://bookmarker-api.aiwetalk.com/api';

// --- API Communication Functions ---
async function apiLogin(email, password) {
    const response = await fetch(`${API_BASE_URL}/auth/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, password })
    });
    if (!response.ok) {
        const err = await response.json();
        throw new Error(err.error || 'Login failed');
    }
    return response.json();
}

async function apiRegister(email, password) {
    const response = await fetch(`${API_BASE_URL}/auth/register`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, password })
    });
    if (!response.ok) {
        const err = await response.json();
        throw new Error(err.error || 'Registration failed');
    }
    return response.json();
}

async function apiGoogleLogin(googleCode) {
    const response = await fetch(`${API_BASE_URL}/auth/oauth/google`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ code: googleCode })
    });
    if (!response.ok) {
        const err = await response.json();
        throw new Error(err.error || 'Google login failed');
    }
    return response.json();
}

// --- Authentication Event Handlers & UI ---
document.addEventListener('DOMContentLoaded', () => {
    const showLoginModalBtn = document.getElementById('showLoginModalBtn');
    const loginModal = document.getElementById('loginModal');
    const closeLoginModalBtn = document.getElementById('closeLoginModalBtn');
    const primaryLoginBtn = document.querySelector('.primary-login-btn');
    const googleLoginBtn = document.querySelector('.social-login-btn[data-provider="google"]');
    const logoutBtn = document.getElementById('logoutBtn');

    updateUIForAuthState();

    showLoginModalBtn?.addEventListener('click', () => {
        loginModal.classList.remove('hidden');
    });

    closeLoginModalBtn?.addEventListener('click', () => {
        loginModal.classList.add('hidden');
    });

    primaryLoginBtn?.addEventListener('click', handleEmailAuth);
    googleLoginBtn?.addEventListener('click', handleGoogleLogin);
    logoutBtn?.addEventListener('click', handleLogout);
});

async function handleEmailAuth(event) {
    event.preventDefault();
    const email = document.getElementById('emailInput').value;
    const password = document.getElementById('passwordInput').value;
    if (!email || !password) {
        alert('Please enter both email and password.');
        return;
    }

    try {
        const authData = await apiLogin(email, password);
        await onLoginSuccess(authData);
    } catch (loginError) {
        if (confirm(`Login failed: ${loginError.message}. Do you want to try registering a new account with this email?`)) {
            try {
                await apiRegister(email, password);
                alert('Registration successful! You can now log in with your new account.');
            } catch (registerError) {
                alert(`Registration failed: ${registerError.message}`);
            }
        }
    }
}

async function handleGoogleLogin() {
    try {
        const manifest = chrome.runtime.getManifest();
        const clientId = manifest.oauth2?.client_id;
        const scopes = manifest.oauth2?.scopes;

        if (!clientId || !scopes) {
             throw new Error("OAuth2 configuration is missing in manifest.json. Please contact the developer.");
        }
       
        const redirectUri = chrome.identity.getRedirectURL();
        const authUrl = new URL('https://accounts.google.com/o/oauth2/v2/auth');
        authUrl.searchParams.append('client_id', clientId);
        authUrl.searchParams.append('response_type', 'code');
        authUrl.searchParams.append('redirect_uri', redirectUri);
        authUrl.searchParams.append('scope', scopes.join(' '));
        authUrl.searchParams.append('access_type', 'offline');

        const finalUrl = await chrome.identity.launchWebAuthFlow({
            url: authUrl.href,
            interactive: true
        });

        const code = new URL(finalUrl).searchParams.get('code');
        if (code) {
            const authData = await apiGoogleLogin(code);
            await onLoginSuccess(authData);
        } else {
            throw new Error('Authorization code not found in Google response.');
        }
    } catch (error) {
        console.error("Google Login Error:", error);
        alert(`Google login failed: ${error.message}`);
    }
}

/*
async function onLoginSuccess(authData) {
    await chrome.storage.local.set({ authData: { token: authData.token, userId: authData.userId } });
    
    const loginModal = document.getElementById('loginModal');
    if(loginModal) loginModal.classList.add('hidden');
    
    await updateUIForAuthState();
    
    // Show toast before sync
    const toast = document.createElement('div');
    toast.textContent = '登录成功！正在同步您的书签...';
    Object.assign(toast.style, { position: 'fixed', bottom: '20px', left: '50%', transform: 'translateX(-50%)', background: '#4CAF50', color: 'white', padding: '10px 20px', borderRadius: '4px', zIndex: 1001 });
    document.body.appendChild(toast);

    try {
//        await chrome.runtime.sendMessage({ action: "fullSync" });
//        toast.textContent = '同步完成！';
        chrome.runtime.sendMessage({ action: 'initiateMergeSync' }, (response) => {
            if (response && response.status === 'success') {
                showToast("数据同步成功！");
                // 同步成功后，可以重新加载所有项目来刷新UI
                loadAllItems();
            } else {
                showToast(`同步失败: ${response.message}`, 3000, "#ea4335");
            }
        });

    } catch (e) {
        toast.textContent = '同步失败！请稍后重试。';
        toast.style.background = '#f44336';
    }
    
    setTimeout(() => toast.remove(), 3000);
}
*/
// In options_demo.js, you can now refactor onLoginSuccess
async function onLoginSuccess(authData) {
    await chrome.storage.local.set({ authData: { token: authData.token, userId: authData.userId } });
    
    const loginModal = document.getElementById('loginModal');
    if(loginModal) loginModal.classList.add('hidden');
    
    await updateUIForAuthState();
    
    // Use the helper function for the initial message
    showToast('登录成功！正在同步您的书签...', 3000, '#4CAF50');

    try {
        chrome.runtime.sendMessage({ action: 'initiateMergeSync' }, (response) => {
            if (response && response.status === 'success') {
                // This will now work correctly
                showToast("数据同步成功！");
                // Assuming loadAllItems() is defined elsewhere or you will add it.
                // loadAllItems(); 
            } else {
                // This will also work correctly
                showToast(`同步失败: ${response?.message || 'Unknown error'}`, 3000, "#ea4335");
            }
        });

    } catch (e) {
        showToast(`同步失败！请稍后重试: ${e.message}`, 3000, '#f44336');
    }
}

async function handleLogout() {
    await chrome.storage.local.remove('authData');
 //   await chrome.storage.local.set({ bookmarkItems: [] }); // Clear local data on logout
    await updateUIForAuthState();
    alert('您已成功退出。');
    location.reload(); // Refresh the page to clear state
}

async function updateUIForAuthState() {
    const { authData } = await chrome.storage.local.get('authData');
    const loggedOutView = document.getElementById('loggedOutView');
    const loggedInView = document.getElementById('loggedInView');
    const userEmailSpan = document.getElementById('userEmail');
    const userNameSpan = document.getElementById('userName');

    if (authData && authData.token) {
        loggedOutView.classList.add('hidden');
        loggedInView.classList.remove('hidden');

        // The API doesn't specify a user info endpoint, so we'll fake it for now.
        // In a real app, you would decode the JWT or call a /me endpoint.
        userNameSpan.textContent = "已认证用户";
        userEmailSpan.textContent = `用户ID: ${authData.userId.substring(0, 10)}...`;
    } else {
        loggedOutView.classList.remove('hidden');
        loggedInView.classList.add('hidden');
    }
}

/**
 * Displays a short-lived notification message at the bottom of the screen.
 * @param {string} message The text to display.
 * @param {number} [duration=2000] How long to display the message in milliseconds.
 * @param {string} [color="#4285f4"] The background color of the notification.
 */
function showToast(message, duration = 2000, color = "#4285f4") {
    const toast = document.createElement('div');
    toast.textContent = message;
    Object.assign(toast.style, {
        position: 'fixed',
        bottom: '20px',
        left: '50%',
        transform: 'translateX(-50%)',
        background: color,
        color: 'white',
        padding: '10px 20px',
        borderRadius: '5px',
        zIndex: 1001,
        boxShadow: '0 2px 10px rgba(0,0,0,0.2)',
        transition: 'opacity 0.5s, bottom 0.5s'
    });
    document.body.appendChild(toast);

    // Fade out animation before removing
    setTimeout(() => {
        toast.style.opacity = '0';
        toast.style.bottom = '0px';
        setTimeout(() => toast.remove(), 500);
    }, duration - 500);
}
