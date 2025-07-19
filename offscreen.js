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
    try {
        const parser = new DOMParser();
        const doc = parser.parseFromString(html, "text/html");

        // Remove script and style tags to avoid extracting their content
        doc.querySelectorAll('script, style, nav, header, footer, aside, .advertisement, .ads, .sidebar').forEach(elem => elem.remove());

        // 尝试多种内容提取策略
        let mainContent = null;
        
        // 策略1: 查找主要内容区域
        const contentSelectors = [
            'main',
            'article', 
            '[role="main"]',
            '#content',
            '#main',
            '.content',
            '.main-content',
            '.post-content',
            '.entry-content',
            '.article-content',
            '.page-content'
        ];
        
        for (const selector of contentSelectors) {
            mainContent = doc.querySelector(selector);
            if (mainContent && mainContent.innerText.trim().length > 100) {
                break;
            }
        }
        
        // 策略2: 如果没找到主内容，尝试提取所有段落
        if (!mainContent || mainContent.innerText.trim().length < 100) {
            const paragraphs = doc.querySelectorAll('p, h1, h2, h3, h4, h5, h6, li');
            let combinedText = '';
            paragraphs.forEach(p => {
                const text = p.innerText.trim();
                if (text.length > 20) { // 只包含有意义的段落
                    combinedText += text + ' ';
                }
            });
            
            if (combinedText.length > 100) {
                return combinedText.replace(/\s+/g, ' ').trim();
            }
        }
        
        // 策略3: 使用找到的主内容
        if (mainContent) {
            const text = mainContent.innerText.replace(/\s+/g, ' ').trim();
            if (text.length > 50) {
                return text;
            }
        }
        
        // 策略4: 最后回退到body
        const bodyText = doc.body ? doc.body.innerText.replace(/\s+/g, ' ').trim() : '';
        
        // 策略5: 如果body内容也很少，尝试提取meta信息
        if (bodyText.length < 100) {
            let metaContent = '';
            
            // 提取title
            const title = doc.querySelector('title');
            if (title) {
                metaContent += title.innerText.trim() + '. ';
            }
            
            // 提取meta description
            const description = doc.querySelector('meta[name="description"]') || 
                              doc.querySelector('meta[property="og:description"]');
            if (description) {
                metaContent += description.getAttribute('content') + '. ';
            }
            
            // 提取meta keywords
            const keywords = doc.querySelector('meta[name="keywords"]');
            if (keywords) {
                metaContent += '关键词: ' + keywords.getAttribute('content') + '. ';
            }
            
            return metaContent.trim() || bodyText;
        }
        
        return bodyText;
    } catch (error) {
        console.error('Error parsing DOM:', error);
        return '';
    }
}
