// Main Background Script - Edge Compatible Version
// Fixed: Context Menu click handler logic (Direct execution instead of message passing)
// Updated: Sync logic to support URL Fallback Lookup based on api5.md

import { EdgeBrowserAdapter } from './browser-adapter.js';

// --- Edge SW Keep Alive ---
function keepAlive() {
    try {
        setInterval(() => chrome.runtime.getPlatformInfo(() => {}), 20 * 1000);
    } catch (e) {
        console.warn("keepAlive error", e);
    }
}
keepAlive();

// Initialize adapter
let adapter;
try {
    adapter = new EdgeBrowserAdapter();
    if (adapter.isEdge) {
        adapter.enableEdgeOptimizations();
    }
} catch (e) {
    console.error("Failed to initialize EdgeBrowserAdapter:", e);
}

// --- API Configuration ---
const API_BASE_URL = 'https://bookmarker-api.aiwetalk.com/api';

// --- Task Queue Configuration ---
let taskQueue = []; 
let isProcessingQueue = false;
let queueGeneration = 0; 
let processingTasks = new Set(); 
const CONCURRENT_LIMIT = 3; 

const CONTEXT_MENU_ID = "bookmark_this_page";

// --- Helper Functions ---
async function getJwt() {
  const { authData } = await chrome.storage.local.get('authData');
  return authData ? authData.token : null;
}

function isTaskInActiveQueue(bookmarkId) {
  return taskQueue.includes(bookmarkId) || processingTasks.has(bookmarkId);
}

async function enqueueTask(bookmarkId) {
    if (isTaskInActiveQueue(bookmarkId)) return false;

    const { bookmarkItems = [] } = await chrome.storage.local.get("bookmarkItems");
    const bookmark = bookmarkItems.find(b => b.clientId === bookmarkId);

    if (bookmark && bookmark.aiStatus === 'processing') {
        await updateLocalBookmark(bookmarkId, { aiStatus: 'processing', aiError: '' });
    }

    taskQueue.push(bookmarkId);
    processTaskQueue(queueGeneration);
    return true;
}

async function updateLocalBookmark(clientId, updates) {
    const data = await chrome.storage.local.get('bookmarkItems');
    const bookmarkItems = data.bookmarkItems || [];
    const idx = bookmarkItems.findIndex(b => b.clientId === clientId);
    if (idx !== -1) {
        const updated = { ...bookmarkItems[idx], ...updates, lastModified: new Date().toISOString() };
        bookmarkItems[idx] = updated;
        await chrome.storage.local.set({ bookmarkItems });
        return updated;
    }
    return null;
}

// -----------------------------
// Core Sync Logic (Updated for URL Fallback)
// -----------------------------
async function syncItemChange(type, payload) {
    const token = await getJwt();
    if (!token) return;

    // 深度复制以避免修改原始对象
    let apiPayload = JSON.parse(JSON.stringify(payload));
    
    if (type === 'add') {
        // 'add' 操作不需要 serverId，等待服务器分配
        delete apiPayload.serverId;
    } else {
        // 'update' 和 'delete' 操作的处理逻辑
        
        // 1. 映射 serverId 到 _id
        if (payload.serverId) {
            apiPayload._id = payload.serverId;
        } else {
            // [关键修改] 如果没有 serverId，显式设置为空字符串，触发服务器的 URL 降级查找机制
            apiPayload._id = ""; 
        }

        // 2. 验证有效性：必须有 _id 或者 (URL + type='bookmark')
        const hasId = !!payload.serverId; // 注意这里判断的是原始 payload 的 serverId
        const hasUrlFallback = apiPayload.type === 'bookmark' && !!apiPayload.url;

        // 如果既没有ID，也不满足URL降级条件，则无法同步
        if (!hasId && !hasUrlFallback) {
            console.warn(`[Sync] Skipping ${type}: Missing both serverId and URL fallback logic.`);
            return;
        }

        // 3. 清理内部字段，只保留 API 需要的字段
        delete apiPayload.clientId;
        delete apiPayload.serverId;
        // 注意：url 和 type 必须保留在 apiPayload 中以支持降级查找
    }

    const change = { type, payload: apiPayload };

    try {
        const response = await fetch(`${API_BASE_URL}/items/sync`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'Authorization': `${token}` },
            body: JSON.stringify([change])
        });

        if (response.ok) {
            const resultData = await response.json();
            // 处理 'add' 操作的回执，更新本地 serverId
            if (type === 'add' && resultData.results?.length > 0) {
                const addResult = resultData.results.find(r => r.operation.payload.clientId === payload.clientId);
                if (addResult?.status === 'success' && addResult.data) {
                    await updateLocalBookmark(payload.clientId, { 
                        serverId: addResult.data._id,
                        ...addResult.data 
                    });
                }
            }
        } else {
            console.error(`[Sync] Failed ${type}:`, response.status);
        }
    } catch (e) {
        console.error("Sync error:", e);
    }
}

