// --- Authentication and Synchronization Logic ---

const API_BASE_URL = 'https://bookmarker-api.aiwetalk.com/api';
let i18nManager;

// 微信登录回调处理
function handleWechatCallback(url) {
    console.log('收到微信登录回调:', url);

    try {
        const urlObj = new URL(url);
        const token = urlObj.searchParams.get('token');
        const userId = urlObj.searchParams.get('userId');
        const error = urlObj.searchParams.get('error');

        console.log('解析回调结果 - token:', token, 'userId:', userId, 'error:', error);

        if (error) {
            console.error('微信登录返回错误:', error);
            alert(`微信登录失败: ${decodeURIComponent(error)}`);
            return;
        }

        if (token && userId) {
            console.log('微信登录成功，准备保存认证数据');
            const authData = {
                token: `Bearer ${decodeURIComponent(token)}`,
                userId: decodeURIComponent(userId)
            };
            onLoginSuccess(authData);
        } else {
            console.error('Token或用户ID未在微信响应中找到');
            alert('微信登录失败：Token或用户ID未找到');
        }
    } catch (err) {
        console.error('处理微信回调时出错:', err);
        alert('处理微信登录回调时出错');
    }
}

// 监听来自background script的消息
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
    if (request.type === 'wechat_login_callback') {
        console.log('收到微信登录回调消息:', request.url);
        handleWechatCallback(request.url);
        sendResponse({ success: true });
    }
    return true;
});

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

async function apiSendVerificationCode(email) {
    const response = await fetch(`${API_BASE_URL}/auth/send-verification-code`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email })
    });
    if (!response.ok) {
        const err = await response.json();
        throw new Error(err.error || 'Failed to send verification code');
    }
    return response.json();
}

async function apiVerifyCode(email, code) {
    const response = await fetch(`${API_BASE_URL}/auth/verify-code`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, code })
    });
    if (!response.ok) {
        const err = await response.json();
        throw new Error(err.error || 'Verification failed');
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

// WeChat OAuth login - 使用客户端OAuth流程
async function apiWechatLogin(wechatCode) {
    const response = await fetch(`${API_BASE_URL}/auth/oauth/wechat`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ code: wechatCode })
    });
    if (!response.ok) {
        const err = await response.json();
        throw new Error(err.error || '微信登录失败');
    }
    return response.json();
}

// --- Authentication Event Handlers & UI ---
document.addEventListener('DOMContentLoaded', async () => {
    i18nManager = new I18nManager();
    try {
        const { language: storedLang } = await chrome.storage.local.get('language');
        const lang = storedLang || (chrome.i18n.getUILanguage().startsWith('zh') ? 'zh_CN' : 'en');
        await i18nManager.loadMessages(lang);
    } catch (error) {
        console.error("Failed to load i18n in options_demo.js", error);
        // Fallback to a dummy manager if loading fails
        i18nManager = { get: (key, subs) => key };
    }

    const showLoginModalBtn = document.getElementById('showLoginModalBtn');
    const loginModal = document.getElementById('loginModal');
    const closeLoginModalBtn = document.getElementById('closeLoginModalBtn');
    const loginBtn = document.getElementById('loginBtn');
    const googleLoginBtn = document.querySelector('.social-login-btn[data-provider="google"]');
    const wechatLoginBtn = document.querySelector('.social-login-btn[data-provider="wechat"]');
    const logoutBtn = document.getElementById('logoutBtn');
    const switchToRegisterBtn = document.getElementById('switchToRegisterBtn');
    const switchToLoginBtn = document.getElementById('switchToLoginBtn');

    updateUIForAuthState();

    showLoginModalBtn?.addEventListener('click', () => {
        loginModal.classList.remove('hidden');
        // 默认显示登录界面
        showLoginSection();
    });

    closeLoginModalBtn?.addEventListener('click', () => {
        loginModal.classList.add('hidden');
        // 重置界面状态
        resetLoginModal();
    });

    loginBtn?.addEventListener('click', handleLogin);
    switchToRegisterBtn?.addEventListener('click', showRegisterSection);
    switchToLoginBtn?.addEventListener('click', showLoginSection);

    // Add event listeners for the new verification flow
    const sendVerificationCodeBtn = document.getElementById('sendVerificationCodeBtn');
    const verifyCodeBtn = document.getElementById('verifyCodeBtn');
    const resendCodeBtn = document.getElementById('resendCodeBtn');
    const completeRegistrationBtn = document.getElementById('completeRegistrationBtn');

    sendVerificationCodeBtn?.addEventListener('click', handleSendVerificationCode);
    verifyCodeBtn?.addEventListener('click', handleVerifyCode);
    resendCodeBtn?.addEventListener('click', handleResendCode);
    completeRegistrationBtn?.addEventListener('click', handleCompleteRegistration);
    googleLoginBtn?.addEventListener('click', handleGoogleLogin);
    wechatLoginBtn?.addEventListener('click', handleWechatLogin);
    logoutBtn?.addEventListener('click', handleLogout);
});

