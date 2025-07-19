// --- Task Queue Configuration ---
let taskQueue = []; // Now stores only bookmark IDs
let isProcessingQueue = false;
const CONCURRENT_LIMIT = 3; // 同时处理3个AI任务

// --- Context Menu ID ---
const CONTEXT_MENU_ID = "bookmark_this_page";

// --- Enqueue Task Function ---
async function enqueueTask(bookmarkId) {
    // 检查是否已在队列中
    if (taskQueue.includes(bookmarkId)) {
        return false;
    }

    // 检查书签是否已在处理中
    const { bookmarkItems = [] } = await chrome.storage.local.get("bookmarkItems");
    const bookmark = bookmarkItems.find(b => b.id === bookmarkId);
    if (bookmark && bookmark.aiStatus === 'processing') {
        return false;
    }

    // 立即设置状态为处理中
    if (bookmark) {
        const index = bookmarkItems.findIndex(b => b.id === bookmarkId);
        if (index !== -1) {
            bookmarkItems[index].aiStatus = 'processing';
            bookmarkItems[index].aiError = '';
            await chrome.storage.local.set({ bookmarkItems });
        }
    }

    taskQueue.push(bookmarkId);
    processTaskQueue(); // Start processing if not already running
    return true;
}

// --- Lifecycle Events ---
chrome.runtime.onInstalled.addListener(() => {
    console.log("Smart Bookmarker installed or updated.");
    chrome.storage.local.get('bookmarkItems', (data) => {
        if (!data.bookmarkItems) {
            chrome.storage.local.set({ bookmarkItems: [] });
        }
    });
    // Create the context menu, using the internationalized title
    chrome.contextMenus.create({
        id: CONTEXT_MENU_ID,
        title: chrome.i18n.getMessage("contextMenuTitle"),
        contexts: ["page"]
    });
    recoverStuckTasks();
});

chrome.runtime.onStartup.addListener(() => {
    console.log("Browser started. Recovering any potentially stuck tasks.");
    recoverStuckTasks();
});

async function recoverStuckTasks() {
    const { bookmarkItems = [] } = await chrome.storage.local.get("bookmarkItems");
    const stuckItems = bookmarkItems.filter(item => 
        item.type === 'bookmark' && (item.aiStatus === 'pending' || item.aiStatus === 'processing')
    );

    if (stuckItems.length > 0) {
        console.log(`Found ${stuckItems.length} stuck tasks. Re-queueing...`);
        for (const item of stuckItems) {
            await enqueueTask(item.id);
        }
    }
}

// --- Message Listener ---
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
    console.log("Background received message:", request.action);
    handleMessages(request, sendResponse);
    return true; // Indicates async response
});