// -----------------------------
// AI Processing Logic (Localized)
// -----------------------------

async function getExistingSmartCategories() {
    try {
        const data = await chrome.storage.local.get(['bookmarkItems', 'smartCategoriesConfig']);
        const bookmarks = data.bookmarkItems || [];
        const config = data.smartCategoriesConfig || { categories: {} };
        const categoryMap = new Map();

        bookmarks.forEach(bookmark => {
            if (bookmark.type === 'bookmark' && bookmark.smartCategories) {
                bookmark.smartCategories.forEach(category => {
                    if (!categoryMap.has(category)) {
                        categoryMap.set(category, { name: category, count: 0 });
                    }
                    categoryMap.get(category).count++;
                });
            }
        });

        if (categoryMap.size === 0 && config.categories) {
            Object.keys(config.categories).forEach(cat => {
                if (config.categories[cat].count > 0) {
                    categoryMap.set(cat, { name: cat, count: config.categories[cat].count });
                }
            });
        }
        return Array.from(categoryMap.values()).sort((a, b) => b.count - a.count);
    } catch (error) {
        return [];
    }
}

async function getAnalysisPrompt(targetLanguage, analysisDepth, contentStats, truncatedContent, url, domain) {
    const isChinese = (targetLanguage || '').toLowerCase().includes('chinese');
    
    const existingCategories = await getExistingSmartCategories();
    const categoriesText = existingCategories.length > 0
        ? existingCategories.map(cat => {
            const countText = isChinese ? `${cat.count}个书签` : `${cat.count} bookmarks`;
            return `- ${cat.name} (${countText})`;
        }).join('\n')
        : (isChinese ? '- 暂无现有分类' : '- No existing categories');

    const promptTemplates = {
        en: {
            basic: `Analyze this content and provide a basic JSON with:
- "summary": concise summary under 30 words (in English)
- "category": primary category (in English)
- "tags": array of 3-5 relevant keywords (in English)
- "estimatedReadTime": estimated reading time in minutes (number)
- "smartCategories": array of 1-3 intelligent categories for this content (in English) - REQUIRED`,
            standard: `Analyze this content and provide a JSON with ALL required fields:
- "summary": concise summary under 50 words (in English) - REQUIRED
- "category": primary category (in English) - REQUIRED
- "tags": array of 3-6 relevant keywords/tags (in English) - REQUIRED
- "contentType": type of content (one of: article, tutorial, news, reference, tool, entertainment, blog, documentation)
- "readingLevel": estimated reading difficulty (one of: beginner, intermediate, advanced)
- "estimatedReadTime": estimated reading time in minutes (number)
- "smartCategories": array of 1-3 intelligent categories for this content (in English) - REQUIRED`,
            detailed: `Perform detailed analysis and provide a comprehensive JSON with:
- "summary": detailed summary under 100 words (in English)
- "category": primary category (in English)
- "tags": array of 5-10 relevant keywords/tags (in English)
- "contentType": type of content (one of: article, tutorial, news, reference, tool, entertainment, blog, documentation, research)
- "readingLevel": estimated reading difficulty (one of: beginner, intermediate, advanced)
- "keyPoints": array of 3-5 key takeaways (in English)
- "sentiment": overall sentiment (one of: positive, neutral, negative)
- "estimatedReadTime": estimated reading time in minutes (number)
- "smartCategories": array of 1-3 intelligent categories for this content (in English) - REQUIRED`
        },
        zh_CN: {
            basic: `分析此内容并提供一个基础JSON，包含：
- "summary": 简洁的摘要，30字以内 (使用简体中文)
- "category": 主要分类 (使用简体中文)
- "tags": 3-5个相关关键词的数组 (使用简体中文)
- "estimatedReadTime": 估算的阅读时间（分钟，数字）
- "smartCategories": 1-3个智能分类的数组 (使用简体中文) - 必填`,
            standard: `分析此内容并提供一个包含所有必填字段的JSON：
- "summary": 简洁的摘要，50字以内 (使用简体中文) - 必填
- "category": 主要分类 (使用简体中文) - 必填
- "tags": 3-6个相关关键词/标签的数组 (使用简体中文) - 必填
- "contentType": 内容类型 (必须是以下之一: article, tutorial, news, reference, tool, entertainment, blog, documentation)
- "readingLevel": 阅读难度评估 (必须是以下之一: beginner, intermediate, advanced)
- "estimatedReadTime": 估算的阅读时间（分钟，数字）
- "smartCategories": 1-3个智能分类的数组 (使用简体中文) - 必填`,
            detailed: `对此内容进行详细分析，并提供一个全面的JSON，包含：
- "summary": 详细的摘要，100字以内 (使用简体中文)
- "category": 主要分类 (使用简体中文)
- "tags": 5-10个相关关键词/标签的数组 (使用简体中文)
- "contentType": 内容类型 (必须是以下之一: article, tutorial, news, reference, tool, entertainment, blog, documentation, research)
- "readingLevel": 阅读难度评估 (必须是以下之一: beginner, intermediate, advanced)
- "keyPoints": 3-5个关键要点的数组 (使用简体中文)
- "sentiment": 整体情绪 (必须是以下之一: positive, neutral, negative)
- "estimatedReadTime": 估算的阅读时间（分钟，数字）
- "smartCategories": 1-3个智能分类的数组 (使用简体中文) - 必填`
        }
    };

    const requirements = {
        en: { 
            title: "CRITICAL REQUIREMENTS", 
            rules: `Existing Smart Categories:\n${categoriesText}\n\nSmart Category Rules:\n1. Prioritize selecting 1-3 matching categories from existing list.\n2. If none match, create 1 new category (2-6 words).\n3. Return ONLY valid JSON.` 
        },
        zh_CN: { 
            title: "关键要求", 
            rules: `已有智能分类列表：\n${categoriesText}\n\n智能分类规则：\n1. 优先从已有分类中选择1-3个最匹配的分类。\n2. 如果都不合适，创建1个新分类（2-6个字）。\n3. 只返回有效的JSON。` 
        }
    };

    const langKey = isChinese ? 'zh_CN' : 'en';
    const template = promptTemplates[langKey][analysisDepth] || promptTemplates[langKey]['standard'];
    const req = requirements[langKey];

    return `${template}\n\n${req.title}:\n${req.rules}\n\nContent (Length: ${contentStats.charCount}):\n"${truncatedContent}"\nURL: "${url}"`;
}

