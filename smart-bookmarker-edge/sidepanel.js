// sidepanel.js

document.addEventListener('DOMContentLoaded', async () => {
    const i18n = new I18nManager();
    const { language: storedLang } = await chrome.storage.local.get('language');
    const lang = storedLang || (chrome.i18n.getUILanguage().startsWith('zh') ? 'zh_CN' : 'en');
    
    await i18n.loadMessages(lang);
    i18n.applyToDOM();

    const askBtn = document.getElementById('la-ask-btn');
    const quizBtn = document.getElementById('la-quiz-btn');
    const qaInput = document.getElementById('la-qa-input');
    const qaAnswerDiv = document.getElementById('la-qa-answer');
    const quizContentDiv = document.getElementById('la-quiz-content');
    const placeholder = document.getElementById('assistant-placeholder');
    const mainContent = document.getElementById('assistant-main');

    let currentBookmarkId = null;

    const setupAssistant = (bookmarkId) => {
        if (!bookmarkId) {
            placeholder.style.display = 'block';
            mainContent.style.display = 'none';
            return;
        }
        currentBookmarkId = bookmarkId;
        placeholder.style.display = 'none';
        mainContent.style.display = 'block';

        askBtn.onclick = () => handleAsk();
        quizBtn.onclick = () => handleQuiz();
    };

    const handleAsk = () => {
        const question = qaInput.value;
        if (!question.trim() || !currentBookmarkId) return;
        qaAnswerDiv.innerHTML = `<p>${i18n.get('analyzingAndThinking')}</p>`;
        chrome.runtime.sendMessage({ action: "askAboutBookmarkInTab", bookmarkId: currentBookmarkId, question: question }, response => {
            if (chrome.runtime.lastError || response.error) {
                qaAnswerDiv.innerHTML = `<p style="color: red;">${i18n.get('errorPrefix')}: ${response?.error || chrome.runtime.lastError.message}</p>`;
            } else {
                const p = document.createElement('p');
                p.innerText = response.answer;
                qaAnswerDiv.innerHTML = '';
                qaAnswerDiv.appendChild(p);
            }
        });
    };

    const handleQuiz = () => {
        if (!currentBookmarkId) return;
        quizContentDiv.innerHTML = `<p>${i18n.get('readingAndQuizzing')}</p>`;
        chrome.runtime.sendMessage({ action: "generateQuizInTab", bookmarkId: currentBookmarkId }, response => {
            if (chrome.runtime.lastError || response.error) {
                quizContentDiv.innerHTML = `<p style="color: red;">${i18n.get('errorPrefix')}: ${response?.error || chrome.runtime.lastError.message}</p>`;
            } else {
                let quizHTML = '<ol>';
                response.quiz.forEach(q => {
                    let optionsHTML = q.options && q.options.length > 0 ? `<ul>${q.options.map(opt => `<li>${opt}</li>`).join('')}</ul>` : '';
                    quizHTML += `<li><p><strong>${q.question}</strong></p>${optionsHTML}<details><summary>${i18n.get('viewAnswer')}</summary><p>${q.answer}</p></details></li>`;
                });
                quizContentDiv.innerHTML = quizHTML + '</ol>';
            }
        });
    };
    
    // 初始化时或tab切换时获取 bookmarkId
    chrome.runtime.sendMessage({ action: "getBookmarkIdForCurrentTab" }, response => {
        setupAssistant(response?.bookmarkId);
    });

    // 监听来自 background 的通知，当用户切换到另一个受管理的标签页时更新UI
    chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
        if (request.action === 'updateSidePanel') {
            setupAssistant(request.bookmarkId);
        }
    });
});