async function handleMessages(request, sendResponse) {
    try {
        const { action, id, data } = request;

        switch (action) {
            case 'addCurrentPage': {
                console.log("Processing addCurrentPage action");
                const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
                console.log("Active tabs:", tabs);
                
                const currentTab = tabs[0];
                if (!currentTab || !currentTab.url || currentTab.url.startsWith('chrome://')) {
                    console.warn("No valid active tab found");
                    sendResponse({ status: "no_active_tab" });
                    return;
                }
                
                console.log("Current tab:", currentTab.url);
                
                const { bookmarkItems = [] } = await chrome.storage.local.get("bookmarkItems");
                if (bookmarkItems.some(b => b.url === currentTab.url)) {
                    console.log("Duplicate bookmark detected");
                    sendResponse({ status: "duplicate" });
                    return;
                }
                
                console.log("Adding bookmark for:", currentTab.url);
                await handleAsyncBookmarkAction(action, data || { id, parentId: 'root' }, currentTab);
                console.log("Bookmark added successfully");
                sendResponse({ status: "queued" });
                break;
            }
            case 'regenerateAiData': {
                const queued = await enqueueTask(id);
                if (queued) {
                    sendResponse({ status: "queued" });
                } else {
                    sendResponse({ status: "already_queued" });
                }
                break;
            }
            case 'callAI': {
                const { prompt } = request;
                const { aiConfig } = await chrome.storage.local.get("aiConfig");
                if (!aiConfig || !aiConfig.apiKey) {
                    sendResponse({ error: "AI配置缺失" });
                    break;
                }

                try {
                    const result = await callAI(aiConfig, prompt);
                    sendResponse({ result });
                } catch (error) {
                    sendResponse({ error: error.message });
                }
                break;
            }
            case 'addBookmarkByUrl': {
                const { url, title, category, tags, summary } = request;
                try {
                    const { bookmarkItems = [] } = await chrome.storage.local.get("bookmarkItems");

                    // 检查是否已存在
                    if (bookmarkItems.some(b => b.type === 'bookmark' && b.url === url)) {
                        sendResponse({ status: "exists", message: "该网站已在收藏中" });
                        break;
                    }

                    const newBookmark = {
                        id: crypto.randomUUID(),
                        parentId: 'root',
                        title: title || 'Untitled Page',
                        url: url,
                        dateAdded: new Date().toISOString(),
                        type: 'bookmark',
                        isStarred: false,
                        category: category || '',
                        summary: summary || '',
                        tags: tags || [],
                        aiStatus: 'pending'
                    };

                    bookmarkItems.unshift(newBookmark);
                    await chrome.storage.local.set({ bookmarkItems });
                    await enqueueTask(newBookmark.id);

                    sendResponse({ status: "success", message: "已添加到收藏" });
                } catch (error) {
                    sendResponse({ status: "error", message: error.message });
                }
                break;
            }
            case 'deleteBookmark': {
                const { bookmarkItems = [] } = await chrome.storage.local.get("bookmarkItems");
                let itemsToDelete = new Set([id]);
                let currentSize;
                do {
                    currentSize = itemsToDelete.size;
                    const parentIds = Array.from(itemsToDelete);
                    bookmarkItems.forEach(item => {
                        if (parentIds.includes(item.parentId) && !itemsToDelete.has(item.id)) {
                            itemsToDelete.add(item.id);
                        }
                    });
                } while (itemsToDelete.size > currentSize);
                
                const updatedItems = bookmarkItems.filter(item => !itemsToDelete.has(item.id));
                await chrome.storage.local.set({ bookmarkItems: updatedItems });
                sendResponse({ status: "success" });
                break;
            }
            case 'toggleStar': {
                const { bookmarkItems = [] } = await chrome.storage.local.get("bookmarkItems");
                const index = bookmarkItems.findIndex(b => b.id === id);
                if (index !== -1) {
                    bookmarkItems[index].isStarred = !bookmarkItems[index].isStarred;
                    await chrome.storage.local.set({ bookmarkItems });
                    sendResponse({ status: "success", isStarred: bookmarkItems[index].isStarred });
                } else {
                    sendResponse({ status: "error", message: "Bookmark not found" });
                }
                break;
            }
            case 'importBrowserBookmarks': {
                const browserBookmarksTree = await chrome.bookmarks.getTree();
                const { bookmarkItems: currentItems = [] } = await chrome.storage.local.get("bookmarkItems");
                const newItems = [];
                
                const processNode = (node, extensionParentId) => {
                    if (node.url) {
                        if (node.url.startsWith('javascript:') || node.url.startsWith('chrome:')) return;
                        if (currentItems.some(item => item.url === node.url)) return;

                        const newBookmark = {
                            id: crypto.randomUUID(),
                            parentId: extensionParentId,
                            title: node.title || 'No Title',
                            url: node.url,
                            dateAdded: new Date(node.dateAdded || Date.now()).toISOString(),
                            type: 'bookmark',
                            isStarred: false,
                            category: '',
                            summary: '',
                            aiStatus: 'pending'
                        };
                        newItems.push(newBookmark);
                        return;
                    }

                    let nextParentId;
                    const folderTitle = node.title || 'Unnamed Folder';
                    
                    const existingFolder = currentItems.find(item => 
                        item.type === 'folder' && 
                        item.title === folderTitle && 
                        item.parentId === extensionParentId
                    );

                    if (existingFolder) {
                        nextParentId = existingFolder.id;
                    } else {
                        const newFolder = {
                            id: crypto.randomUUID(),
                            parentId: extensionParentId,
                            title: folderTitle,
                            dateAdded: new Date(node.dateAdded || Date.now()).toISOString(),
                            type: 'folder'
                        };
                        newItems.push(newFolder);
                        nextParentId = newFolder.id;
                    }

                    if (node.children) {
                        node.children.forEach(child => processNode(child, nextParentId));
                    }
                };

                if (browserBookmarksTree[0]?.children) {
                    browserBookmarksTree[0].children.forEach(child => processNode(child, 'root'));
                }

                if (newItems.length > 0) {
                    const allItems = [...newItems, ...currentItems];
                    await chrome.storage.local.set({ bookmarkItems: allItems });
                    for (const item of newItems) {
                        if (item.type === 'bookmark') {
                            await enqueueTask(item.id);
                        }
                    }
                    sendResponse({ status: "success", count: newItems.filter(i => i.type === 'bookmark').length });
                } else {
                    sendResponse({ status: "success", count: 0 });
                }
                break;
            }
            case 'parseHTML': {
                const text = await parseWithOffscreen(request.html);
                sendResponse({ text: text });
                break;
            }
            default:
                sendResponse({ status: 'error', message: 'Unknown action' });
                break;
        }
    } catch (e) {
        console.error(`An unexpected error occurred while handling action "${request?.action}":`, e);
        sendResponse({ status: 'error', message: e.message });
    }
}