function calculateEstimatedReadTime(content) {
    if (!content || typeof content !== 'string') return 3;
    const cleanContent = content.trim();
    const chineseCharCount = (cleanContent.match(/[\u4e00-\u9fff]/g) || []).length;
    const isChinesePrimary = chineseCharCount / cleanContent.length > 0.3;
    let time = isChinesePrimary ? Math.ceil(chineseCharCount / 450) : Math.ceil(cleanContent.split(/\s+/).length / 250);
    return Math.max(1, Math.min(120, time));
}

function getDefaultAnalysisResult(content = '') {
    return { 
        summary: '', category: '', tags: [], contentType: 'article', 
        readingLevel: 'intermediate', keyPoints: [], sentiment: 'neutral', 
        estimatedReadTime: calculateEstimatedReadTime(content), smartCategories: [] 
    };
}

function parseEnhancedAIResponse(text, content = '') {
    if (!text) return getDefaultAnalysisResult(content);
    try {
        const jsonMatch = text.match(/\{[\s\S]*\}/);
        if (jsonMatch) {
            const parsed = JSON.parse(jsonMatch[0]);
            const result = {
                summary: (parsed.summary || '').trim(),
                category: (parsed.category || '').trim(),
                tags: Array.isArray(parsed.tags) ? parsed.tags.filter(Boolean) : [],
                keyPoints: Array.isArray(parsed.keyPoints) ? parsed.keyPoints.filter(Boolean) : [],
                smartCategories: Array.isArray(parsed.smartCategories) ? parsed.smartCategories.filter(Boolean) : [],
                
                contentType: parsed.contentType || 'article',
                readingLevel: parsed.readingLevel || 'intermediate',
                sentiment: parsed.sentiment || 'neutral',
                estimatedReadTime: typeof parsed.estimatedReadTime === 'number' ? parsed.estimatedReadTime : calculateEstimatedReadTime(content)
            };
            return result;
        }
    } catch (e) { 
        console.warn("JSON Parse Error:", e); 
    }
    return getDefaultAnalysisResult(content);
}

