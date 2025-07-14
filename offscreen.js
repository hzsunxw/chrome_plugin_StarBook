// offscreen.js

// 监听从background.js发来的消息
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
    if (request.action === 'parseHTML') {
        const text = parseDOM(request.html);
        sendResponse({ text });
    }
    // 返回true表示我们将异步发送响应
    return true; 
});

// 使用DOMParser解析HTML并提取文本
function parseDOM(html) {
    const parser = new DOMParser();
    const doc = parser.parseFromString(html, "text/html");

    doc.querySelectorAll('script, style').forEach(elem => elem.remove());

    const mainContent =
        doc.querySelector('main') ||
        doc.querySelector('article') ||
        doc.querySelector('[role="main"]') ||
        doc.querySelector('#content') ||
        doc.querySelector('#main') ||
        doc.body;

    return mainContent.innerText.replace(/\s+/g, ' ').trim();
}