// --- Task Processing ---
async function processTaskQueue() {
    if (isProcessingQueue || taskQueue.length === 0) return;
    isProcessingQueue = true;

    const tasksToRun = taskQueue.splice(0, CONCURRENT_LIMIT);
    console.log(`Processing a batch of ${tasksToRun.length} tasks.`);

    const promises = tasksToRun.map(bookmarkId => processBookmarkWithAI(bookmarkId));
    
    try {
        await Promise.all(promises);
    } catch (e) {
        console.error("Error processing a batch of tasks:", e);
    }

    isProcessingQueue = false;
    if (taskQueue.length > 0) {
        setTimeout(processTaskQueue, 500); 
    } else {
        console.log("Task queue finished.");
    }
}

// --- AI Core Logic ---
async function processBookmarkWithAI(bookmarkId) {
    const { bookmarkItems: initialItems = [] } = await chrome.storage.local.get("bookmarkItems");
    const bookmark = initialItems.find(b => b.id === bookmarkId);

    if (!bookmark) {
        console.log(`Bookmark ${bookmarkId} not found, skipping task (was likely deleted).`);
        return;
    }

    const updateStatus = async (status, updates) => {
      const { bookmarkItems = [] } = await chrome.storage.local.get("bookmarkItems");
      const index = bookmarkItems.findIndex(b => b.id === bookmarkId);
      if (index !== -1) {
          Object.assign(bookmarkItems[index], { aiStatus: status, ...updates });
          await chrome.storage.local.set({ bookmarkItems });
      }
    };

    const { aiConfig } = await chrome.storage.local.get("aiConfig");
    if (!aiConfig || !aiConfig.apiKey) {
      await updateStatus('failed', { aiError: "API key is not configured." });
      return;
    }

    try {
      let pageContent = await getPageContent(bookmark.url);
      console.log(`Page content for ${bookmark.url}: ${pageContent ? pageContent.length : 0} characters`);

      if (!pageContent || pageContent.trim().length < 50) {
          console.warn(`Extracted content for ${bookmark.url} is too short. Trying fallback...`);
          
          // 构建回退内容
          let fallbackContent = '';
          
          if (bookmark.title && bookmark.title.trim().length > 0) {
              fallbackContent += bookmark.title + '. ';
          }
          
          // 从URL中提取信息
          try {
              const urlObj = new URL(bookmark.url);
              const domain = urlObj.hostname.replace('www.', '');
              const pathParts = urlObj.pathname.split('/').filter(p => p && isNaN(p));
              
              fallbackContent += `网站: ${domain}. `;
              if (pathParts.length > 0) {
                  fallbackContent += `页面路径: ${pathParts.join(' ').replace(/[-_]/g, ' ')}. `;
              }
          } catch (e) {
              console.error("Failed to parse URL:", e);
          }
          
          pageContent = fallbackContent;
          
          if (!pageContent || pageContent.trim().length === 0) {
              throw new Error("无法提取任何有效内容，包括标题和URL信息。");
          }
          
          console.log(`Using fallback content: ${pageContent}`);
      }

      // 使用增强的AI分析
      const enhancedResult = await enhancedCallAI(aiConfig, pageContent, bookmark.url);
      
      // 更新书签数据
      await updateStatus('completed', { 
          summary: enhancedResult.summary || '', 
          category: enhancedResult.category || '',
          tags: enhancedResult.tags || [],
          contentType: enhancedResult.contentType || 'article',
          readingLevel: enhancedResult.readingLevel || 'intermediate',
          keyPoints: enhancedResult.keyPoints || [],
          sentiment: enhancedResult.sentiment || 'neutral',
          estimatedReadTime: enhancedResult.estimatedReadTime || 5,
          aiError: '' 
      });

    } catch (error) {
      console.error(`AI processing error for bookmark ${bookmarkId}:`, error);
      
      // 提供更友好的错误信息
      let userFriendlyError = error.message;
      if (error.message.includes('API key')) {
          userFriendlyError = "AI service configuration error. Please check your API key.";
      } else if (error.message.includes('rate limit')) {
          userFriendlyError = "AI service rate limit exceeded. Please try again later.";
      } else if (error.message.includes('timeout')) {
          userFriendlyError = "Request timeout. Please check your network connection.";
      } else if (error.message.includes('无法提取')) {
          userFriendlyError = "无法提取页面内容，可能是网站限制访问。";
      }
      
      await updateStatus('failed', { aiError: userFriendlyError });
    }
}