async function enhancedCallAI(aiConfig, content, url) {
    const { language: langCode = 'en' } = await chrome.storage.local.get('language');
    const isChinese = (langCode || '').toLowerCase().startsWith('zh');
    const targetLanguage = isChinese ? 'Simplified Chinese' : 'English';
    const { aiAnalysisDepth = 'standard' } = await chrome.storage.local.get('aiAnalysisDepth');
    
    const wordCount = (content || '').split(/\s+/).filter(Boolean).length;
    const charCount = (content || '').length;
    const chineseCharCount = ((content || '').match(/[\u4e00-\u9fff]/g) || []).length;
    let contentLength = { basic: 3000, standard: 5000, detailed: 8000 }[aiAnalysisDepth] || 5000;
    const truncatedContent = (content || '').substring(0, contentLength);
    
    let domain = 'unknown'; 
    try { domain = new URL(url).hostname.replace('www.', ''); } catch (e) {}

    const finalPrompt = await getAnalysisPrompt(targetLanguage, aiAnalysisDepth, { wordCount, charCount, chineseCharCount }, truncatedContent, url, domain);
    const responseText = await callAIWithRetry(aiConfig, finalPrompt);
    return parseEnhancedAIResponse(responseText, content);
}

async function callAI(aiConfig, prompt) {
    let apiUrl, body;
    const headers = { 'Content-Type': 'application/json', 'Authorization': `Bearer ${aiConfig.apiKey}` };
    const provider = (aiConfig.provider || '').toLowerCase();
    
    const commonParams = { max_tokens: 1500, temperature: 0.2 };
    const messages = [{ role: 'user', content: prompt }];

    if (provider === 'openai') {
        apiUrl = 'https://api.openai.com/v1/chat/completions';
        body = { model: aiConfig.model, messages, response_format: { type: "json_object" }, ...commonParams };
    } else if (provider.includes('deepseek')) {
        apiUrl = 'https://api.deepseek.com/v1/chat/completions';
        body = { model: aiConfig.model, messages, ...commonParams };
    } else if (provider === 'openrouter') {
        apiUrl = 'https://openrouter.ai/api/v1/chat/completions';
        headers['HTTP-Referer'] = 'https://github.com/CaspianLight/Smart-Bookmarker';
        body = { model: aiConfig.model, messages, ...commonParams };
    } else {
        throw new Error("Unsupported AI provider");
    }

    const response = await fetch(apiUrl, { method: 'POST', headers, body: JSON.stringify(body) });
    if (!response.ok) {
        const errorBody = await response.json().catch(() => ({}));
        throw new Error(`API request failed: ${errorBody.error?.message || response.status}`);
    }
    const data = await response.json();
    return data.choices?.[0]?.message?.content || "";
}

async function callAIWithRetry(aiConfig, prompt, maxRetries = 2) {
    let lastError;
    for (let i = 0; i <= maxRetries; i++) {
        try {
            return await callAI(aiConfig, prompt);
        } catch (e) {
            lastError = e;
            const msg = (e.message || '').toLowerCase();
            if ((msg.includes('timeout') || msg.includes('rate limit')) && i < maxRetries) {
                await new Promise(r => setTimeout(r, 2000 * Math.pow(2, i)));
                continue;
            }
            break;
        }
    }
    throw lastError;
}

