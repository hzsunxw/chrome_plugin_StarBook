const isSidePanelSupported = typeof chrome.sidePanel !== 'undefined';
console.log(`Side Panel API Supported: ${isSidePanelSupported}`);

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
    recoverStuckTasks();
});

async function recoverStuckTasks() {
    const { bookmarkItems = [] } = await chrome.storage.local.get("bookmarkItems");
    const stuckItems = bookmarkItems.filter(item => 
        item.type === 'bookmark' && (item.aiStatus === 'pending' || item.aiStatus === 'processing')
    );

    if (stuckItems.length > 0) {
        for (const item of stuckItems) {
            await enqueueTask(item.id);
        }
    }
}

// --- Message Listener ---
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
    handleMessages(request, sender, sendResponse);
    return true; // Indicates async response
});

async function handleMessages(request, sender, sendResponse) {
    try {
        const { action, id, data } = request;

        switch (action) {            
            // --- 新增：处理来自 options.js 的请求，打开学习助手 ---
            case 'openLearningAssistant': {
                const { bookmark } = request;
                if (!bookmark || !bookmark.url) {
                    sendResponse({ status: "error", message: "Invalid bookmark data" });
                    return;
                }

                const tab = await chrome.tabs.create({ url: bookmark.url });
                await chrome.storage.session.set({ [tab.id]: bookmark.id });

                if (isSidePanelSupported) {
                    // --- 方案二：Side Panel 逻辑 ---
                    await chrome.sidePanel.setOptions({ tabId: tab.id, path: 'sidepanel.html', enabled: true });
                    await chrome.sidePanel.open({ tabId: tab.id });
                    console.log(`Opened side panel for tab ${tab.id}`);
                } else {
                    // --- 方案一：后备逻辑 ---
                    console.log(`Using fallback mode for tab ${tab.id}`);
                    // 依赖 onUpdated 监听器来注入脚本
                }
                sendResponse({ status: "opening" });
                break;
            }
            case 'getBookmarkIdForCurrentTab': {
                const tabId = sender.tab?.id;
                if (tabId) {
                    const data = await chrome.storage.session.get(tabId.toString());
                    sendResponse({ bookmarkId: data[tabId] });
                } else { // 请求可能来自没有 tabId 的 sidepanel
                    const [activeTab] = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
                    if (activeTab) {
                        const data = await chrome.storage.session.get(activeTab.id.toString());
                        sendResponse({ bookmarkId: data[activeTab.id] });
                    } else {
                        sendResponse({ bookmarkId: null });
                    }
                }
                break;
            }

            // --- 新增：处理来自内容脚本的问答请求 ---
            case 'askAboutBookmarkInTab': {
                const { bookmarkId, question } = request;
                const { bookmarkItems = [], aiConfig } = await chrome.storage.local.get(["bookmarkItems", "aiConfig"]);
                const bookmark = bookmarkItems.find(b => b.id === bookmarkId);

                // ... (此部分前面的 if 判断保持不变)
                if (!bookmark) {
                    sendResponse({ error: "书签数据未找到。" });
                    return;
                }
                if (!aiConfig || !aiConfig.apiKey) {
                    sendResponse({ error: chrome.i18n.getMessage("errorApiKeyMissing") });
                    return;
                }
                
                const pageContent = await getPageContent(bookmark.url);
                if (!pageContent || pageContent.trim().length < 50) {
                    sendResponse({ error: "无法获取足够的内容进行问答。" });
                    return;
                }

                const prompt = `你是一个严谨的AI问答助手。请严格根据下面提供的“上下文”来回答用户的问题。\n\n### 上下文:\n${pageContent.substring(0, 8000)}\n\n### 用户的问题:\n${question}\n\n### 你的要求:\n- 你的回答必须完全基于上述“上下文”。\n- 如果“上下文”中没有足够信息来回答问题，请明确指出：“根据所提供的文章内容，无法回答这个问题。”\n- 回答应直接、简洁。`;
                                
                const answer = await callAI(aiConfig, prompt);

                // [已修改] 在这里增加对 answer 的校验
                if (answer && answer.trim() !== '') {
                    sendResponse({ answer: answer });
                } else {
                    sendResponse({ error: "AI未能返回有效的回答，可能遇到了临时问题，请稍后再试。" });
                }
                
                break;
            }

            // --- 新增：处理来自内容脚本的测验生成请求 ---
            case 'generateQuizInTab': {
                const { bookmarkId } = request; // <-- THIS IS THE FIX. Add this line.
                
                // The rest of the code in this block can now find and use bookmarkId
                const { bookmarkItems = [], aiConfig } = await chrome.storage.local.get(["bookmarkItems", "aiConfig"]);
                const bookmark = bookmarkItems.find(b => b.id === bookmarkId);

                if (!bookmark) {
                    sendResponse({ error: "书签数据未找到。" });
                    return;
                }
                if (!aiConfig || !aiConfig.apiKey) {
                    sendResponse({ error: chrome.i18n.getMessage("errorApiKeyMissing") });
                    return;
                }
                
                // ... the rest of the function remains the same ...
                const pageContent = await getPageContent(bookmark.url);
                 if (!pageContent || pageContent.trim().length < 100) {
                    sendResponse({ error: "无法获取足够的内容生成测验。" });
                    return;
                }

                const prompt = `你是一个优秀的学习导师。请仔细阅读以下“文本内容”，并从中提炼出3到5个最重要的核心知识点，设计成一个学习测验。\n\n### 文本内容:\n${pageContent.substring(0, 8000)}\n\n### 你的任务:\n1. 创建3-5个问题，可以是选择题或简答题。\n2. 确保问题能有效检验对文本核心内容的理解。\n3. 返回一个包含 "quiz" 列表的JSON对象。每个问题对象应包含 "question" (问题), "type" (类型: '选择题' 或 '简答题'), "options" (选择题选项数组，简答题则为空数组), 和 "answer" (答案)。\n\n### JSON格式示例:\n{"quiz": [{"question": "React Hooks 的主要目的是什么？","type": "选择题","options": ["A. 样式化组件","B. 在函数组件中使用 state 和其他 React 特性","C. 路由管理"],"answer": "B. 在函数组件中使用 state 和其他 React 特性"}]}\n\n### 关键指令:\n你的回答必须是且仅是一个完整的、语法正确的JSON对象。不要在JSON代码块前后添加任何额外的文字、解释或注释。如果无法根据内容生成有意义的测验，请必须返回一个包含空列表的JSON对象：{"quiz": []}`;

                try {
                    const quizDataStr = await callAI(aiConfig, prompt);
                    const jsonMatch = quizDataStr.match(/\{[\s\S]*\}/);
                    if (jsonMatch) {
                        const parsedJson = JSON.parse(jsonMatch[0]);
                        if (parsedJson && parsedJson.quiz) {
                            sendResponse({ quiz: parsedJson.quiz });
                        } else {
                            throw new Error("AI返回的JSON中缺少'quiz'字段。");
                        }
                    } else {
                        throw new Error("在AI的返回内容中未找到有效的JSON对象。");
                    }
                } catch (e) {
                    console.error("生成或解析测验失败:", e);
                    sendResponse({ error: "AI返回格式错误，无法解析测验内容。" });
                }
                break;
            }

            case 'addCurrentPage': {
                const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
                const currentTab = tabs[0];
                if (!currentTab || !currentTab.url || currentTab.url.startsWith('chrome://')) {
                    sendResponse({ status: "no_active_tab" });
                    return;
                }
                
                const { bookmarkItems = [] } = await chrome.storage.local.get("bookmarkItems");
                if (bookmarkItems.some(b => b.url === currentTab.url)) {
                    sendResponse({ status: "duplicate" });
                    return;
                }
                
                await handleAsyncBookmarkAction(action, data || { id, parentId: 'root' }, currentTab);
                sendResponse({ status: "queued" });
                break;
            }
            case 'regenerateAiData': {
                const queued = await enqueueTask(id);
                sendResponse({ status: queued ? "queued" : "already_queued" });
                break;
            }
            case 'callAI': {
                const { prompt } = request;
                const { aiConfig } = await chrome.storage.local.get("aiConfig");
                if (!aiConfig || !aiConfig.apiKey) {
                    sendResponse({ error: chrome.i18n.getMessage("errorApiKeyMissing") });
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
                    if (bookmarkItems.some(b => b.type === 'bookmark' && b.url === url)) {
                        sendResponse({ status: "exists", message: chrome.i18n.getMessage("pageExists") });
                        break;
                    }
                    const newBookmark = { id: crypto.randomUUID(), parentId: 'root', title: title || 'Untitled', url, dateAdded: new Date().toISOString(), type: 'bookmark', isStarred: false, category, summary, tags, aiStatus: 'pending', notes: '' };
                    bookmarkItems.unshift(newBookmark);
                    await chrome.storage.local.set({ bookmarkItems });
                    await enqueueTask(newBookmark.id);
                    sendResponse({ status: "success", message: chrome.i18n.getMessage("taskQueued") });
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
                    bookmarkItems.forEach(item => { if (parentIds.includes(item.parentId)) itemsToDelete.add(item.id); });
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
                        const newBookmark = { id: crypto.randomUUID(), parentId: extensionParentId, title: node.title || 'No Title', url: node.url, dateAdded: new Date(node.dateAdded || Date.now()).toISOString(), type: 'bookmark', isStarred: false, category: '', summary: '', aiStatus: 'pending', notes: '' };
                        newItems.push(newBookmark);
                        return;
                    }
                    let nextParentId;
                    const folderTitle = node.title || 'Unnamed Folder';
                    const existingFolder = currentItems.find(item => item.type === 'folder' && item.title === folderTitle && item.parentId === extensionParentId);
                    if (existingFolder) {
                        nextParentId = existingFolder.id;
                    } else {
                        const newFolder = { id: crypto.randomUUID(), parentId: extensionParentId, title: folderTitle, dateAdded: new Date(node.dateAdded || Date.now()).toISOString(), type: 'folder' };
                        newItems.push(newFolder);
                        nextParentId = newFolder.id;
                    }
                    if (node.children) node.children.forEach(child => processNode(child, nextParentId));
                };
                if (browserBookmarksTree[0]?.children) browserBookmarksTree[0].children.forEach(child => processNode(child, 'root'));
                if (newItems.length > 0) {
                    const allItems = [...newItems, ...currentItems];
                    await chrome.storage.local.set({ bookmarkItems: allItems });
                    for (const item of newItems) if (item.type === 'bookmark') await enqueueTask(item.id);
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
        console.error(`Error handling action "${request?.action}":`, e);
        sendResponse({ status: 'error', message: e.message });
    }
}

chrome.tabs.onUpdated.addListener(async (tabId, changeInfo, tab) => {
    // 只有在不支持 Side Panel 时才执行重新注入逻辑
    if (!isSidePanelSupported && changeInfo.status === 'complete') {
        const data = await chrome.storage.session.get(tabId.toString());
        const bookmarkId = data[tabId];
        if (bookmarkId) {
            console.log(`Fallback mode: Re-injecting script for tab ${tabId}`);
            try {
                await chrome.scripting.insertCSS({ target: { tabId: tabId }, files: ['learningAssistant.css'] });
                await chrome.scripting.executeScript({ target: { tabId: tabId }, files: ['learningAssistant.js'] });
            } catch(e) { /* Catch errors if tab is protected */ }
        }
    }
});

// 当用户切换标签页时，通知 side panel 更新
chrome.tabs.onActivated.addListener(async (activeInfo) => {
    if (isSidePanelSupported) {
        const data = await chrome.storage.session.get(activeInfo.tabId.toString());
        const bookmarkId = data[activeInfo.tabId];
        // 发送消息让 side panel 根据新的 tabId 更新其状态
        chrome.runtime.sendMessage({ action: 'updateSidePanel', bookmarkId: bookmarkId || null });
    }
});

chrome.tabs.onRemoved.addListener((tabId, removeInfo) => {
    chrome.storage.session.remove(tabId.toString());
    console.log(`Cleaned up session storage for closed tab ${tabId}.`);
});

// --- Task Processing ---
async function processTaskQueue() {
    if (isProcessingQueue || taskQueue.length === 0) return;
    isProcessingQueue = true;
    const tasksToRun = taskQueue.splice(0, CONCURRENT_LIMIT);
    await Promise.all(tasksToRun.map(id => processBookmarkWithAI(id).catch(e => console.error(`Error in task for ${id}:`, e))));
    isProcessingQueue = false;
    if (taskQueue.length > 0) setTimeout(processTaskQueue, 500);
}

// --- AI Core Logic ---
async function processBookmarkWithAI(bookmarkId) {
    const { bookmarkItems: initialItems = [] } = await chrome.storage.local.get("bookmarkItems");
    const bookmark = initialItems.find(b => b.id === bookmarkId);
    if (!bookmark) return;

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
      await updateStatus('failed', { aiError: chrome.i18n.getMessage("errorApiKeyMissing") });
      return;
    }

    try {
      let pageContent = await getPageContent(bookmark.url);
      if (!pageContent || pageContent.trim().length < 50) {
          let fallbackContent = bookmark.title ? bookmark.title + '. ' : '';
          try {
              const urlObj = new URL(bookmark.url);
              fallbackContent += `Site: ${urlObj.hostname.replace('www.', '')}. Path: ${urlObj.pathname.split('/').filter(p => p && isNaN(p)).join(' ').replace(/[-_]/g, ' ')}.`;
          } catch (e) {}
          pageContent = fallbackContent;
          if (!pageContent || pageContent.trim().length === 0) {
              throw new Error(chrome.i18n.getMessage("contentExtractionFailed"));
          }
      }

      const enhancedResult = await enhancedCallAI(aiConfig, pageContent, bookmark.url);
      await updateStatus('completed', { ...enhancedResult, aiError: '' });

    } catch (error) {
      console.error(`AI processing error for bookmark ${bookmarkId}:`, error);
      let userFriendlyError = error.message;
      if (error.message.includes('API key')) userFriendlyError = chrome.i18n.getMessage("errorApiKeyInvalid");
      else if (error.message.includes('rate limit')) userFriendlyError = chrome.i18n.getMessage("errorRateLimit");
      else if (error.message.includes('timeout')) userFriendlyError = chrome.i18n.getMessage("errorTimeout");
      else if (error.message.includes(chrome.i18n.getMessage("contentExtractionFailed"))) userFriendlyError = chrome.i18n.getMessage("errorContentExtractionFailed");
      await updateStatus('failed', { aiError: userFriendlyError });
    }
}

async function handleAsyncBookmarkAction(action, data, tab) {
    if (action === "addCurrentPage") {
        const { bookmarkItems = [] } = await chrome.storage.local.get("bookmarkItems");
        const newBookmark = { type: 'bookmark', url: tab.url, title: tab.title || 'Untitled', id: crypto.randomUUID(), parentId: data.parentId || 'root', dateAdded: new Date().toISOString(), isStarred: false, category: '', summary: '', aiStatus: 'pending', notes: '' };
        await chrome.storage.local.set({ bookmarkItems: [newBookmark, ...bookmarkItems] });
        await enqueueTask(newBookmark.id);
    }
}

// --- Utility Functions ---
async function getPageContent(url) {
    try {
        const response = await fetch(url, { headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36' } });
        if (!response.ok) throw new Error(`Fetch failed with status: ${response.status}`);
        const html = await response.text();
        const extractedText = await parseWithOffscreen(html);
        if (!extractedText || extractedText.trim().length < 100) {
            const metaInfo = extractMetaInfo(html);
            if (metaInfo && metaInfo.length > 50) return metaInfo;
            return extractedText || '';
        }
        return extractedText;
    } catch (fetchError) {
        console.error("Content extraction via fetch failed:", fetchError);
        try {
            const { bookmarkItems = [] } = await chrome.storage.local.get("bookmarkItems");
            const bookmark = bookmarkItems.find(b => b.url === url);
            if (bookmark && bookmark.title) return bookmark.title;
        } catch (e) {}
        return "";
    }
}

let creating; 
async function setupOffscreenDocument() {
  if (await chrome.offscreen.hasDocument()) return;
  if (creating) await creating;
  else {
    creating = chrome.offscreen.createDocument({ url: 'offscreen.html', reasons: ['DOM_PARSER'], justification: 'To parse HTML strings in the background service worker' });
    await creating;
    creating = null;
  }
}

async function parseWithOffscreen(html) {
    await setupOffscreenDocument();
    return new Promise((resolve, reject) => {
        chrome.runtime.sendMessage({ action: 'parseHTML', html: html }, response => {
            if (chrome.runtime.lastError) return reject(chrome.runtime.lastError);
            resolve(response.text);
        });
    });
}

function getAnalysisPrompt(targetLanguage, analysisDepth, contentStats, truncatedContent, url, domain) {
    const isChinese = targetLanguage.toLowerCase().includes('chinese');
    
    let promptTemplates = {
        en: {
            basic: `Analyze this content and provide a basic JSON with:
- "summary": concise summary under 30 words (in English)
- "category": primary category (in English)
- "tags": array of 3-5 relevant keywords (in English)
- "estimatedReadTime": estimated reading time in minutes (number)`,
            standard: `Analyze this content and provide a JSON with ALL required fields:
- "summary": concise summary under 50 words (in English) - REQUIRED, never empty
- "category": primary category (in English) - REQUIRED, never empty
- "tags": array of 3-6 relevant keywords/tags (in English) - REQUIRED, must contain at least 3 tags
- "contentType": type of content (MUST be one of: article, tutorial, news, reference, tool, entertainment, blog, documentation)
- "readingLevel": estimated reading difficulty (MUST be one of: beginner, intermediate, advanced)
- "estimatedReadTime": estimated reading time in minutes (number)`,
            detailed: `Perform detailed analysis and provide a comprehensive JSON with:
- "summary": detailed summary under 100 words (in English)
- "category": primary category (in English)
- "tags": array of 5-10 relevant keywords/tags (in English)
- "contentType": type of content (MUST be one of: article, tutorial, news, reference, tool, entertainment, blog, documentation, research)
- "readingLevel": estimated reading difficulty (MUST be one of: beginner, intermediate, advanced)
- "keyPoints": array of 3-5 key takeaways (in English)
- "sentiment": overall sentiment (MUST be one of: positive, neutral, negative)
- "estimatedReadTime": estimated reading time in minutes (number)`
        },
        zh_CN: {
            basic: `分析此内容并提供一个基础JSON，包含：
- "summary": 简洁的摘要，30字以内 (使用简体中文)
- "category": 主要分类 (使用简体中文)
- "tags": 3-5个相关关键词的数组 (使用简体中文)
- "estimatedReadTime": 估算的阅读时间（分钟，数字）`,
            standard: `分析此内容并提供一个包含所有必填字段的JSON：
- "summary": 简洁的摘要，50字以内 (使用简体中文) - 必填
- "category": 主要分类 (使用简体中文) - 必填
- "tags": 3-6个相关关键词/标签的数组 (使用简体中文) - 必填
- "contentType": 内容类型 (必须是以下之一: article, tutorial, news, reference, tool, entertainment, blog, documentation)
- "readingLevel": 阅读难度评估 (必须是以下之一: beginner, intermediate, advanced)
- "estimatedReadTime": 估算的阅读时间（分钟，数字）`,
            detailed: `对此内容进行详细分析，并提供一个全面的JSON，包含：
- "summary": 详细的摘要，100字以内 (使用简体中文)
- "category": 主要分类 (使用简体中文)
- "tags": 5-10个相关关键词/标签的数组 (使用简体中文)
- "contentType": 内容类型 (必须是以下之一: article, tutorial, news, reference, tool, entertainment, blog, documentation, research)
- "readingLevel": 阅读难度评估 (必须是以下之一: beginner, intermediate, advanced)
- "keyPoints": 3-5个关键要点的数组 (使用简体中文)
- "sentiment": 整体情绪 (必须是以下之一: positive, neutral, negative)
- "estimatedReadTime": 估算的阅读时间（分钟，数字）`
        }
    };
    const requirements = {
        en: { title: "CRITICAL REQUIREMENTS", req1: "For contentType, readingLevel, and sentiment fields, use ONLY the exact English values specified.", req2: `For summary, category, tags, and keyPoints, use ${targetLanguage}.`, req3: "Return ONLY valid JSON.", req4: "NEVER leave summary or tags empty.", req5: "If content is unclear, create reasonable summary and tags based on URL.", reading_time_title: "For estimatedReadTime calculation", content_stats: `Content has ~${contentStats.wordCount} words and ${contentStats.charCount} characters.`, lang_stats_en: "Primarily English.", lang_stats_zh: `Contains ${contentStats.chineseCharCount} Chinese chars.`, speed_en: "For English: ~250 wpm.", speed_zh: "For Chinese: ~450 cpm.", adjustments: "Tech content: +50% time. Code examples: +100% time.", range: "Range: 2-120 min." },
        zh_CN: { title: "关键要求", req1: "对于 contentType, readingLevel, 和 sentiment 字段，只能使用指定的精确英文值。", req2: `对于 summary, category, tags, 和 keyPoints 字段，请使用${targetLanguage}。`, req3: "只返回有效的JSON。", req4: "永远不要让 summary 或 tags 为空。", req5: "如果内容不清楚，请根据URL创建合理的摘要和标签。", reading_time_title: "关于 estimatedReadTime 的计算", content_stats: `内容大约有 ${contentStats.wordCount} 个单词和 ${contentStats.charCount} 个字符。`, lang_stats_en: "主要是英文内容。", lang_stats_zh: `包含 ${contentStats.chineseCharCount} 个中文字符。`, speed_en: "英文速度：~250 wpm。", speed_zh: "中文速度：~450 cpm。", adjustments: "技术内容时间+50%。代码示例时间+100%。", range: "范围: 2-120 分钟。" }
    };
    const langKey = isChinese ? 'zh_CN' : 'en';
    const p = requirements[langKey];
    const promptTemplate = promptTemplates[langKey][analysisDepth] || promptTemplates[langKey]['standard'];
    const langStats = contentStats.chineseCharCount > 20 ? p.lang_stats_zh : p.lang_stats_en;
    return `${promptTemplate}\n\n${p.title}:\n- ${p.req1}\n- ${p.req2}\n- ${p.req3}\n- ${p.req4}\n- ${p.req5}\n\n${p.reading_time_title}:\n- ${p.content_stats} ${langStats}\n- ${isChinese ? p.speed_zh : p.speed_en}\n- ${p.adjustments}\n- ${p.range}\n\nContent: "${truncatedContent}"\nURL: "${url}"`;
}

async function callAI(aiConfig, prompt) {
    let apiUrl, body;
    const headers = { 'Content-Type': 'application/json', 'Authorization': `Bearer ${aiConfig.apiKey}` };
    let maxTokens = prompt.includes('recommendations') ? 1500 : 800;

    const commonBodyParams = { max_tokens: maxTokens, temperature: 0.2 };
    if (aiConfig.provider === 'openai') {
        apiUrl = 'https://api.openai.com/v1/chat/completions';
        body = { model: aiConfig.model, messages: [{ role: 'user', content: prompt }], response_format: { type: "json_object" }, ...commonBodyParams };
    } else if (aiConfig.provider === 'deepseek') {
        apiUrl = 'https://api.deepseek.com/v1/chat/completions';
        body = { model: aiConfig.model, messages: [{ role: 'user', content: prompt }], ...commonBodyParams };
    } else if (aiConfig.provider === 'openrouter') {
        apiUrl = 'https://openrouter.ai/api/v1/chat/completions';
        headers['HTTP-Referer'] = 'https://github.com/CaspianLight/Smart-Bookmarker'; // Required by OpenRouter
        headers['X-Title'] = 'Smart Bookmarker';
        body = { model: aiConfig.model, messages: [{ role: 'user', content: prompt }], ...commonBodyParams };
    } else {
        throw new Error("Unsupported AI provider.");
    }

    const response = await fetch(apiUrl, { method: 'POST', headers: headers, body: JSON.stringify(body) });
    if (!response.ok) {
        const errorBody = await response.json().catch(() => ({}));
        throw new Error(`API request failed: ${errorBody.error?.message || response.statusText}`);
    }
    const data = await response.json();
    return data.choices?.[0]?.message?.content || "";
}

async function enhancedCallAI(aiConfig, content, url) {
    const { language: langCode = 'en' } = await chrome.storage.local.get('language');
    const targetLanguage = langCode.startsWith('zh') ? 'Simplified Chinese' : 'English';
    const { aiAnalysisDepth = 'standard' } = await chrome.storage.local.get('aiAnalysisDepth');
    const wordCount = content.split(/\s+/).filter(Boolean).length;
    const charCount = content.length;
    const chineseCharCount = (content.match(/[\u4e00-\u9fff]/g) || []).length;
    let contentLength = { basic: 3000, standard: 5000, detailed: 8000 }[aiAnalysisDepth] || 5000;
    const truncatedContent = content.substring(0, contentLength);
    let domain = 'unknown'; try { domain = new URL(url).hostname.replace('www.', ''); } catch (e) {}
    
    const finalPrompt = getAnalysisPrompt(targetLanguage, aiAnalysisDepth, { wordCount, charCount, chineseCharCount }, truncatedContent, url, domain);
    const response = await callAIWithRetry(aiConfig, finalPrompt);
    return parseEnhancedAIResponse(response, content);
}

async function callAIWithRetry(aiConfig, prompt, maxRetries = 2) {
    let lastError = null;
    for (let attempt = 0; attempt <= maxRetries; attempt++) {
        try {
            return await callAI(aiConfig, prompt);
        } catch (error) {
            lastError = error;
            if (error.message.includes('timeout') || error.message.includes('network') || error.message.includes('rate limit')) {
                if (attempt < maxRetries) await new Promise(resolve => setTimeout(resolve, 2000 * Math.pow(2, attempt)));
            } else break;
        }
    }
    throw lastError;
}

function parseEnhancedAIResponse(text, content = '') {
    if (!text) return getDefaultAnalysisResult(content);
    try {
        const jsonMatch = text.match(/\{[\s\S]*\}/);
        if (jsonMatch) {
            const parsed = JSON.parse(jsonMatch[0]);
            
            const validLevels = ['beginner', 'intermediate', 'advanced'];
            const validTypes = ['article', 'tutorial', 'news', 'reference', 'tool', 'entertainment', 'blog', 'documentation', 'research'];
            const validSentiments = ['positive', 'neutral', 'negative'];

            const result = {
                summary: (parsed.summary || '').trim(),
                category: (parsed.category || '').trim(),
                tags: Array.isArray(parsed.tags) ? parsed.tags.map(t => t.trim()).filter(Boolean) : [],
                contentType: validTypes.includes(parsed.contentType?.toLowerCase()) ? parsed.contentType.toLowerCase() : 'article',
                readingLevel: validLevels.includes(parsed.readingLevel?.toLowerCase()) ? parsed.readingLevel.toLowerCase() : 'intermediate',
                keyPoints: Array.isArray(parsed.keyPoints) ? parsed.keyPoints.map(p => p.trim()).filter(Boolean) : [],
                sentiment: validSentiments.includes(parsed.sentiment?.toLowerCase()) ? parsed.sentiment.toLowerCase() : 'neutral',
                estimatedReadTime: typeof parsed.estimatedReadTime === 'number' ? Math.max(1, Math.min(120, parsed.estimatedReadTime)) : calculateEstimatedReadTime(content)
            };

            if (!result.summary) result.summary = chrome.i18n.getMessage('aiSummaryFailedFallback');
            if (!result.category) result.category = chrome.i18n.getMessage('aiUncategorizedFallback');
            if (result.tags.length === 0) result.tags = result.category ? [result.category] : [chrome.i18n.getMessage('aiDefaultTagFallback')];
            
            return result;
        }
    } catch (e) { console.warn("Failed to parse enhanced JSON from AI response:", e); }
    return getDefaultAnalysisResult(content);
}

function calculateEstimatedReadTime(content) {
    if (!content || typeof content !== 'string') return 3;
    const cleanContent = content.trim().replace(/\s+/g, ' ');
    const chineseCharCount = (cleanContent.match(/[\u4e00-\u9fff]/g) || []).length;
    const totalCharCount = cleanContent.length;
    const isChinesePrimary = chineseCharCount / totalCharCount > 0.3;
    let readingTimeMinutes = isChinesePrimary ? Math.ceil(chineseCharCount / 450) : Math.ceil(cleanContent.split(/\s+/).filter(Boolean).length / 250);
    if (cleanContent.includes('code') || cleanContent.includes('function')) readingTimeMinutes = Math.ceil(readingTimeMinutes * 1.5);
    return Math.max(2, Math.min(120, readingTimeMinutes));
}

function getDefaultAnalysisResult(content = '') {
    return { summary: '', category: '', tags: [], contentType: 'article', readingLevel: 'intermediate', keyPoints: [], sentiment: 'neutral', estimatedReadTime: calculateEstimatedReadTime(content) };
}

function extractMetaInfo(html) {
    try {
        const titleMatch = html.match(/<title[^>]*>([^<]+)<\/title>/i);
        const descMatch = html.match(/<meta[^>]*name=["']description["'][^>]*content=["']([^"']+)["'][^>]*>/i);
        const keywordsMatch = html.match(/<meta[^>]*name=["']keywords["'][^>]*content=["']([^"']+)["'][^>]*>/i);
        let metaContent = '';
        if (titleMatch && titleMatch[1]) metaContent += titleMatch[1].trim() + '. ';
        if (descMatch && descMatch[1]) metaContent += descMatch[1].trim() + '. ';
        if (keywordsMatch && keywordsMatch[1]) metaContent += `${chrome.i18n.getMessage('keywordsLabel')}: ${keywordsMatch[1].trim()}. `;
        return metaContent.trim();
    } catch (e) { return ''; }
}

chrome.contextMenus.onClicked.addListener(async (info, tab) => {
    if (info.menuItemId === CONTEXT_MENU_ID) {
        if (!tab || !tab.url || tab.url.startsWith('chrome://')) return;
        const { bookmarkItems = [] } = await chrome.storage.local.get("bookmarkItems");
        if (bookmarkItems.some(b => b.type === 'bookmark' && b.url === tab.url)) return;
        await handleAsyncBookmarkAction("addCurrentPage", { parentId: 'root' }, tab);
    }
});