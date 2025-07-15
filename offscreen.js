// Listen for messages from the background script
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
    if (request.action === 'parseHTML') {
        const text = parseDOM(request.html);
        sendResponse({ text: text });
    }
    // Return true to indicate that the response will be sent asynchronously.
    // This is important to keep the message channel open.
    return true; 
});

// Use DOMParser to parse HTML and extract text
function parseDOM(html) {
    const parser = new DOMParser();
    const doc = parser.parseFromString(html, "text/html");

    // Remove script and style tags to avoid extracting their content
    doc.querySelectorAll('script, style').forEach(elem => elem.remove());

    // Try to find the main content area, otherwise fallback to the whole body
    const mainContent =
        doc.querySelector('main') ||
        doc.querySelector('article') ||
        doc.querySelector('[role="main"]') ||
        doc.querySelector('#content') ||
        doc.querySelector('#main') ||
        doc.body;

    // Replace multiple whitespace characters with a single space and trim
    return mainContent ? mainContent.innerText.replace(/\s+/g, ' ').trim() : '';
}