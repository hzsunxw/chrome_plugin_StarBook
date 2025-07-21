// sidepanel.js

document.addEventListener('DOMContentLoaded', () => {
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
        qaAnswerDiv.innerHTML = '<p>🤖 正在分析文章并思考答案...</p>';
        chrome.runtime.sendMessage({ action: "askAboutBookmarkInTab", bookmarkId: currentBookmarkId, question: question }, response => {
            if (chrome.runtime.lastError || response.error) {
                qaAnswerDiv.innerHTML = `<p style="color: red;">错误: ${response?.error || chrome.runtime.lastError.message}</p>`;
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
        quizContentDiv.innerHTML = '<p>🤖 正在阅读文章并为您出题...</p>';
        chrome.runtime.sendMessage({ action: "generateQuizInTab", bookmarkId: currentBookmarkId }, response => {
            if (chrome.runtime.lastError || response.error) {
                quizContentDiv.innerHTML = `<p style="color: red;">错误: ${response?.error || chrome.runtime.lastError.message}</p>`;
            } else {
                let quizHTML = '<ol>';
                response.quiz.forEach(q => {
                    let optionsHTML = q.options && q.options.length > 0 ? `<ul>${q.options.map(opt => `<li>${opt}</li>`).join('')}</ul>` : '';
                    quizHTML += `<li><p><strong>${q.question}</strong></p>${optionsHTML}<details><summary>查看答案</summary><p>${q.answer}</p></details></li>`;
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