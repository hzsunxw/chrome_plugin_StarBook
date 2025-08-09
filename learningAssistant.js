// learningAssistant.js

(async function() {
    // 防止因页面跳转等原因重复注入
    if (document.getElementById('learning-assistant-panel')) {
        return;
    }

    // 从后台的 session 存储中获取 bookmarkId
    const response = await chrome.runtime.sendMessage({ action: "getBookmarkIdForCurrentTab" });
    const bookmarkId = response.bookmarkId;
    
    if (!bookmarkId) {
        console.error("Fallback mode: Could not retrieve bookmarkId for this tab.");
        return;
    }

    // --- 1. 创建UI面板 (使用国际化文本) ---
    const panel = document.createElement('div');
    panel.id = 'learning-assistant-panel';
    panel.innerHTML = `
        <div id="la-header">
            <h4>${chrome.i18n.getMessage("learningAssistantFallbackTitle")}</h4>
            <button id="la-close-btn">&times;</button>
        </div>
        <div id="la-content">
            <div class="la-section">
                <strong>${chrome.i18n.getMessage("askAboutArticle")}</strong>
                <div class="la-input-group">
                    <textarea id="la-qa-input" placeholder="${chrome.i18n.getMessage("qaInputPlaceholder")}" rows="2"></textarea>
                    <button id="la-ask-btn">${chrome.i18n.getMessage("askButton")}</button>
                </div>
                <div id="la-qa-answer" class="la-answer-area"></div>
            </div>
            <div class="la-section">
                <strong>${chrome.i18n.getMessage("generateQuiz")}</strong>
                <button id="la-quiz-btn">${chrome.i18n.getMessage("generateQuizButton")}</button>
                <div id="la-quiz-content" class="la-answer-area"></div>
            </div>
        </div>
    `;
    document.body.appendChild(panel);

    // --- 2. 添加事件监听 ---
    document.getElementById('la-close-btn').addEventListener('click', () => {
        panel.remove();
    });

    // 提问按钮逻辑
    document.getElementById('la-ask-btn').addEventListener('click', () => {
        const question = document.getElementById('la-qa-input').value;
        const answerDiv = document.getElementById('la-qa-answer');
        if (!question.trim()) return;
        answerDiv.innerHTML = `<p>${chrome.i18n.getMessage("analyzingAndThinking")}</p>`;

        chrome.runtime.sendMessage({ action: "askAboutBookmarkInTab", bookmarkId: bookmarkId, question: question }, response => {
            // Check for multiple possible error indicators
            if (chrome.runtime.lastError || response.error || response.status === 'error') {
                // Use the first available error message
                const errorMessage = response?.error || response?.message || chrome.runtime.lastError.message;
                answerDiv.innerHTML = `<p style="color: red;">${chrome.i18n.getMessage("errorPrefix")}: ${errorMessage}</p>`;
            } else {
                const p = document.createElement('p');
                p.innerText = response.answer;
                answerDiv.innerHTML = '';
                answerDiv.appendChild(p);
            }
        });
          /*
        chrome.runtime.sendMessage({ action: "askAboutBookmarkInTab", bookmarkId: bookmarkId, question: question }, response => {
             if (chrome.runtime.lastError || response.error) {
                answerDiv.innerHTML = `<p style="color: red;">${chrome.i18n.getMessage("errorPrefix")}: ${response?.error || chrome.runtime.lastError.message}</p>`;
            } else {
                const p = document.createElement('p');
                p.innerText = response.answer;
                answerDiv.innerHTML = '';
                answerDiv.appendChild(p);
            }
        }); */
    });

    // 生成测验按钮逻辑
    document.getElementById('la-quiz-btn').addEventListener('click', () => {
        const quizDiv = document.getElementById('la-quiz-content');
        quizDiv.innerHTML = `<p>${chrome.i18n.getMessage("readingAndQuizzing")}</p>`;
        chrome.runtime.sendMessage({ action: "generateQuizInTab", bookmarkId: bookmarkId }, response => {
            if (chrome.runtime.lastError || response.error) {
                quizDiv.innerHTML = `<p style="color: red;">${chrome.i18n.getMessage("errorPrefix")}: ${response?.error || chrome.runtime.lastError.message}</p>`;
            } else {
                let quizHTML = '<ol>';
                response.quiz.forEach(q => {
                    let optionsHTML = q.options && q.options.length > 0 ? `<ul>${q.options.map(opt => `<li>${opt}</li>`).join('')}</ul>` : '';
                    quizHTML += `<li><p><strong>${q.question}</strong></p>${optionsHTML}<details><summary>${chrome.i18n.getMessage("viewAnswer")}</summary><p>${q.answer}</p></details></li>`;
                });
                quizDiv.innerHTML = quizHTML + '</ol>';
            }
        });
    });

    // --- 3. 让面板可拖动 ---
    const header = document.getElementById('la-header');
    let isDragging = false;
    let offset = { x: 0, y: 0 };
    header.onmousedown = (e) => {
        e.preventDefault();
        isDragging = true;
        offset.x = e.clientX - panel.offsetLeft;
        offset.y = e.clientY - panel.offsetTop;
        header.style.cursor = 'grabbing';
    };
    document.onmouseup = () => {
        isDragging = false;
        header.style.cursor = 'grab';
    };
    document.onmousemove = (e) => {
        if (!isDragging) return;
        panel.style.left = `${e.clientX - offset.x}px`;
        panel.style.top = `${e.clientY - offset.y}px`;
    };
})();