async function handleAsyncBookmarkAction(action, data, tab) {
    console.log("handleAsyncBookmarkAction called with action:", action);
    
    if (action === "addCurrentPage") {
        try {
            console.log("Getting current bookmarks");
            const { bookmarkItems = [] } = await chrome.storage.local.get("bookmarkItems");
            
            console.log("Creating new bookmark object");
            const newBookmark = {
              type: 'bookmark',
              url: tab.url, 
              title: tab.title || 'Untitled Page', 
              id: crypto.randomUUID(),
              parentId: data.parentId || 'root',
              dateAdded: new Date().toISOString(), 
              isStarred: false, 
              category: '', 
              summary: '', 
              aiStatus: 'pending'
            };
            
            console.log("New bookmark created:", newBookmark.id);
            
            console.log("Saving to storage");
            await chrome.storage.local.set({ bookmarkItems: [newBookmark, ...bookmarkItems] });
            
            console.log("Enqueueing for AI processing");
            await enqueueTask(newBookmark.id);
            
            console.log("Bookmark action completed successfully");
        } catch (error) {
            console.error("Error in handleAsyncBookmarkAction:", error);
            throw error; // Re-throw to be caught by the caller
        }
    }
}

// --- Utility Functions ---
async function getPageContent(url) {
    try {
        console.log(`Attempting to fetch content from: ${url}`);
        const response = await fetch(url, {
            headers: {
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36'
            }
        });
        if (!response.ok) throw new Error(`Fetch failed with status: ${response.status}`);
        const html = await response.text();
        console.log(`HTML content length: ${html.length}`);
        
        const extractedText = await parseWithOffscreen(html);
        console.log(`Extracted text length: ${extractedText ? extractedText.length : 0}`);
        
        // 如果提取的内容太短，尝试从HTML中提取更多信息
        if (!extractedText || extractedText.trim().length < 100) {
            console.warn(`Extracted content too short for ${url}, trying alternative extraction...`);
            
            // 尝试从HTML中提取meta描述和标题
            const metaInfo = extractMetaInfo(html);
            if (metaInfo && metaInfo.length > 50) {
                console.log(`Using meta information as fallback: ${metaInfo.length} characters`);
                return metaInfo;
            }
            
            return extractedText || '';
        }
        
        return extractedText;
    } catch (fetchError) {
        console.error("Content extraction via fetch failed:", fetchError);
        
        // 如果fetch失败，尝试使用标题和URL作为内容
        try {
            const { bookmarkItems = [] } = await chrome.storage.local.get("bookmarkItems");
            const bookmark = bookmarkItems.find(b => b.url === url);
            if (bookmark && bookmark.title) {
                console.log(`Using bookmark title as fallback content: ${bookmark.title}`);
                return bookmark.title;
            }
        } catch (e) {
            console.error("Failed to get bookmark title:", e);
        }
        
        return "";
    }
}

let creating; 
async function setupOffscreenDocument(path) {
  const hasDoc = await chrome.offscreen.hasDocument();
  if (hasDoc) return;
  if (creating) {
    await creating;
  } else {
    creating = chrome.offscreen.createDocument({
      url: 'offscreen.html',
      reasons: [chrome.offscreen.Reason.DOM_PARSER],
      justification: 'To parse HTML strings in the background service worker',
    });
    await creating;
    creating = null;
  }
}

async function parseWithOffscreen(html) {
    await setupOffscreenDocument('offscreen.html');
    return new Promise((resolve, reject) => {
        chrome.runtime.sendMessage({ action: 'parseHTML', html: html }, response => {
            if (chrome.runtime.lastError) {
                return reject(chrome.runtime.lastError);
            }
            resolve(response.text);
        });
    });
}