// State for the registration flow
let currentRegistrationEmail = '';
let resendTimer = null;
let resendCountdown = 0;

// 显示登录界面
function showLoginSection() {
    document.getElementById('loginSection').classList.remove('hidden');
    document.getElementById('registerSection').classList.add('hidden');
    // 清空错误信息
    document.getElementById('loginMessage').classList.add('hidden');
}

// 显示注册界面
function showRegisterSection() {
    document.getElementById('loginSection').classList.add('hidden');
    document.getElementById('registerSection').classList.remove('hidden');
    // 重置注册步骤到第一步
    resetRegistrationSteps();
}

// 重置注册步骤
function resetRegistrationSteps() {
    document.getElementById('step1').classList.remove('hidden');
    document.getElementById('step2').classList.add('hidden');
    document.getElementById('step3').classList.add('hidden');
    document.getElementById('verificationMessage').classList.add('hidden');
    document.getElementById('verificationStatus').textContent = '';

    // 重置倒计时
    if (resendTimer) {
        clearInterval(resendTimer);
        resendTimer = null;
    }
    resendCountdown = 0;
    updateResendButton();
}

// 更新重新发送按钮状态
function updateResendButton() {
    const resendBtn = document.getElementById('resendCodeBtn');
    if (!resendBtn) return;

    if (resendCountdown > 0) {
        resendBtn.disabled = true;
        resendBtn.textContent = i18nManager.get('resendCountdown').replace('{seconds}', resendCountdown);
    } else {
        resendBtn.disabled = false;
        resendBtn.textContent = i18nManager.get('resendCode');
    }
}

// 启动倒计时
function startResendCountdown() {
    resendCountdown = 60;
    updateResendButton();

    if (resendTimer) {
        clearInterval(resendTimer);
    }

    resendTimer = setInterval(() => {
        resendCountdown--;
        updateResendButton();

        if (resendCountdown <= 0) {
            clearInterval(resendTimer);
            resendTimer = null;
        }
    }, 1000);
}

// 重置登录模态框
function resetLoginModal() {
    // 清空所有输入框
    document.getElementById('emailInput').value = '';
    document.getElementById('passwordInput').value = '';
    document.getElementById('registerEmailInput').value = '';
    document.getElementById('verificationCodeInput').value = '';
    document.getElementById('registerPasswordInput').value = '';
    document.getElementById('confirmPasswordInput').value = '';

    // 清空错误信息
    document.getElementById('loginMessage').classList.add('hidden');
    document.getElementById('verificationMessage').classList.add('hidden');
    document.getElementById('verificationStatus').textContent = '';

    // 重置到登录界面
    showLoginSection();
}

async function handleLogin(event) {
    event.preventDefault();
    const email = document.getElementById('emailInput').value;
    const password = document.getElementById('passwordInput').value;
    if (!email || !password) {
        alert(i18nManager.get('emailPlaceholder') + ' and ' + i18nManager.get('passwordPlaceholder'));
        return;
    }

    try {
        const loginBtn = document.getElementById('loginBtn');
        loginBtn.disabled = true;
        loginBtn.textContent = i18nManager.get('processing');

        const authData = await apiLogin(email, password);
        await onLoginSuccess(authData);
    } catch (loginError) {
        // 显示登录错误信息
        const loginMessage = document.getElementById('loginMessage');
        loginMessage.textContent = loginError.message;
        loginMessage.className = 'verification-message error';
        loginMessage.classList.remove('hidden');
    } finally {
        const loginBtn = document.getElementById('loginBtn');
        loginBtn.disabled = false;
        loginBtn.textContent = i18nManager.get('login');
    }
}