// -----------------------------
// Task Processing
// -----------------------------
async function processBookmarkWithAI(bookmarkClientId) {
    const { bookmarkItems = [] } = await chrome.storage.local.get("bookmarkItems");
    const bookmark = bookmarkItems.find(b => b.clientId === bookmarkClientId);
    if (!bookmark) return;

    await updateLocalBookmark(bookmarkClientId, { aiStatus: 'processing', aiError: '' });

    const { aiConfig } = await chrome.storage.local.get("aiConfig");
    if (!aiConfig || !aiConfig.apiKey) {
        await updateLocalBookmark(bookmarkClientId, { aiStatus: 'failed', aiError: "API Key missing" });
        return;
    }

    let pageContent = '';
    
    // 1. Active Tab Extraction
    try {
        const tabsList = await chrome.tabs.query({ url: bookmark.url, status: 'complete' });
        if (tabsList?.[0]) {
            const results = await chrome.scripting.executeScript({
                target: { tabId: tabsList[0].id },
                func: () => document.body.innerText
            }).catch(() => null);
            if (results?.[0]?.result) pageContent = results[0].result;
        }
    } catch (e) { /* ignore */ }

    // 2. Fetch Fallback
    if (!pageContent || pageContent.length < 50) {
        try {
            const resp = await fetch(bookmark.url);
            const text = await resp.text();
            pageContent = text.replace(/<script[^>]*>[\s\S]*?<\/script>/gi, '')
                              .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, '')
                              .replace(/<[^>]+>/g, ' ');
        } catch (e) { /* ignore */ }
    }

    // 3. Metadata Fallback
    if (!pageContent || pageContent.length < 50) {
        pageContent = `${bookmark.title || ''}. URL: ${bookmark.url}`;
    }

    try {
        const enhancedResult = await enhancedCallAI(aiConfig, pageContent, bookmark.url);

        if (enhancedResult.smartCategories?.length) {
            await updateSmartCategoriesConfig(enhancedResult.smartCategories);
        }

        const smartData = {
            smartCategories: enhancedResult.smartCategories,
            smartCategoriesUpdated: new Date().toISOString(),
            smartCategoriesVersion: 1,
            smartCategoriesConfidence: 0.8
        };

        const updated = await updateLocalBookmark(bookmarkClientId, {
            ...enhancedResult,
            ...smartData,
            aiStatus: 'completed',
            aiError: ''
        });

        // [Updated] 同步 AI 分析结果，支持 serverId 或 URL Fallback
        const shouldSync = updated?.serverId || (updated?.type === 'bookmark' && updated?.url);
        if (shouldSync) {
            await syncItemChange('update', updated);
        }
    } catch (error) {
        console.error("AI Task Failed:", error);
        await updateLocalBookmark(bookmarkClientId, { aiStatus: 'failed', aiError: error.message });
    }
}

async function updateSmartCategoriesConfig(newCategories) {
    try {
        const data = await chrome.storage.local.get('smartCategoriesConfig');
        const config = data.smartCategoriesConfig || { enabled: true, categories: {} };
        let changed = false;
        newCategories.forEach(cat => {
            if (!config.categories[cat]) {
                config.categories[cat] = { count: 1, created: new Date().toISOString() };
                changed = true;
            } else {
                config.categories[cat].count++;
                changed = true;
            }
        });
        if (changed) await chrome.storage.local.set({ smartCategoriesConfig: config });
    } catch (e) {}
}

async function processTaskQueue(generation) {
    if (generation !== queueGeneration) return;
    if (isProcessingQueue || taskQueue.length === 0) {
        isProcessingQueue = false;
        return;
    }

    isProcessingQueue = true;
    const tasks = taskQueue.splice(0, CONCURRENT_LIMIT);
    tasks.forEach(id => processingTasks.add(id));

    const promises = tasks.map(id => processBookmarkWithAI(id));
    await Promise.allSettled(promises);

    tasks.forEach(id => processingTasks.delete(id));
    
    if (generation === queueGeneration) {
        isProcessingQueue = false;
        if (taskQueue.length > 0) setTimeout(() => processTaskQueue(generation), 1000);
    }
}