async function callAI(aiConfig, content) {
    const { language: langCode = 'en' } = await chrome.storage.local.get('language');
    const targetLanguage = langCode.startsWith('zh') ? 'Simplified Chinese' : 'English';
    const truncatedContent = content.substring(0, 5000);
    const prompt = `Analyze the following text. Your response MUST be a JSON object and nothing else. Do not include any reasoning, explanations, or conversational text. The JSON object must have a "summary" key (a summary under 30 words) and a "category" key (up to 6 comma-separated keywords). The language of the values in the JSON must be ${targetLanguage}. Text: --- ${truncatedContent} ---`;
    
    let apiUrl, body;
    const headers = {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${aiConfig.apiKey}`
    };

    // 根据不同用途动态设置token限制
    let maxTokens = 512; // 默认值

    // 检测是否为智能问答请求（通过prompt内容判断）
    if (prompt.includes('返回格式（只返回JSON') || prompt.includes('recommendations')) {
        maxTokens = 1500; // 智能问答需要更多token
        console.log('检测到智能问答请求，使用更大的token限制:', maxTokens);
    } else if (prompt.includes('总结') || prompt.includes('关键点')) {
        maxTokens = 800; // 内容分析需要中等token
        console.log('检测到内容分析请求，使用中等token限制:', maxTokens);
    }

    const commonBodyParams = {
        max_tokens: maxTokens,
        temperature: 0.2
    };

    if (aiConfig.provider === 'openai') {
        apiUrl = 'https://api.openai.com/v1/chat/completions';
        body = {
            model: aiConfig.model,
            messages: [{ role: 'user', content: prompt }],
            response_format: { type: "json_object" },
            ...commonBodyParams
        };
    } else if (aiConfig.provider === 'deepseek') {
        apiUrl = 'https://api.deepseek.com/v1/chat/completions';
        body = {
            model: aiConfig.model,
            messages: [{ role: 'user', content: prompt }],
            ...commonBodyParams
        };
    } else if (aiConfig.provider === 'openrouter') {
        apiUrl = 'https://openrouter.ai/api/v1/chat/completions';
        body = {
            model: aiConfig.model,
            messages: [{ role: 'user', content: prompt }],
            ...commonBodyParams
        };
    } else {
        throw new Error("Unsupported AI provider.");
    }

    const response = await fetch(apiUrl, {
        method: 'POST',
        headers: headers,
        body: JSON.stringify(body)
    });

    if (!response.ok) {
        const errorBody = await response.json().catch(() => ({}));
        const errorMessage = errorBody.error?.message || response.statusText;
        throw new Error(`API request failed: ${errorMessage}`);
    }

    const data = await response.json();

    // 记录token使用情况
    if (data.usage) {
        console.log('Token使用情况:', {
            prompt_tokens: data.usage.prompt_tokens,
            completion_tokens: data.usage.completion_tokens,
            total_tokens: data.usage.total_tokens,
            max_tokens: maxTokens,
            是否接近限制: data.usage.completion_tokens / maxTokens > 0.9
        });

        // 如果接近token限制，发出警告
        if (data.usage.completion_tokens / maxTokens > 0.9) {
            console.warn('⚠️ AI响应接近token限制，可能被截断！');
        }
    }

    return data.choices?.[0]?.message?.content || "";
}

function parseAIResponse(text) {
    if (!text) return { summary: '', category: '' };
    try {
        const jsonMatch = text.match(/\{[\s\S]*\}/);
        if (jsonMatch) return JSON.parse(jsonMatch[0]);
    } catch (e) { console.warn("Failed to parse JSON from AI response:", text, e); }
    return { summary: '', category: '' };
}

// 增强的AI分析功能
async function enhancedCallAI(aiConfig, content, url, options = {}) {
    const { language: langCode = 'en' } = await chrome.storage.local.get('language');
    const targetLanguage = langCode.startsWith('zh') ? 'Simplified Chinese' : 'English';
    
    // 获取用户偏好的分析深度
    const { aiAnalysisDepth = 'standard' } = await chrome.storage.local.get('aiAnalysisDepth');
    
    // 计算内容的基本统计信息
    const wordCount = content.split(/\s+/).filter(word => word.length > 0).length;
    const charCount = content.length;
    const chineseCharCount = (content.match(/[\u4e00-\u9fff]/g) || []).length;
    
    // 根据分析深度调整提示词和内容长度
    let contentLength = 5000;
    let promptTemplate = '';
    
    switch(aiAnalysisDepth) {
        case 'basic':
            contentLength = 3000;
            promptTemplate = `Analyze this content and provide a basic JSON with:
            - "summary": concise summary under 30 words (in ${targetLanguage})
            - "category": primary category (in ${targetLanguage})
            - "tags": array of 3-5 relevant keywords (in ${targetLanguage})
            - "estimatedReadTime": estimated reading time in minutes based on content length and complexity (number)`;
            break;
            
        case 'standard':
            contentLength = 5000;
            promptTemplate = `Analyze this content and provide a JSON with ALL required fields:
            - "summary": concise summary under 50 words (in ${targetLanguage}) - REQUIRED, never empty
            - "category": primary category (in ${targetLanguage}) - REQUIRED, never empty
            - "tags": array of 3-6 relevant keywords/tags (in ${targetLanguage}) - REQUIRED, must contain at least 3 tags
            - "contentType": type of content (MUST be one of: article, tutorial, news, reference, tool, entertainment, blog, documentation)
            - "readingLevel": estimated reading difficulty (MUST be one of: beginner, intermediate, advanced)
            - "estimatedReadTime": estimated reading time in minutes based on content length and complexity (number)`;
            break;
            
        case 'detailed':
            contentLength = 8000;
            promptTemplate = `Perform detailed analysis on this content and provide a comprehensive JSON with:
            - "summary": detailed summary under 100 words (in ${targetLanguage})
            - "category": primary category (in ${targetLanguage})
            - "tags": array of 5-10 relevant keywords/tags (in ${targetLanguage})
            - "contentType": type of content (MUST be one of: article, tutorial, news, reference, tool, entertainment, blog, documentation, research)
            - "readingLevel": estimated reading difficulty (MUST be one of: beginner, intermediate, advanced)
            - "keyPoints": array of 3-5 key takeaways or important points (in ${targetLanguage})
            - "sentiment": overall sentiment (MUST be one of: positive, neutral, negative)
            - "estimatedReadTime": estimated reading time in minutes based on content length and complexity (number)`;
            break;
    }
    
    // 添加URL和域名信息以提高分析准确性
    let domain = '';
    try {
        const urlObj = new URL(url);
        domain = urlObj.hostname.replace('www.', '');
    } catch (e) {
        domain = 'unknown';
    }
    
    const truncatedContent = content.substring(0, contentLength);
    const finalPrompt = `${promptTemplate}

    CRITICAL REQUIREMENTS:
    - For contentType, readingLevel, and sentiment fields, use ONLY the exact English values specified above
    - For summary, category, tags, and keyPoints, use ${targetLanguage}
    - Return ONLY valid JSON without explanations or additional text
    - NEVER leave summary or tags empty - always provide meaningful content
    - If content is unclear, create reasonable summary and tags based on URL and title
    
    For estimatedReadTime calculation:
    - Content has approximately ${wordCount} words and ${charCount} characters
    - ${chineseCharCount > 0 ? `Contains ${chineseCharCount} Chinese characters` : 'Primarily English content'}
    - For Chinese: ~400-500 characters per minute reading speed
    - For English: ~250 words per minute reading speed
    - Technical content takes 50% longer
    - Content with code examples takes 100% longer
    - Minimum should be 2 minutes, maximum 120 minutes
    
    Content: "${truncatedContent}"
    URL: "${url}"
    Domain: "${domain}"`;
    
    // 调用AI API with retry
    const response = await callAIWithRetry(aiConfig, finalPrompt);
    return parseEnhancedAIResponse(response, truncatedContent);
}

// 带重试的AI调用
async function callAIWithRetry(aiConfig, prompt, maxRetries = 2) {
    let lastError = null;
    
    for (let attempt = 0; attempt <= maxRetries; attempt++) {
        try {
            const result = await callAI(aiConfig, prompt);
            return result;
        } catch (error) {
            lastError = error;
            console.warn(`AI call attempt ${attempt + 1} failed:`, error);
            
            // 如果是超时或网络错误，等待后重试
            if (error.message.includes('timeout') || 
                error.message.includes('network') || 
                error.message.includes('rate limit')) {
                if (attempt < maxRetries) {
                    const delay = 2000 * Math.pow(2, attempt); // 指数退避
                    console.log(`Retrying in ${delay}ms...`);
                    await new Promise(resolve => setTimeout(resolve, delay));
                }
            } else {
                // 其他错误直接抛出
                break;
            }
        }
    }
    
    throw lastError;
}

// 增强的响应解析 - 添加内容长度参数用于计算默认阅读时间
function parseEnhancedAIResponse(text, content = '') {
    if (!text) return getDefaultAnalysisResult(content);

    console.log('AI Response received:', text); // 添加调试日志

    try {
        // 尝试提取JSON
        const jsonMatch = text.match(/\{[\s\S]*\}/);
        if (jsonMatch) {
            const parsed = JSON.parse(jsonMatch[0]);
            console.log('Parsed AI response:', parsed); // 添加调试日志

            // 标准化阅读难度值
            let normalizedReadingLevel = 'intermediate';
            if (parsed.readingLevel) {
                const level = parsed.readingLevel.toLowerCase();
                if (level.includes('beginner') || level.includes('初级') || level.includes('基础')) {
                    normalizedReadingLevel = 'beginner';
                } else if (level.includes('advanced') || level.includes('高级') || level.includes('困难')) {
                    normalizedReadingLevel = 'advanced';
                } else if (level.includes('intermediate') || level.includes('中级') || level.includes('中等')) {
                    normalizedReadingLevel = 'intermediate';
                }
            }
            
            // 标准化内容类型值
            let normalizedContentType = 'article';
            if (parsed.contentType) {
                const type = parsed.contentType.toLowerCase();
                const validTypes = ['article', 'tutorial', 'news', 'reference', 'tool', 'entertainment', 'blog', 'documentation', 'research'];
                if (validTypes.includes(type)) {
                    normalizedContentType = type;
                } else if (type.includes('教程') || type.includes('tutorial')) {
                    normalizedContentType = 'tutorial';
                } else if (type.includes('新闻') || type.includes('news')) {
                    normalizedContentType = 'news';
                } else if (type.includes('参考') || type.includes('reference')) {
                    normalizedContentType = 'reference';
                } else if (type.includes('工具') || type.includes('tool')) {
                    normalizedContentType = 'tool';
                } else if (type.includes('娱乐') || type.includes('entertainment')) {
                    normalizedContentType = 'entertainment';
                } else if (type.includes('博客') || type.includes('blog')) {
                    normalizedContentType = 'blog';
                } else if (type.includes('文档') || type.includes('documentation')) {
                    normalizedContentType = 'documentation';
                } else if (type.includes('研究') || type.includes('research')) {
                    normalizedContentType = 'research';
                }
            }
            
            // 标准化情感值
            let normalizedSentiment = 'neutral';
            if (parsed.sentiment) {
                const sentiment = parsed.sentiment.toLowerCase();
                if (sentiment.includes('positive') || sentiment.includes('积极') || sentiment.includes('正面')) {
                    normalizedSentiment = 'positive';
                } else if (sentiment.includes('negative') || sentiment.includes('消极') || sentiment.includes('负面')) {
                    normalizedSentiment = 'negative';
                } else {
                    normalizedSentiment = 'neutral';
                }
            }
            
            // 确保返回对象至少包含基本字段，并进行数据清理
            const result = {
                summary: (parsed.summary || '').trim(),
                category: (parsed.category || '').trim(),
                tags: Array.isArray(parsed.tags) ?
                      parsed.tags.filter(tag => tag && tag.trim()).map(tag => tag.trim()) :
                      (parsed.category ? [parsed.category.trim()] : []),
                contentType: normalizedContentType,
                readingLevel: normalizedReadingLevel,
                keyPoints: Array.isArray(parsed.keyPoints) ?
                          parsed.keyPoints.filter(point => point && point.trim()).map(point => point.trim()) : [],
                sentiment: normalizedSentiment,
                estimatedReadTime: typeof parsed.estimatedReadTime === 'number' ?
                                  Math.max(1, Math.min(120, parsed.estimatedReadTime)) :
                                  calculateEstimatedReadTime(content)
            };

            // 检查关键字段，如果缺失则提供回退值
            if (!result.summary) {
                result.summary = '内容摘要暂时无法生成，请尝试重新处理';
            }
            if (!result.category) {
                result.category = '未分类';
            }
            if (!result.tags || result.tags.length === 0) {
                result.tags = result.category ? [result.category] : ['网页内容'];
            }

            console.log('Final processed result:', result); // 添加调试日志
            return result;
        }
    } catch (e) { 
        console.warn("Failed to parse enhanced JSON from AI response:", e);
    }
    
    // 回退到默认结果
    return getDefaultAnalysisResult(content);
}

// 根据内容长度计算预估阅读时间
function calculateEstimatedReadTime(content) {
    if (!content || typeof content !== 'string') return 3;
    
    // 清理内容并计算有效字符数
    const cleanContent = content.trim().replace(/\s+/g, ' ');
    
    // 对于中文内容，按字符数计算；对于英文内容，按单词数计算
    let readingTimeMinutes;
    
    // 检测是否主要是中文内容
    const chineseCharCount = (cleanContent.match(/[\u4e00-\u9fff]/g) || []).length;
    const totalCharCount = cleanContent.length;
    const isChinesePrimary = chineseCharCount / totalCharCount > 0.3;
    
    if (isChinesePrimary) {
        // 中文阅读速度：约每分钟400-500字
        const chineseReadingSpeed = 450;
        readingTimeMinutes = Math.ceil(chineseCharCount / chineseReadingSpeed);
    } else {
        // 英文阅读速度：约每分钟250个单词
        const wordCount = cleanContent.split(/\s+/).filter(word => word.length > 0).length;
        const englishReadingSpeed = 250;
        readingTimeMinutes = Math.ceil(wordCount / englishReadingSpeed);
    }
    
    // 根据内容复杂度调整
    if (cleanContent.includes('code') || cleanContent.includes('function') || 
        cleanContent.includes('class') || cleanContent.includes('import')) {
        readingTimeMinutes = Math.ceil(readingTimeMinutes * 1.5); // 技术内容增加50%时间
    }
    
    // 确保至少为2分钟，最多为120分钟
    return Math.max(2, Math.min(120, readingTimeMinutes));
}

function getDefaultAnalysisResult(content = '') {
    return { 
        summary: '', 
        category: '', 
        tags: [],
        contentType: 'article',
        readingLevel: 'intermediate',
        keyPoints: [],
        sentiment: 'neutral',
        estimatedReadTime: calculateEstimatedReadTime(content)
    };
}

// 新增：从HTML中提取meta信息的函数
function extractMetaInfo(html) {
    try {
        // 使用正则表达式提取meta描述和标题
        const titleMatch = html.match(/<title[^>]*>([^<]+)<\/title>/i);
        const descMatch = html.match(/<meta[^>]*name=["']description["'][^>]*content=["']([^"']+)["'][^>]*>/i) ||
                         html.match(/<meta[^>]*content=["']([^"']+)["'][^>]*name=["']description["'][^>]*>/i);
        const keywordsMatch = html.match(/<meta[^>]*name=["']keywords["'][^>]*content=["']([^"']+)["'][^>]*>/i) ||
                             html.match(/<meta[^>]*content=["']([^"']+)["'][^>]*name=["']keywords["'][^>]*>/i);
        
        let metaContent = '';
        
        if (titleMatch && titleMatch[1]) {
            metaContent += titleMatch[1].trim() + '. ';
        }
        
        if (descMatch && descMatch[1]) {
            metaContent += descMatch[1].trim() + '. ';
        }
        
        if (keywordsMatch && keywordsMatch[1]) {
            metaContent += '关键词: ' + keywordsMatch[1].trim() + '. ';
        }
        
        return metaContent.trim();
    } catch (e) {
        console.error("Failed to extract meta info:", e);
        return '';
    }
}

// =======================================================================
// **MODIFICATION: Added a new listener for context menu clicks.**
// =======================================================================
chrome.contextMenus.onClicked.addListener(async (info, tab) => {
    // Check if the clicked menu item is ours
    if (info.menuItemId === CONTEXT_MENU_ID) {
        // This logic is adapted from the 'addCurrentPage' message handler

        // 1. Validate the tab
        if (!tab || !tab.url || tab.url.startsWith('chrome://')) {
            console.warn("Cannot bookmark an invalid tab from context menu.");
            return;
        }

        // 2. Check for duplicates before adding
        const { bookmarkItems = [] } = await chrome.storage.local.get("bookmarkItems");
        if (bookmarkItems.some(b => b.type === 'bookmark' && b.url === tab.url)) {
            console.warn(`Bookmark for URL ${tab.url} already exists.`);
            // You could optionally send a notification to the user here.
            return;
        }

        // 3. Call the existing function to add the bookmark and enqueue the AI task
        // We pass "addCurrentPage" as the action and the tab object.
        await handleAsyncBookmarkAction("addCurrentPage", { parentId: 'root' }, tab);
    }
});