async function handleSendVerificationCode(event) {
    event.preventDefault();
    const email = document.getElementById('registerEmailInput').value;
    if (!email) {
        alert(i18nManager.get('emailPlaceholder'));
        return;
    }

    try {
        const sendVerificationCodeBtn = document.getElementById('sendVerificationCodeBtn');
        sendVerificationCodeBtn.disabled = true;
        sendVerificationCodeBtn.textContent = i18nManager.get('processing');

        await apiSendVerificationCode(email);

        // Move to step 2 (verification code input)
        document.getElementById('step1').classList.add('hidden');
        document.getElementById('step2').classList.remove('hidden');

        // Show success message
        const verificationStatus = document.getElementById('verificationStatus');
        verificationStatus.textContent = i18nManager.get('verificationCodeSent');
        verificationStatus.className = 'verification-message success';

        currentRegistrationEmail = email;

        // 启动重新发送倒计时
        startResendCountdown();

    } catch (error) {
        const verificationMessage = document.getElementById('verificationMessage');
        verificationMessage.textContent = error.message;
        verificationMessage.className = 'verification-message error';
        verificationMessage.classList.remove('hidden');
    } finally {
        const sendVerificationCodeBtn = document.getElementById('sendVerificationCodeBtn');
        sendVerificationCodeBtn.disabled = false;
        sendVerificationCodeBtn.textContent = i18nManager.get('sendVerificationCode');
    }
}

async function handleVerifyCode(event) {
    event.preventDefault();
    const code = document.getElementById('verificationCodeInput').value;
    if (!code || code.length !== 6) {
        alert(i18nManager.get('verificationCodePlaceholder'));
        return;
    }

    try {
        const verifyCodeBtn = document.getElementById('verifyCodeBtn');
        verifyCodeBtn.disabled = true;
        verifyCodeBtn.textContent = i18nManager.get('processing');

        await apiVerifyCode(currentRegistrationEmail, code);

        // Move to step 3 (password setup)
        document.getElementById('step2').classList.add('hidden');
        document.getElementById('step3').classList.remove('hidden');

        // Show success message
        const verificationStatus = document.getElementById('verificationStatus');
        verificationStatus.textContent = i18nManager.get('emailVerified');
        verificationStatus.className = 'verification-message success';

    } catch (error) {
        const verificationStatus = document.getElementById('verificationStatus');
        verificationStatus.textContent = error.message;
        verificationStatus.className = 'verification-message error';
    } finally {
        const verifyCodeBtn = document.getElementById('verifyCodeBtn');
        verifyCodeBtn.disabled = false;
        verifyCodeBtn.textContent = i18nManager.get('verifyCode');
    }
}

async function handleResendCode(event) {
    event.preventDefault();

    // 检查是否在倒计时中
    if (resendCountdown > 0) {
        return;
    }

    await handleSendVerificationCode(event);
}