// -----------------------------
// Message Listeners
// -----------------------------
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
    (async () => {
        try {
            const { action, data, id } = request;

            // --- 1. Ping ---
            if (action === "ping") {
                sendResponse({ status: "success" });
                return;
            }

            // --- 2. Add Current Page (Popup) ---
            if (action === "addCurrentPage") {
                const tabsList = await chrome.tabs.query({ active: true, currentWindow: true });
                const currentTab = tabsList?.[0];
                
                if (!currentTab?.url || currentTab.url.startsWith('chrome://')) {
                    sendResponse({ status: "no_active_tab" }); return;
                }

                const { bookmarkItems = [] } = await chrome.storage.local.get("bookmarkItems");
                if (bookmarkItems.some(b => b.url === currentTab.url)) {
                    sendResponse({ status: "duplicate" }); return;
                }
/*
                const newBookmark = {
                    clientId: crypto.randomUUID(),
                    serverId: null,
                    type: "bookmark",
                    url: currentTab.url,
                    title: currentTab.title || "Untitled",
                    parentId: data?.parentId || "root",
                    dateAdded: new Date().toISOString(),
                    lastModified: new Date().toISOString(),
                    aiStatus: "pending",
                    smartCategories: [],
                    clickCount: 0
                };*/

                const newBookmark = {
                    // --- NEW DATA MODEL ---
                    clientId: crypto.randomUUID(), // The stable, local-only, permanent identifier.
                    serverId: null,                // The server's ID, will be filled after sync.
                    // ---
                    type: 'bookmark',
                    url: tab.url,
                    title: tab.title || 'Untitled',
                    parentId: data.parentId || 'root',
                    dateAdded: new Date().toISOString(),
                    lastModified: new Date().toISOString(), // Corrected this line
                    isStarred: false,
                    notes: '',
                    summary: '',
                    aiStatus: 'pending',
                    contentType: '',
                    estimatedReadTime: null,
                    readingLevel: '',
                    // === 新增智能分类字段 ===
                    smartCategories: [],
                    smartCategoriesUpdated: null,
                    smartCategoriesVersion: 0,
                    smartCategoriesConfidence: null,
                    // === 新增点击统计字段 ===
                    clickCount: 0,                // 点击次数统计
                    lastAccessed: null            // 最后访问时间
                };

                await chrome.storage.local.set({ bookmarkItems: [newBookmark, ...bookmarkItems] });
                await enqueueTask(newBookmark.clientId);
                await syncItemChange('add', newBookmark);
                
                sendResponse({ status: "queued" });
                return;
            }

            // --- 3. Delete Bookmark (Updated) ---
            if (action === "deleteBookmark") {
                const targetId = id || request.clientId || data?.id;
                if (!targetId) { sendResponse({ status: "error", message: "ID missing" }); return; }

                const { bookmarkItems = [] } = await chrome.storage.local.get("bookmarkItems");
                const itemToDelete = bookmarkItems.find(i => i.clientId === targetId);

                // [关键修改] 支持 serverId 或 (URL+Bookmark) 的删除同步
                if (itemToDelete) {
                    const shouldSync = itemToDelete.serverId || (itemToDelete.type === 'bookmark' && itemToDelete.url);
                    if (shouldSync) {
                        await syncItemChange('delete', { 
                            serverId: itemToDelete.serverId,
                            url: itemToDelete.url,
                            type: itemToDelete.type
                        });
                    }
                }

                let toDelete = new Set([targetId]);
                let currentSize;
                do {
                    currentSize = toDelete.size;
                    const parents = Array.from(toDelete);
                    bookmarkItems.forEach(item => {
                        if (parents.includes(item.parentId)) toDelete.add(item.clientId);
                    });
                } while (toDelete.size > currentSize);

                const updatedItems = bookmarkItems.filter(item => !toDelete.has(item.clientId));
                await chrome.storage.local.set({ bookmarkItems: updatedItems });
                
                sendResponse({ status: "success" });
                return;
            }

            // --- 4. Toggle Star (Updated) ---
            if (action === "toggleStar") {
                const targetId = id || data?.id;
                const { bookmarkItems = [] } = await chrome.storage.local.get("bookmarkItems");
                const item = bookmarkItems.find(b => b.clientId === targetId);
                
                if (item) {
                    const isStarred = !item.isStarred;
                    const updated = await updateLocalBookmark(targetId, { isStarred });
                    
                    // [关键修改] 支持 serverId 或 (URL+Bookmark) 的更新同步
                    const shouldSync = updated?.serverId || (updated?.type === 'bookmark' && updated?.url);
                    if (shouldSync) {
                        await syncItemChange('update', { 
                            serverId: updated.serverId, 
                            isStarred,
                            url: updated.url, // 必须携带 url 以支持降级查找
                            type: updated.type 
                        });
                    }
                    sendResponse({ status: "success", isStarred });
                } else {
                    sendResponse({ status: "error", message: "Not found" });
                }
                return;
            }

            // --- 5. Update Notes (Updated) ---
            if (action === "updateBookmarkNotes") {
                const targetId = id || data?.id;
                const notes = data?.notes || request.notes || "";
                
                const updated = await updateLocalBookmark(targetId, { notes });
                
                // [关键修改] 支持 serverId 或 (URL+Bookmark) 的更新同步
                const shouldSync = updated?.serverId || (updated?.type === 'bookmark' && updated?.url);
                if (shouldSync) {
                    await syncItemChange('update', { 
                        serverId: updated.serverId, 
                        notes,
                        url: updated.url, // 必须携带 url 以支持降级查找
                        type: updated.type
                    });
                }
                sendResponse({ status: updated ? "success" : "error" });
                return;
            }

            // --- 6. Regenerate AI Data ---
            if (action === "regenerateAiData") {
                const bid = id || request.bookmarkId;
                if (bid) {
                    await updateLocalBookmark(bid, { aiStatus: 'pending', aiError: '' });
                    await enqueueTask(bid);
                    sendResponse({ status: "queued" });
                } else {
                    sendResponse({ status: "error", message: "ID missing" });
                }
                return;
            }

            // --- 7. Sync AI Config ---
            if (action === "syncAIConfig") {
                sendResponse({ status: "success" });
                return;
            }
            
            // --- 8. Update Click Count (FIX) ---
            if (action === "updateBookmarkClickCount") {
                const targetUrl = data?.url || request.url;
                if (!targetUrl) { sendResponse({ status: "error", message: "URL missing" }); return; }

                const { bookmarkItems = [] } = await chrome.storage.local.get("bookmarkItems");
                // 通过 URL 查找书签
                const item = bookmarkItems.find(b => b.type === 'bookmark' && b.url === targetUrl);

                if (item) {
                    // 计算新的点击次数
                    const newCount = (item.clickCount || 0) + 1;
                    
                    // 更新本地书签数据
                    const updated = await updateLocalBookmark(item.clientId, { 
                        clickCount: newCount 
                    });

                    // [可选] 同步点击次数到服务器 (使用现有的同步逻辑)
                    const shouldSync = updated?.serverId || (updated?.type === 'bookmark' && updated?.url);
                    if (shouldSync) {
                        await syncItemChange('update', { 
                            serverId: updated.serverId, 
                            url: updated.url, // 必须携带 url 以支持降级查找
                            type: updated.type,
                            clickCount: newCount
                        });
                    }
                    sendResponse({ status: "success", clickCount: newCount });
                } else {
                    sendResponse({ status: "error", message: "Bookmark not found" });
                }
                return;
            }
            
            // Forward others
            sendResponse({ status: "unknown_action" });

        } catch (e) {
            console.error("Message Handler Error:", e);
            sendResponse({ status: "error", message: e.message });
        }
    })();
    return true; 
});

