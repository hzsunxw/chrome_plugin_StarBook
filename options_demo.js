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
    await chrome.storage.local.set({ bookmarkItems: [] }); // Clear local data on logout
    await updateUIForAuthState();
    alert('您已成功退出。');
    location.reload(); // Refresh the page to clear state
}

async function updateUIForAuthState() {
    // --- 获取所有需要操作的UI元素 ---
    const loggedOutView = document.getElementById('loggedOutView');
    const loggedInView = document.getElementById('loggedInView');
    const userAvatarImg = document.getElementById('userAvatar'); // 新增：获取头像的<img>元素
    const userNameSpan = document.getElementById('userName');
    const userEmailSpan = document.getElementById('userEmail');
    
    // --- 从存储中获取登录信息 ---
    const { authData } = await chrome.storage.local.get('authData');

    if (authData && authData.token) {
        // --- 用户已登录 ---
        loggedOutView.classList.add('hidden');
        loggedInView.classList.remove('hidden');

        const userName = "已认证用户"; // 使用这个作为显示名称
        userNameSpan.textContent = userName;
        userEmailSpan.textContent = `用户ID: ${authData.userId.substring(0, 10)}...`;

        // --- 新增：生成并显示头像 ---
        if (userAvatarImg) {
            userAvatarImg.src = createAvatar({
                userId: authData.userId, // 使用userId确保每个用户的颜色固定
                text: userName.charAt(0) // 提取用户名的第一个字，即 "已"
            });
            userAvatarImg.style.borderRadius = '50%'; // 确保头像是圆形的
            userAvatarImg.style.display = 'block'; // 确保头像是可见的
        }

    } else {
        // --- 用户未登录 ---
        loggedOutView.classList.remove('hidden');
        loggedInView.classList.add('hidden');
    }
}
/*
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
*/
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

/**
 * 根据用户信息生成一个基于文本的头像
 * @param {object} options - 配置项
 * @param {string} options.userId - 用户ID，用于生成一个固定的背景颜色
 * @param {string} options.text - 显示在头像上的文字（例如，用户名的第一个字）
 * @param {number} [options.size=64] - 头像的尺寸（宽度和高度）
 * @returns {string} - 返回一个可用于 <img> src 的 Data URL
 */
function createAvatar({ userId, text, size = 64 }) {
    const canvas = document.createElement('canvas');
    const context = canvas.getContext('2d');
    canvas.width = size;
    canvas.height = size;

    // --- 1. 根据用户ID生成一个固定的、漂亮的背景颜色 ---
    let hash = 0;
    for (let i = 0; i < userId.length; i++) {
        hash = userId.charCodeAt(i) + ((hash << 5) - hash);
    }
    const h = hash % 360; // 色相 (0-360)
    // 使用 HSL 颜色模型，确保颜色既美观又不会太刺眼
    const backgroundColor = `hsl(${h}, 55%, 50%)`;

    // --- 2. 绘制背景 ---
    context.fillStyle = backgroundColor;
    context.fillRect(0, 0, size, size);

    // --- 3. 在背景上绘制文字 ---
    context.fillStyle = '#FFFFFF'; // 白色文字
    context.font = `bold ${size / 2}px Arial`; // 字体大小为头像尺寸的一半
    context.textAlign = 'center'; // 水平居中
    context.textBaseline = 'middle'; // 垂直居中
    context.fillText(text, size / 2, size / 2.1); // 微调垂直位置以获得更好的视觉效果

    // --- 4. 将绘制的图像转换为 URL ---
    return canvas.toDataURL();
}