async function handleCompleteRegistration(event) {
    event.preventDefault();
    const password = document.getElementById('registerPasswordInput').value;
    const confirmPassword = document.getElementById('confirmPasswordInput').value;

    if (!password || !confirmPassword) {
        alert(i18nManager.get('passwordPlaceholder') + ' and ' + i18nManager.get('confirmPasswordPlaceholder'));
        return;
    }

    if (password !== confirmPassword) {
        alert('Passwords do not match');
        return;
    }

    try {
        const completeRegistrationBtn = document.getElementById('completeRegistrationBtn');
        completeRegistrationBtn.disabled = true;
        completeRegistrationBtn.textContent = i18nManager.get('processing');

        // Complete registration
        await apiRegister(currentRegistrationEmail, password);

        // Auto-login after successful registration
        const authData = await apiLogin(currentRegistrationEmail, password);
        await onLoginSuccess(authData);

    } catch (error) {
        alert(`Registration failed: ${error.message}`);
    } finally {
        const completeRegistrationBtn = document.getElementById('completeRegistrationBtn');
        completeRegistrationBtn.disabled = false;
        completeRegistrationBtn.textContent = i18nManager.get('completeRegistration');
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

async function handleWechatLogin() {
    try {
        // 直接构建微信授权URL
        // 使用与服务器相同的配置
        const clientId = 'wx58797e70a1c4f478';
        const redirectUri = 'https://bookmarker-api.aiwetalk.com/api/auth/wechat/chrome/callback';

        const authUrl = new URL('https://open.weixin.qq.com/connect/qrconnect');
        authUrl.searchParams.append('appid', clientId);
        authUrl.searchParams.append('redirect_uri', redirectUri);
        authUrl.searchParams.append('response_type', 'code');
        authUrl.searchParams.append('scope', 'snsapi_login');
        authUrl.searchParams.append('state', 'chrome_extension');

        console.log('开始微信登录流程...');
        console.log('微信授权URL:', authUrl.href);

        // 使用chrome.tabs.create打开微信授权页面
        await chrome.tabs.create({
            url: authUrl.href,
            active: true
        });

        console.log('已打开微信授权页面，等待用户授权...');

        // 等待服务器回调处理
        return;

        // 原来的launchWebAuthFlow代码注释掉
        /*
        const finalUrl = await chrome.identity.launchWebAuthFlow({
            url: authUrl,
            interactive: true
        });

        console.log('launchWebAuthFlow 完成，返回URL:', finalUrl);
        */

        // 解析回调URL获取token和用户信息
        console.log('开始解析回调URL...');
        const url = new URL(finalUrl);
        const token = url.searchParams.get('token');
        const userId = url.searchParams.get('userId');
        const error = url.searchParams.get('error');

        console.log('解析结果 - token:', token);
        console.log('解析结果 - userId:', userId);
        console.log('解析结果 - error:', error);

        if (error) {
            console.error('微信登录返回错误:', error);
            throw new Error(`微信登录失败: ${decodeURIComponent(error)}`);
        }

        if (token && userId) {
            console.log('微信登录成功，准备保存认证数据');
            const authData = {
                token: `Bearer ${decodeURIComponent(token)}`,
                userId: decodeURIComponent(userId)
            };
            await onLoginSuccess(authData);
        } else {
            console.error('Token或用户ID未在微信响应中找到');
            throw new Error('Token或用户ID未在微信响应中找到。');
        }

    } catch (error) {
        console.error("微信登录完整错误信息:", error);
        console.error("错误名称:", error.name);
        console.error("错误消息:", error.message);
        console.error("错误堆栈:", error.stack);
        alert(`微信登录失败: ${error.message}`);
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
    // 1. 保存认证信息
    await chrome.storage.local.set({ authData: { token: authData.token, userId: authData.userId } });
    
    // 2. 移除可能残留的本地 AI 配置
    await chrome.storage.local.remove('aiConfig');
    
    const loginModal = document.getElementById('loginModal');
    if(loginModal) loginModal.classList.add('hidden');
    
    await updateUIForAuthState();
    
    try {
        // 3. 先从服务器同步 AI 配置
        showToast('正在同步配置...');
        chrome.runtime.sendMessage({ action: 'syncAIConfig' }, (aiSyncResponse) => {
            if (aiSyncResponse && aiSyncResponse.status === 'success') {
                showToast('AI配置同步成功，正在同步分类...');
                // 4. 同步智能分类
                chrome.runtime.sendMessage({ action: 'syncSmartCategories' }, (categorySyncResponse) => {
                    if (categorySyncResponse && categorySyncResponse.status === 'success') {
                        showToast('分类同步成功，正在同步书签...');
                        // 5. 最后同步书签数据
                        chrome.runtime.sendMessage({ action: 'initiateMergeSync' }, (mergeSyncResponse) => {
                            if (mergeSyncResponse && mergeSyncResponse.status === 'success') {
                                showToast("书签同步完成！");

                                // 6. 确保智能分类UI被刷新
                                if (window.smartCategoryManager) {
                                    window.smartCategoryManager.loadSmartCategories().then(() => {
                                        window.smartCategoryManager.renderSmartCategories();
                                    });
                                }
                            } else {
                                showToast(`书签同步失败: ${mergeSyncResponse?.message || '未知错误'}`, 3000, "#ea4335");
                            }
                        });
                    } else {
                        showToast(`分类同步失败: ${categorySyncResponse?.message || '未知错误'}`, 3000, "#ea4335");
                    }
                });
            } else {
                showToast(`AI配置同步失败: ${aiSyncResponse?.message || '未知错误'}`, 3000, "#ea4335");
            }
        });
    } catch (e) {
        showToast(`同步过程启动失败！: ${e.message}`, 3000, '#f44336');
    }
}

async function handleLogout() {
    // 清理认证数据和 AI 配置
    await chrome.storage.local.remove(['authData', 'aiConfig']);
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

        const userName = i18nManager.get('authenticatedUser'); // 使用这个作为显示名称
        userNameSpan.textContent = userName;
        userEmailSpan.textContent = i18nManager.get('userIdDisplay', { userId: authData.userId.substring(0, 10) });

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