// Context Menu (Direct Execution Fix)
chrome.runtime.onInstalled.addListener(() => {
    chrome.contextMenus.create({
        id: CONTEXT_MENU_ID,
        title: "Smart Bookmark This Page",
        contexts: ['page']
    });
});

chrome.contextMenus.onClicked.addListener(async (info, tab) => {
    if (info.menuItemId === CONTEXT_MENU_ID) {
        if (!tab || !tab.url || tab.url.startsWith('chrome://') || tab.url.startsWith('edge://')) return;

        const { bookmarkItems = [] } = await chrome.storage.local.get("bookmarkItems");
        if (bookmarkItems.some(b => b.url === tab.url)) {
            console.log("Duplicate bookmark found");
            return;
        }

        const newBookmark = {
            clientId: crypto.randomUUID(),
            serverId: null,
            type: "bookmark",
            url: tab.url,
            title: tab.title || "Untitled",
            parentId: "root",
            dateAdded: new Date().toISOString(),
            lastModified: new Date().toISOString(),
            aiStatus: "pending",
            smartCategories: [],
            clickCount: 0
        };

        await chrome.storage.local.set({ bookmarkItems: [newBookmark, ...bookmarkItems] });
        await enqueueTask(newBookmark.clientId);
        await syncItemChange('add', newBookmark);
    }
});

console.log('Edge Background Service Worker Loaded (Final with URL Fallback)');