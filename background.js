const isSidePanelSupported = typeof chrome.sidePanel !== 'undefined';
console.log(`Side Panel API Supported: ${isSidePanelSupported}`);

// --- API Configuration ---
const API_BASE_URL = 'https://bookmarker-api.aiwetalk.com/api';

// --- Task Queue Configuration ---
let taskQueue = []; // Now stores only bookmark IDs
let isProcessingQueue = false;
let queueGeneration = 0; // 新增：任务世代计数器
const CONCURRENT_LIMIT = 3; // Simultaneously process 3 AI tasks

// --- Context Menu ID ---
const CONTEXT_MENU_ID = "bookmark_this_page";

// --- Helper to get JWT from storage ---
async function getJwt() {
    const { authData } = await chrome.storage.local.get('authData');
    const token = authData ? authData.token : null;
    if (!token) {
        console.log("JWT Token not found. User is not authenticated.");
    }
    return token;
}


// --- Enqueue Task Function ---
async function enqueueTask(bookmarkId) {
    if (taskQueue.includes(bookmarkId)) {
        return false;
    }

    const { bookmarkItems = [] } = await chrome.storage.local.get("bookmarkItems");
    const bookmark = bookmarkItems.find(b => b.id === bookmarkId);
    if (bookmark && bookmark.aiStatus === 'processing') {
        return false;
    }

    if (bookmark) {
        const index = bookmarkItems.findIndex(b => b.id === bookmarkId);
        if (index !== -1) {
            bookmarkItems[index].aiStatus = 'processing';
            bookmarkItems[index].aiError = '';
            await chrome.storage.local.set({ bookmarkItems });
        }
    }

    taskQueue.push(bookmarkId);
    processTaskQueue(queueGeneration);
    return true;
}

// --- Lifecycle Events ---
chrome.runtime.onInstalled.addListener(() => {
    chrome.storage.local.get('bookmarkItems', (data) => {
        if (!data.bookmarkItems) {
            chrome.storage.local.set({ bookmarkItems: [] });
        }
    });
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
            case 'getI18nMessages': {
                const { lang } = request;
                const url = chrome.runtime.getURL(`_locales/${lang}/messages.json`);
                fetch(url)
                    .then(response => response.json())
                    .then(messages => sendResponse({ messages }))
                    .catch(error => {
                        console.error(`Failed to fetch messages for lang: ${lang}`, error);
                        sendResponse({ messages: {} });
                    });
                return true; // Indicates async response
            }
            case 'openLearningAssistant': {
                const { bookmark } = request;
                if (!bookmark || !bookmark.url) {
                    sendResponse({ status: "error", message: "Invalid bookmark data" });
                    return;
                }

                const tab = await chrome.tabs.create({ url: bookmark.url });
                await chrome.storage.session.set({ [tab.id]: bookmark.clientId });

                if (isSidePanelSupported) {
                    await chrome.sidePanel.setOptions({ tabId: tab.id, path: 'sidepanel.html', enabled: true });
                    await chrome.sidePanel.open({ tabId: tab.id });
                }
                sendResponse({ status: "opening" });
                break;
            }
            case 'getBookmarkIdForCurrentTab': {
                const tabId = sender.tab?.id;
                if (tabId) {
                    const data = await chrome.storage.session.get(tabId.toString());
                    sendResponse({ bookmarkId: data[tabId] });
                } else {
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
            case 'askAboutBookmarkInTab': {
//                const { bookmarkId, question } = request;
//                const { bookmarkId: clientId } = request; // The received ID is the clientId
                  const { bookmarkId: clientId, question } = request;

                //const { bookmarkItems = [], aiConfig } = await chrome.storage.local.get(["bookmarkItems", "aiConfig"]);
                //const { bookmarkItems = [] } = await chrome.storage.local.get(["bookmarkItems", "aiConfig"]);
                const { bookmarkItems = [], aiConfig } = await chrome.storage.local.get(["bookmarkItems", "aiConfig"]);
                //const bookmark = bookmarkItems.find(b => b.id === bookmarkId);
                const bookmark = bookmarkItems.find(b => b.clientId === clientId); // Find by clientId

                if (!bookmark) {
                    sendResponse({ error: "Bookmark data not found." });
                    return;
                }
                if (!aiConfig || !aiConfig.apiKey) {
                    sendResponse({ error: chrome.i18n.getMessage("errorApiKeyMissing") });
                    return;
                }

                const pageContent = await getPageContent(bookmark.url);
                if (!pageContent || pageContent.trim().length < 50) {
                    sendResponse({ error: "Cannot get enough content to answer the question." });
                    return;
                }

                const prompt = chrome.i18n.getMessage('prompt_ask_about_bookmark_in_tab', [pageContent.substring(0, 8000), question]);

                const answer = await callAI(aiConfig, prompt);

                if (answer && answer.trim() !== '') {
                    sendResponse({ answer: answer });
                } else {
                    sendResponse({ error: "AI failed to return a valid answer. It might be a temporary issue, please try again later." });
                }
                break;
            }
            case 'generateQuizInTab': {
//                const { bookmarkId } = request;
//                const { bookmarkItems = [], aiConfig } = await chrome.storage.local.get(["bookmarkItems", "aiConfig"]);
//                const bookmark = bookmarkItems.find(b => b.id === bookmarkId);

                const { bookmarkId: clientId } = request; // The received ID is the clientId
//                const { bookmarkItems = [] } = await chrome.storage.local.get(["bookmarkItems", "aiConfig"]);
                const { bookmarkItems = [], aiConfig } = await chrome.storage.local.get(["bookmarkItems", "aiConfig"]);                
                const bookmark = bookmarkItems.find(b => b.clientId === clientId); // Find by clientId

                if (!bookmark) {
                    sendResponse({ error: "Bookmark data not found." });
                    return;
                }
                if (!aiConfig || !aiConfig.apiKey) {
                    sendResponse({ error: chrome.i18n.getMessage("errorApiKeyMissing") });
                    return;
                }

                const pageContent = await getPageContent(bookmark.url);
                if (!pageContent || pageContent.trim().length < 100) {
                    sendResponse({ error: "Cannot get enough content to generate a quiz." });
                    return;
                }

                const prompt = chrome.i18n.getMessage('prompt_generate_quiz_in_tab', [pageContent.substring(0, 8000)]);

                try {
                    const quizDataStr = await callAI(aiConfig, prompt);
                    const jsonMatch = quizDataStr.match(/\{[\s\S]*\}/);
                    if (jsonMatch) {
                        const parsedJson = JSON.parse(jsonMatch[0]);
                        if (parsedJson && parsedJson.quiz) {
                            sendResponse({ quiz: parsedJson.quiz });
                        } else {
                            throw new Error("The 'quiz' field is missing from the AI's JSON response.");
                        }
                    } else {
                        throw new Error("No valid JSON object found in the AI's response.");
                    }
                } catch (e) {
                    console.error("Failed to generate or parse quiz:", e);
                    sendResponse({ error: "AI returned a format error, cannot parse quiz content." });
                }
                break;
            }
            case 'initiateMergeSync': {
                initiateMergeSync().then(sendResponse);
                return true;
            }
            case 'addCurrentPage': {
                (async () => {
                    try {
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

                        await handleAsyncBookmarkAction(action, data || { parentId: 'root' }, currentTab);
                        //await syncItemChange('add', newBookmark);
                        sendResponse({ status: "queued" });

                    } catch (e) {
                        console.error('Error adding current page:', e);
                        sendResponse({ status: 'error', message: e.message });
                    }
                })();
                return true;
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

                    const newBookmark = {
                        clientId: crypto.randomUUID(), // Stable, local-only ID
                        serverId: null,                // Server ID, to be filled after sync
                        parentId: 'root',
                        title: title || 'Untitled',
                        url,
                        dateAdded: new Date().toISOString(),
                        lastModified: new Date().toISOString(),
                        type: 'bookmark',
                        isStarred: false,
                        category,
                        summary,
                        tags,
                        aiStatus: 'pending',
                        notes: '',
                        contentType: '', // Added new field with default value
                        estimatedReadTime: null, // Added new field with default value
                        readingLevel: '' // Added new field with default value
                    };

                    bookmarkItems.unshift(newBookmark);
                    await chrome.storage.local.set({ bookmarkItems });
                    await enqueueTask(newBookmark.clientId); // Enqueue with clientId
                    await syncItemChange('add', newBookmark); // Sync the new item
                    sendResponse({ status: "success", message: chrome.i18n.getMessage("taskQueued") });

                } catch (error) {
                    sendResponse({ status: "error", message: error.message });
                }
                break;
            }
            case 'deleteBookmark': {
                const { id: clientId } = request; // The 'id' from the frontend is now the clientId
                const { bookmarkItems = [] } = await chrome.storage.local.get("bookmarkItems");
                const itemToDelete = bookmarkItems.find(item => item.clientId === clientId);

                if (itemToDelete && itemToDelete.serverId) {
                    // Only attempt to sync a delete if the item has a serverId
                    await syncItemChange('delete', { serverId: itemToDelete.serverId });
                }

                // Cascade delete logic using clientId
                let itemsToDeleteSet = new Set([clientId]);
                let currentSize;
                do {
                    currentSize = itemsToDeleteSet.size;
                    const parentIds = Array.from(itemsToDeleteSet);
                    // Folders also have clientIds, so parentId will be a clientId
                    bookmarkItems.forEach(item => { 
                        if (parentIds.includes(item.parentId)) {
                            itemsToDeleteSet.add(item.clientId); 
                        }
                    });
                } while (itemsToDeleteSet.size > currentSize);

                const updatedItems = bookmarkItems.filter(item => !itemsToDeleteSet.has(item.clientId));
                await chrome.storage.local.set({ bookmarkItems: updatedItems });
                sendResponse({ status: "success" });
                break;
            }
            case 'updateBookmarkNotes': {
                const { id: clientId, notes } = request;
                const updatedBookmark = await updateLocalBookmark(clientId, { notes });
                if (updatedBookmark) {
                    if (updatedBookmark.serverId) { // Only sync if it exists on the server
                        await syncItemChange('update', { 
                            serverId: updatedBookmark.serverId, 
                            notes: updatedBookmark.notes, 
                            lastModified: updatedBookmark.lastModified 
                        });
                    }
                    sendResponse({ status: 'success' });
                } else {
                    sendResponse({ status: 'error', message: 'Bookmark not found' });
                }
                break;
            }
            case 'toggleStar': {
                const { id: clientId } = request;
                const { bookmarkItems = [] } = await chrome.storage.local.get("bookmarkItems");
                const bookmark = bookmarkItems.find(b => b.clientId === clientId);
                if (bookmark) {
                    const isStarred = !bookmark.isStarred;
                    const updatedBookmark = await updateLocalBookmark(clientId, { isStarred });
                    if (updatedBookmark && updatedBookmark.serverId) { // Only sync if it exists on the server
                        await syncItemChange('update', { 
                            serverId: updatedBookmark.serverId, 
                            isStarred: updatedBookmark.isStarred, 
                            lastModified: updatedBookmark.lastModified 
                        });
                    }
                    sendResponse({ status: "success", isStarred });
                } else {
                    sendResponse({ status: "error", message: "Bookmark not found" });
                }
                break;
            }
            case 'importBrowserBookmarks': {
                importBrowserBookmarks(sendResponse).catch(err => {
                    console.error("Error caught in handleMessages for import:", err);
                    sendResponse({ status: 'error', message: err.message });
                });
                return true; // 告诉 Chrome 扩展，我们将异步地调用 sendResponse
            }
            case 'parseHTML': {
                const text = await parseWithOffscreen(request.html);
                sendResponse({ text: text });
                break;
            }
            case 'forceRestartAiQueue': {
                (async () => {
                    const restartedCount = await forceRestartAiQueue();
                    sendResponse({ status: 'success', restartedCount });
                })();
                return true; // Keep channel open for async response
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

/**
 * 导入浏览器书签的主函数。
 * 严格遵循“先上传文件夹，再上传书签”的两步法，从根本上解决父子关系同步问题。
 * @param {function} sendResponse - 用于向调用方返回结果的回调函数。
 */
async function importBrowserBookmarks(sendResponse) {
    try {
        console.log("Starting final, simplified two-step import process...");

        // --- 1. 数据准备 (不变) ---
        const { bookmarkItems: currentItems = [] } = await chrome.storage.local.get("bookmarkItems");
        const newFolders = [];
        const newBookmarks = [];
        // ... [此处省略与上一版相同的、完整的数据准备逻辑] ...
        const existingUrlSet = new Set(currentItems.filter(i => i.type === 'bookmark').map(i => i.url));
        const serverIdToClientIdMap = new Map();
        currentItems.forEach(item => {
            if (item.serverId && item.clientId) serverIdToClientIdMap.set(item.serverId, item.clientId);
        });
        const folderMap = new Map();
        currentItems.forEach(item => {
            if (item.type === 'folder') {
                let parentClientId = item.parentId;
                if (parentClientId !== 'root' && serverIdToClientIdMap.has(parentClientId)) {
                    parentClientId = serverIdToClientIdMap.get(parentClientId);
                }
                const key = `${parentClientId}-${item.title}`;
                folderMap.set(key, { clientId: item.clientId, serverId: item.serverId });
            }
        });
        const processNode = (node, parentInfo) => {
            if (node.children) {
                let nextParentInfo;
                const folderTitle = node.title || 'Unnamed Folder';
                const folderMapKey = `${parentInfo.clientId}-${folderTitle}`;
                if (folderMap.has(folderMapKey)) {
                    nextParentInfo = folderMap.get(folderMapKey);
                } else {
                    const newFolder = {
                        clientId: crypto.randomUUID(), parentId: parentInfo.clientId, title: folderTitle, type: 'folder',
                        dateAdded: new Date(node.dateAdded || Date.now()).toISOString(), lastModified: new Date(node.dateAdded || Date.now()).toISOString(), notes: ''
                    };
                    newFolders.push(newFolder);
                    nextParentInfo = { clientId: newFolder.clientId, serverId: null };
                    folderMap.set(folderMapKey, nextParentInfo);
                }
                node.children.forEach(child => processNode(child, nextParentInfo));
            } else if (node.url) {
                if (node.url.startsWith('javascript:') || node.url.startsWith('chrome:')) return;
                if (existingUrlSet.has(node.url)) return;
                const newBookmark = {
                    clientId: crypto.randomUUID(), parentId: parentInfo.clientId, title: node.title || 'No Title',
                    url: node.url, type: 'bookmark', isStarred: false, summary: '', tags: [], aiStatus: 'pending',
                    notes: '', contentType: '', estimatedReadTime: null, readingLevel: ''
                };
                newBookmarks.push(newBookmark);
            }
        };
        const [rootNode] = await chrome.bookmarks.getTree();
        if (rootNode && rootNode.children) {
            rootNode.children.forEach(childNode => processNode(childNode, { clientId: 'root' }));
        }
        const totalNewItems = newFolders.length + newBookmarks.length;
        if (totalNewItems === 0) {
            sendResponse({ status: "success", count: 0 });
            return;
        }

        // --- 2. 第一步：上传文件夹并更新内存中的 serverId ---
        const translationMap = new Map();
        currentItems.forEach(item => {
            if (item.type === 'folder' && item.clientId && item.serverId) {
                translationMap.set(item.clientId, item.serverId);
            }
        });
        if (newFolders.length > 0) {
            const folderChanges = newFolders.map(folder => ({ type: 'add', payload: folder }));
            const token = await getJwt();
            const response = await fetch(`${API_BASE_URL}/items/sync`, { body: JSON.stringify(folderChanges), method: 'POST', headers: { 'Content-Type': 'application/json', 'Authorization': `${token}` } });
            if (!response.ok) throw new Error("Failed to upload folders.");
            const results = await response.json();
            results.results?.forEach(res => {
                if (res.status === 'success' && res.operation.type === 'add') {
                    const clientId = res.operation.payload.clientId;
                    const serverData = res.data;
                    translationMap.set(clientId, serverData._id);
                    const folderIndex = newFolders.findIndex(f => f.clientId === clientId);
                    if (folderIndex !== -1) {
                        newFolders[folderIndex] = { ...newFolders[folderIndex], ...serverData, serverId: serverData._id };
                    }
                }
            });
        }

        // --- 3. 第二步：上传书签并更新内存中的 serverId ---
        if (newBookmarks.length > 0) {
            const bookmarkChanges = newBookmarks.map(bm => ({
                type: 'add',
                payload: { ...bm, parentId: translationMap.get(bm.parentId) || bm.parentId }
            }));
            const chunkSize = 50;
            const token = await getJwt();
            for (let i = 0; i < bookmarkChanges.length; i += chunkSize) {
                const chunk = bookmarkChanges.slice(i, i + chunkSize);
                const response = await fetch(`${API_BASE_URL}/items/sync`, { body: JSON.stringify(chunk), method: 'POST', headers: { 'Content-Type': 'application/json', 'Authorization': `${token}` } });
                if (!response.ok) throw new Error("Failed to upload a bookmark chunk.");
                const results = await response.json();
                results.results?.forEach(res => {
                    if (res.status === 'success' && res.operation.type === 'add') {
                        const clientId = res.operation.payload.clientId;
                        const serverData = res.data;
                        const bookmarkIndex = newBookmarks.findIndex(b => b.clientId === clientId);
                        if (bookmarkIndex !== -1) {
                            newBookmarks[bookmarkIndex] = { ...newBookmarks[bookmarkIndex], ...serverData, serverId: serverData._id };
                        }
                    }
                });
            }
        }

        // --- 4. 最终化：在内存中整合所有数据，并进行最终的 parentId 统一 ---
        console.log("Finalizing: Merging data in memory and unifying parentIds...");
        
        // a. 合并所有数据源：已存在的、新文件夹、新书签
        const allItems = [...currentItems, ...newFolders, ...newBookmarks];

        // b. 创建一个包含所有项目ID的最终映射表
        const finalTranslationMap = new Map();
        allItems.forEach(item => {
            if(item.clientId && item.serverId) {
                finalTranslationMap.set(item.clientId, item.serverId);
            }
        });

        // c. 遍历所有项目，统一 parentId
        const finalItemsToStore = allItems.map(item => {
            let finalParentId = item.parentId;
            if (finalParentId && finalParentId !== 'root' && finalTranslationMap.has(finalParentId)) {
                finalParentId = finalTranslationMap.get(finalParentId);
            }
            return { ...item, parentId: finalParentId };
        });

        // d. 将最终的、完全正确的数据一次性写入存储
        await chrome.storage.local.set({ bookmarkItems: finalItemsToStore });
        console.log("Local storage has been updated with final, consistent data.");

        // --- 5. 创建AI任务 ---
        // 这一步现在可以安全地执行，因为存储中的 clientId 是正确的
        const clientIdsToEnqueue = newBookmarks.map(b => b.clientId);
        if (clientIdsToEnqueue.length > 0) {
            taskQueue.push(...clientIdsToEnqueue);
            processTaskQueue(queueGeneration);
        }

        sendResponse({ status: "success", count: totalNewItems });

    } catch (error) {
        console.error("Critical error during the import process:", error);
        sendResponse({ status: "error", message: error.message });
    }
}

/**
 * Sends a single, specific change (add, update, or delete) to the server's batch sync endpoint.
 * This function is designed for real-time synchronization of individual actions.
 * It also handles the crucial process of populating the `serverId` for newly added bookmarks.
 *
 * @param {('add'|'update'|'delete')} type - The type of operation.
 * @param {object} payload - The bookmark data associated with the operation.
 * - For 'add', it must contain a `clientId`.
 * - For 'update'/'delete', it must contain a `serverId`.
 */
async function syncItemChange(type, payload) {
    const token = await getJwt();
    if (!token) {
        console.log("Sync skipped: User not authenticated.");
        return;
    }

    let apiPayload = JSON.parse(JSON.stringify(payload));
    
    if (type === 'add') {
        delete apiPayload.serverId;
    } else {
        if (!payload.serverId) {
            console.warn("Sync aborted for update/delete: serverId is missing.", payload);
            return;
        }
        apiPayload._id = payload.serverId;
        delete apiPayload.clientId;
        delete apiPayload.serverId;
    }

    const change = { type, payload: apiPayload };

    try {
        // MODIFICATION: Updated endpoint from /bookmarks/sync to /items/sync
        const response = await fetch(`${API_BASE_URL}/items/sync`, {
            method: 'POST',
            headers: { 
                'Content-Type': 'application/json',
                'Authorization': `${token}`
            },
            body: JSON.stringify([change])
        });

        if (response.ok) {
            const resultData = await response.json();
            
            if (type === 'add' && resultData.results && resultData.results.length > 0) {
                const addResult = resultData.results.find(r => r.operation.payload.clientId === payload.clientId);
                
                if (addResult && addResult.status === 'success' && addResult.data) {
                    const serverData = addResult.data;
                    await updateLocalBookmark(payload.clientId, { 
                        serverId: serverData._id,
                        ...serverData 
                    });
                    console.log(`Item ${payload.clientId} successfully synced. ServerId set to ${serverData._id}.`);
                }
            } else {
                console.log(`Sync successful for operation: '${type}' on item with serverId: ${payload.serverId}`);
            }
        } else {
            const errorBody = await response.json();
            console.error("Sync change failed with status:", response.status, "Error:", errorBody);
        }
    } catch (e) {
        console.error("Network error during sync change:", e);
    }
}

/*
async function syncItemChange(type, payload) {
    const token = await getJwt();
    if (!token) return;

    const apiPayload = JSON.parse(JSON.stringify(payload));
    let clientId = null;

    if (type === 'add') {
        clientId = apiPayload.id;
        apiPayload.clientId = clientId;
        delete apiPayload.id;
        delete apiPayload._id;
    } else {
        apiPayload._id = apiPayload.id;
        delete apiPayload.id;
    }

    const change = { type, payload: apiPayload };

    try {
        const response = await fetch(`${API_BASE_URL}/bookmarks/sync`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'Authorization': `${token}` },
            body: JSON.stringify([change])
        });

        if (response.ok) {
            const resultData = await response.json();
            if (type === 'add' && resultData.results && resultData.results.length > 0) {
                const addResult = resultData.results.find(r => r.operation.payload.clientId === clientId);
                if (addResult && addResult.status === 'success' && addResult.data) {
                    const serverBookmark = addResult.data;
                    const newId = serverBookmark._id; // This is the new, permanent server ID.

                    const { bookmarkItems = [] } = await chrome.storage.local.get("bookmarkItems");
                    const index = bookmarkItems.findIndex(b => b.id === clientId);

                    if (index !== -1) {
                        const existingLocalBookmark = bookmarkItems[index];
                        const updatedBookmark = {
                            ...existingLocalBookmark, ...serverBookmark, id: newId
                        };
                        delete updatedBookmark._id;
                        bookmarkItems[index] = updatedBookmark;

                        await chrome.storage.local.set({ bookmarkItems });
                        console.log(`ID Exchange successful for ${clientId}.`);

                        // FIX PART 2: Instead of modifying the queue, record the ID change in our map.
                        idResolutionMap.set(clientId, newId);
                        console.log(`ID resolution map updated: ${clientId} -> ${newId}`);
                    }
                }
            } else {
                console.log("Sync successful for operation:", type);
            }
        } else {
            const errorBody = await response.json();
            console.error("Sync change failed:", response.status, errorBody);
        }
    } catch (e) {
        console.error("Network error during sync change:", e);
    }
}
*/

async function handleAsyncBookmarkAction(action, data, tab) {
    if (action === "addCurrentPage") {
        const { bookmarkItems = [] } = await chrome.storage.local.get("bookmarkItems");
        const newBookmark = {
            // --- NEW DATA MODEL ---
            clientId: crypto.randomUUID(), // The stable, local-only, permanent identifier.
            serverId: null,                // The server's ID, will be filled after sync.
            // ---
            type: 'bookmark',
            url: tab.url,
            title: tab.title || 'Untitled',
            id: null, // The old 'id' field is deprecated and no longer used.
            parentId: data.parentId || 'root',
            dateAdded: new Date().toISOString(),
            lastModified: new Date().toISOString(), // Corrected this line
            isStarred: false,
            notes: '',
            summary: '',
            aiStatus: 'pending',
            contentType: '', 
            estimatedReadTime: null, 
            readingLevel: '' 
        };
        delete newBookmark.id; // Ensure the old 'id' field is gone.

        await chrome.storage.local.set({ bookmarkItems: [newBookmark, ...bookmarkItems] });
        
        // The two processes are now independent and use the stable clientId.
        await syncItemChange('add', newBookmark);
        await enqueueTask(newBookmark.clientId); 
        
        return newBookmark;
    }
}

/*
async function handleAsyncBookmarkAction(action, data, tab) {
    if (action === "addCurrentPage") {
        const { bookmarkItems = [] } = await chrome.storage.local.get("bookmarkItems");
        const newBookmark = {
            type: 'bookmark',
            url: tab.url,
            title: tab.title || 'Untitled',
            id: crypto.randomUUID(), // This is the temporary 'clientId'
            parentId: data.parentId || 'root',
            dateAdded: new Date().toISOString(),
            lastModified: new Date().toISOString(), // Important for merge logic
            isStarred: false,
            notes: '',
            summary: '',
            aiStatus: 'pending'
        };
        await chrome.storage.local.set({ bookmarkItems: [newBookmark, ...bookmarkItems] });
        await enqueueTask(newBookmark.id);
        return newBookmark;
    }
}
*/

async function updateLocalBookmark(bookmarkClientId, updates) {
    const { bookmarkItems = [] } = await chrome.storage.local.get("bookmarkItems");
    const index = bookmarkItems.findIndex(b => b.clientId === bookmarkClientId); // Find by clientId
    if (index !== -1) {
        const updatedBookmark = {
            ...bookmarkItems[index],
            ...updates,
            lastModified: new Date().toISOString()
        };
        bookmarkItems[index] = updatedBookmark;
        await chrome.storage.local.set({ bookmarkItems });
        return updatedBookmark;
    }
    return null;
}

/*
async function updateLocalBookmark(bookmarkId, updates) {
    const { bookmarkItems = [] } = await chrome.storage.local.get("bookmarkItems");
    const index = bookmarkItems.findIndex(b => b.id === bookmarkId);
    if (index !== -1) {
        const updatedBookmark = {
            ...bookmarkItems[index],
            ...updates,
            lastModified: new Date().toISOString() // Automatically update modification time
        };
        bookmarkItems[index] = updatedBookmark;
        await chrome.storage.local.set({ bookmarkItems });
        return updatedBookmark;
    }
    return null;
}
*/


/**
 * 启动一个健壮的双向合并同步过程。
 * 1. 从服务器和本地获取所有项目。
 * 2. 比较两者，计算出需要推送到服务器的本地变更（增、改）。
 * 3. 将这些变更分块推送到服务器，以避免请求体过大。
 * 4. 将服务器上新增的项目拉取到本地。
 * 5. 在客户端执行最终的 parentId 统一，确保数据一致性，然后保存。
 */
async function initiateMergeSync() {
    console.log("Starting bidirectional merge sync...");
    const token = await getJwt();
    if (!token) {
        console.error("Sync failed: User is not authenticated.");
        return { status: "error", message: "Not authenticated" };
    }

    try {
        // --- 1. 获取服务器和本地数据 ---
        const [serverResponse, localData] = await Promise.all([
            fetch(`${API_BASE_URL}/items/all`, { headers: { 'Authorization': `${token}` } }),
            chrome.storage.local.get("bookmarkItems")
        ]);

        if (!serverResponse.ok) {
            throw new Error(`Failed to fetch server items. Status: ${serverResponse.status}`);
        }

        const serverItemsRaw = await serverResponse.json();
        const localItems = localData.bookmarkItems || [];
        const serverMap = new Map(serverItemsRaw.map(b => [b._id, b]));
        
        const changesToPush = [];
        let finalItems = [];

        // --- 2. 核心合并逻辑：比较本地与服务器差异 ---
        for (const local of localItems) {
            const isTrulyNew = !local.serverId;
            const serverEquivalent = local.serverId ? serverMap.get(local.serverId) : null;

            if (isTrulyNew) {
                // 本地新建的项目，需要推送到服务器
                changesToPush.push({ type: "add", payload: { ...local, clientId: local.clientId } });
                finalItems.push(local);
            } else if (serverEquivalent) {
                // 两端都存在的项目，比较最后修改时间
                const localDate = new Date(local.lastModified || 0);
                const serverDate = new Date(serverEquivalent.lastModified || 0);

                if (localDate > serverDate) {
                    // 本地版本较新，需要推送到服务器
                    changesToPush.push({ type: "update", payload: { ...local, _id: local.serverId } });
                    finalItems.push(local);
                } else {
                    // 服务器版本较新或一致，采用服务器版本
                    finalItems.push({ ...serverEquivalent, clientId: local.clientId, serverId: serverEquivalent._id });
                }
                // 从map中移除已处理的项目
                serverMap.delete(local.serverId);
            }
            // 如果本地有，服务器没有，则说明在别处被删除，此处不加入 finalItems 即可实现本地删除
        }

        // --- 3. 将服务器上独有的项目添加到最终列表 ---
        for (const serverItem of serverMap.values()) {
            // 对于从服务器拉取的新项目，使用 serverId 作为其本地的 clientId 以保持稳定
            finalItems.push({ ...serverItem, clientId: serverItem._id, serverId: serverItem._id });
        }

        // --- 4. 分块推送本地变更 ---
        if (changesToPush.length > 0) {
            console.log(`Sync: Found ${changesToPush.length} local changes to push in chunks.`);
            
            const chunkSize = 50; // 每个块的大小，防止请求体过大
            for (let i = 0; i < changesToPush.length; i += chunkSize) {
                const chunk = changesToPush.slice(i, i + chunkSize);
                console.log(`Pushing chunk ${Math.floor(i / chunkSize) + 1}...`);

                const syncResponse = await fetch(`${API_BASE_URL}/items/sync`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json', 'Authorization': `${token}` },
                    body: JSON.stringify(chunk)
                });

                if (!syncResponse.ok) {
                    throw new Error('Failed to sync local changes to the server.');
                }
                
                // 处理成功的add操作，将返回的 serverId 更新到 finalItems 中
                const syncResults = await syncResponse.json();
                if (syncResults.results) {
                    for (const result of syncResults.results) {
                        if (result.operation.type === 'add' && result.status === 'success') {
                            const clientId = result.operation.payload.clientId;
                            const serverData = result.data;
                            const indexToReplace = finalItems.findIndex(b => b.clientId === clientId);
                            if (indexToReplace !== -1) {
                                // 合并服务器返回的数据，同时保留原始的 clientId
                                finalItems[indexToReplace] = { ...finalItems[indexToReplace], ...serverData, serverId: serverData._id };
                            }
                        }
                    }
                }
            }
        }

        // --- 5. 最终的 parentId 统一和保存逻辑 (之前省略的部分) ---
        // a. 基于合并后的完整列表，建立一个 clientId -> serverId 的最终映射表
        const clientToServerIdMap = new Map();
        finalItems.forEach(item => {
            const serverId = item.serverId || item._id;
            if (item.clientId && serverId) {
                clientToServerIdMap.set(item.clientId, serverId);
            }
        });

        // b. 遍历最终列表，将所有 clientId 类型的 parentId 替换为 serverId
        const finalItemsToStore = finalItems.map(item => {
            let finalParentId = item.parentId;
            if (finalParentId && finalParentId !== 'root' && clientToServerIdMap.has(finalParentId)) {
                finalParentId = clientToServerIdMap.get(finalParentId);
            }
            
            const serverId = item.serverId || item._id;
            
            // c. 清理数据结构，确保本地存储格式统一
            const finalItem = {
                ...item,
                parentId: finalParentId,
                serverId: serverId,
            };
            delete finalItem._id; // 移除服务器特有的 _id 字段
            delete finalItem.id;  // 移除可能存在的旧的 id 字段

            return finalItem;
        });

        // d. 将完全统一和清理后的数据保存到本地存储
        await chrome.storage.local.set({ bookmarkItems: finalItemsToStore });

        // --- 6. 同步AI配置 ---
        try {
            console.log("开始同步AI配置...");
            await syncAIConfigAfterLogin();
            console.log("AI配置同步完成");
        } catch (aiSyncError) {
            console.warn("AI配置同步失败，但不影响书签同步:", aiSyncError);
        }

        console.log(`Merge sync complete. Local store updated with ${finalItemsToStore.length} items.`);
        return { status: "success", count: finalItemsToStore.length };

    } catch (e) {
        // --- 7. 错误处理 ---
        console.error("An error occurred during the robust merge sync process:", e);
        // 返回一个包含错误信息的对象，以便调用方可以处理
        return { status: "error", message: e.message };
    }
}

/**
 * 登录后同步AI配置
 * 从服务器获取AI配置并与本地配置进行时间戳比较
 */
async function syncAIConfigAfterLogin() {
    const token = await getJwt();
    if (!token) {
        console.log('用户未登录，跳过AI配置同步');
        return;
    }

    try {
        // 1. 获取服务器AI配置
        const response = await fetch(`${API_BASE_URL}/user/settings/ai-config`, {
            headers: { 'Authorization': `${token}` }
        });

        if (response.status === 404) {
            console.log('服务器无AI配置，检查是否需要上传本地配置');
            await uploadLocalAIConfigIfExists();
            return;
        }

        if (!response.ok) {
            throw new Error(`获取服务器AI配置失败: ${response.status}`);
        }

        const serverConfigResponse = await response.json();
        const serverConfig = serverConfigResponse.data || serverConfigResponse;

        console.log('服务器AI配置原始数据:', JSON.stringify(serverConfigResponse, null, 2));
        console.log('解析后的服务器配置:', JSON.stringify(serverConfig, null, 2));

        // 2. 获取本地AI配置
        const localData = await chrome.storage.local.get(['aiConfig', 'aiAnalysisDepth']);
        const localConfig = localData.aiConfig || {};

        console.log('本地AI配置:', localConfig);

        // 3. 时间戳比较
        const localTime = new Date(localConfig.lastModified || 0);
        const serverTime = new Date(serverConfig.lastModified || 0);

        console.log('AI配置时间戳比较:', {
            local: localConfig.lastModified,
            server: serverConfig.lastModified,
            localTime: localTime.getTime(),
            serverTime: serverTime.getTime(),
            useServer: serverTime > localTime,
            hasLocalConfig: !!localConfig.provider,
            hasServerConfig: !!serverConfig.provider,
            localConfigValid: !!(localConfig.provider && localConfig.apiKey),
            serverConfigEmpty: Object.keys(serverConfig).length === 0
        });

        // 特别处理：服务器返回空对象的情况
        if (Object.keys(serverConfig).length === 0) {
            console.log('🔍 检测到服务器返回空对象，检查本地配置...');
            if (localConfig.provider && localConfig.apiKey) {
                console.log('✅ 本地有有效AI配置，立即上传到服务器');
                await uploadAIConfigToServer(localConfig, localData.aiAnalysisDepth);
                return; // 提前返回，避免后续逻辑
            } else {
                console.log('❌ 本地也无有效AI配置，跳过同步');
                return;
            }
        }

        if (serverTime > localTime) {
            // 使用服务器配置（保留本地apiKey）
            const mergedConfig = {
                provider: serverConfig.provider,
                model: serverConfig.model,
                apiKey: localConfig.apiKey || '', // 保留本地完整apiKey
                lastModified: serverConfig.lastModified
            };

            await chrome.storage.local.set({
                aiConfig: mergedConfig,
                aiAnalysisDepth: localData.aiAnalysisDepth || 'standard'
            });

            console.log('已使用服务器AI配置更新本地');
        } else if (localTime > serverTime && localConfig.provider) {
            // 本地配置更新，上传到服务器
            console.log('本地AI配置更新，上传到服务器');
            await uploadAIConfigToServer(localConfig, localData.aiAnalysisDepth);
        } else if (localConfig.provider && localConfig.apiKey && !serverConfig.provider) {
            // 服务器配置为空但本地有有效配置，上传本地配置
            console.log('服务器AI配置为空，上传本地配置');
            await uploadAIConfigToServer(localConfig, localData.aiAnalysisDepth);
        } else if (localConfig.provider && localConfig.apiKey && (!serverConfig.lastModified || serverConfig.lastModified === localConfig.lastModified)) {
            // 时间戳相同或服务器无时间戳，但本地有有效配置，上传确保服务器有完整数据
            console.log('时间戳相同或服务器无时间戳，上传本地配置确保数据完整');
            await uploadAIConfigToServer(localConfig, localData.aiAnalysisDepth);
        } else {
            console.log('AI配置时间戳比较结果：无需同步');

            // 额外检查：如果本地有配置但服务器配置不完整，强制上传
            if (localConfig.provider && localConfig.apiKey &&
                (!serverConfig.provider || !serverConfig.apiKey || serverConfig.apiKey === '********')) {
                console.log('检测到服务器配置不完整，强制上传本地配置');
                await uploadAIConfigToServer(localConfig, localData.aiAnalysisDepth);
            }
        }

    } catch (error) {
        console.error('AI配置同步失败:', error);
        throw error;
    }
}

/**
 * 检查并上传本地AI配置（如果存在且有效）
 */
async function uploadLocalAIConfigIfExists() {
    const localData = await chrome.storage.local.get(['aiConfig', 'aiAnalysisDepth']);
    const localConfig = localData.aiConfig || {};

    if (localConfig.provider && localConfig.apiKey) {
        console.log('发现本地AI配置，上传到服务器');
        await uploadAIConfigToServer(localConfig, localData.aiAnalysisDepth);
    } else {
        console.log('本地无有效AI配置，跳过上传');
    }
}

/**
 * 上传AI配置到服务器
 */
async function uploadAIConfigToServer(config, analysisDepth) {
    const token = await getJwt();
    if (!token) return;

    const configPayload = {
        provider: config.provider,
        apiKey: config.apiKey,
        model: config.model
    };

    // 添加时间戳
    if (!config.lastModified) {
        configPayload.lastModified = new Date().toISOString();
    }

    try {

        console.log('上传AI配置到服务器:', JSON.stringify(configPayload));


        const response = await fetch(`${API_BASE_URL}/user/settings/ai-config`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `${token}`
            },
            body: JSON.stringify(configPayload)
        });

        if (!response.ok) {
            throw new Error(`上传AI配置失败: ${response.status}`);
        }

        const result = await response.json();
        console.log('AI配置已上传到服务器:', result);

        // 更新本地配置的时间戳
        const updatedConfig = {
            ...config,
            lastModified: result.data?.lastModified || new Date().toISOString()
        };

        await chrome.storage.local.set({ aiConfig: updatedConfig });

    } catch (error) {
        console.error('上传AI配置失败:', error);
        throw error;
    }
}

// --- All other functions (AI processing, context menus, tab listeners, etc.) remain unchanged ---
// ... (The rest of the original background.js file from processTaskQueue onwards)

chrome.tabs.onUpdated.addListener(async (tabId, changeInfo, tab) => {
    if (!isSidePanelSupported && changeInfo.status === 'complete') {
        const data = await chrome.storage.session.get(tabId.toString());
        const bookmarkId = data[tabId];
        if (bookmarkId) {
            try {
                await chrome.scripting.insertCSS({ target: { tabId: tabId }, files: ['learningAssistant.css'] });
                await chrome.scripting.executeScript({ target: { tabId: tabId }, files: ['learningAssistant.js'] });
            } catch (e) { /* Catch errors if tab is protected */ }
        }
    }
});

chrome.tabs.onActivated.addListener(async (activeInfo) => {
    if (isSidePanelSupported) {
        const data = await chrome.storage.session.get(activeInfo.tabId.toString());
        const bookmarkId = data[activeInfo.tabId];
        chrome.runtime.sendMessage({ action: 'updateSidePanel', bookmarkId: bookmarkId || null });
    }
});

chrome.tabs.onRemoved.addListener((tabId, removeInfo) => {
    chrome.storage.session.remove(tabId.toString());
});

// A more robust task queue processor that is resilient to individual task failures.
async function processTaskQueue(generation) {
    // 关键修复：检查当前任务处理器是否属于最新的世代。如果不是，立即退出。
    if (generation !== queueGeneration) {
        console.log(`Queue processor from generation ${generation} is now obsolete. Exiting.`);
        return;
    }

    if (isProcessingQueue || taskQueue.length === 0) {
        isProcessingQueue = false; // Ensure flag is reset if queue is empty
        return;
    }

    isProcessingQueue = true;
    const tasksToRun = taskQueue.splice(0, CONCURRENT_LIMIT);

    console.log(`G${generation}: Processing a batch of ${tasksToRun.length} AI tasks.`);

    const taskPromises = tasksToRun.map(id => {
        return processBookmarkWithAI(id).catch(e => {
            console.error(`G${generation}: A critical error occurred while processing bookmark ID ${id}:`, e);
        });
    });
    
    await Promise.allSettled(taskPromises);

    // 关键修复：在继续下一个循环前，再次检查世代编号
    if (generation !== queueGeneration) {
        console.log(`Queue processor from generation ${generation} is now obsolete after batch completion. Exiting.`);
        isProcessingQueue = false;
        return;
    }
    
    console.log(`G${generation}: Finished processing batch.`);
    isProcessingQueue = false;

    if (taskQueue.length > 0) {
        setTimeout(() => processTaskQueue(generation), 1000); // 将世代编号传递给下一次调用
    }
}

/*
async function processTaskQueue() {
    if (isProcessingQueue || taskQueue.length === 0) return;
    isProcessingQueue = true;
    const tasksToRun = taskQueue.splice(0, CONCURRENT_LIMIT);
    await Promise.all(tasksToRun.map(id => processBookmarkWithAI(id).catch(e => console.error(`Error in task for ${id}:`, e))));
    isProcessingQueue = false;
    if (taskQueue.length > 0) setTimeout(processTaskQueue, 500);
}
*/

/**
 * Processes a single bookmark with AI, using a hybrid content extraction strategy.
 *
 * @param {string} bookmarkClientId The stable, local-only UUID of the bookmark to process.
 */
async function processBookmarkWithAI(bookmarkClientId) {
    const { bookmarkItems: initialItems = [] } = await chrome.storage.local.get("bookmarkItems");
    let bookmark = initialItems.find(b => b.clientId === bookmarkClientId);

    if (!bookmark) {
        console.warn(`AI Task: Could not find bookmark for clientId ${bookmarkClientId}. Aborting task.`);
        return;
    }

    await updateLocalBookmark(bookmark.clientId, { aiStatus: 'processing', aiError: '' });

    const { aiConfig } = await chrome.storage.local.get("aiConfig");
    if (!aiConfig || !aiConfig.apiKey) {
        await updateLocalBookmark(bookmark.clientId, {
            aiStatus: 'failed',
            aiError: chrome.i18n.getMessage("errorApiKeyMissing")
        });
        return;
    }

    let pageContent = '';
    let extractionMethod = '';

    try {
        // --- 开始新的混合式内容提取策略 ---

        // 策略 1: 尝试从已打开的活动标签页直接获取内容
        try {
            const tabs = await chrome.tabs.query({ url: bookmark.url, status: 'complete' });
            const accessibleTabs = (await Promise.all(tabs.map(async (tab) => {
                const canAccess = await chrome.scripting.executeScript({ target: { tabId: tab.id }, func: () => true }).catch(() => false);
                return canAccess ? tab : null;
            }))).filter(Boolean);
            
            if (accessibleTabs.length > 0) {
                const results = await chrome.scripting.executeScript({
                    target: { tabId: accessibleTabs[0].id },
                    func: () => document.body.innerText
                });
                if (results && results[0] && results[0].result) {
                    pageContent = results[0].result;
                    extractionMethod = 'Active Tab';
                }
            }
        } catch (e) {
            console.warn(`AI Task: Failed to extract content from active tab for ${bookmark.url}. Will fall back.`, e);
        }

        // 策略 2: 如果从活动标签页获取失败，则回退到后台fetch
        if (!pageContent || pageContent.trim().length < 50) {
            try {
                pageContent = await getPageContent(bookmark.url);
                extractionMethod = 'Background Fetch';
            } catch (fetchError) {
                 // 捕获 fetch 错误 (如 403, 404, anetwork failure)
                 console.warn(`AI Task: Background fetch failed for ${bookmark.url}. Error: ${fetchError.message}. Will use metadata fallback.`);
                 pageContent = ''; // 确保 pageContent 为空，以触发最终备用方案
            }
        }

        // 策略 3: 如果以上都失败，则使用元数据（标题和URL）作为最终备用方案
        if (!pageContent || pageContent.trim().length < 50) {
            extractionMethod = 'Metadata Fallback';
            let fallbackContent = bookmark.title ? bookmark.title + '. ' : '';
            try {
                const urlObj = new URL(bookmark.url);
                fallbackContent += `The content is from the domain ${urlObj.hostname.replace('www.', '')}. The path and topics might be related to ${urlObj.pathname.split('/').filter(p => p && isNaN(p)).join(' ').replace(/[-_]/g, ' ')}.`;
            } catch (e) { /* ignore URL parsing errors */ }
            
            pageContent = fallbackContent;

            if (!pageContent || pageContent.trim().length === 0) {
                // 如果连标题和URL都没有，则任务彻底失败
                throw new Error(chrome.i18n.getMessage("contentExtractionFailed"));
            }
        }
        
        console.log(`AI Task: Extracted content for ${bookmark.url} via [${extractionMethod}]`);
        
        // --- 内容提取结束，开始AI分析 ---
        
        const enhancedResult = await enhancedCallAI(aiConfig, pageContent, bookmark.url);
        
        const updatedBookmark = await updateLocalBookmark(bookmark.clientId, {
            ...enhancedResult,
            aiStatus: 'completed',
            aiError: ''
        });

        if (updatedBookmark && updatedBookmark.serverId) {
            await syncItemChange('update', updatedBookmark);
        }

    } catch (error) {
        // 统一的错误处理
        console.error(`AI processing error for bookmark ${bookmark.clientId}:`, error);
        let userFriendlyError = error.message;
        if (error.message.includes('API key')) userFriendlyError = chrome.i18n.getMessage("errorApiKeyInvalid");
        else if (error.message.includes('rate limit')) userFriendlyError = chrome.i18n.getMessage("errorRateLimit");
        else if (error.message.includes('timeout')) userFriendlyError = chrome.i18n.getMessage("errorTimeout");
        else if (error.message.includes(chrome.i18n.getMessage("contentExtractionFailed"))) userFriendlyError = chrome.i18n.getMessage("errorContentExtractionFailed");

        await updateLocalBookmark(bookmark.clientId, {
            aiStatus: 'failed',
            aiError: userFriendlyError
        });
    }
}

/*
async function processBookmarkWithAI(bookmarkId) {
    const { bookmarkItems: initialItems = [] } = await chrome.storage.local.get("bookmarkItems");

    // --- START OF FIX PART 3 ---
    let bookmark = initialItems.find(b => b.id === bookmarkId);

    // If the bookmark is not found, it might be because the ID is a stale clientId.
    // Check our resolution map for the new, permanent ID.
    if (!bookmark) {
        const newId = idResolutionMap.get(bookmarkId);
        if (newId) {
            console.log(`Resolving stale ID ${bookmarkId} to new ID ${newId}`);
            bookmark = initialItems.find(b => b.id === newId);
            // Clean up the map after use to prevent memory leaks.
            idResolutionMap.delete(bookmarkId);
        }
    }
    // --- END OF FIX PART 3 ---

    if (!bookmark) {
        console.warn(`AI Task: Could not find bookmark for ID ${bookmarkId} even after checking resolution map. Aborting.`);
        return; // Abort processing if bookmark is still not found.
    }

    const updateStatus = async (status, updates) => {
        const { bookmarkItems = [] } = await chrome.storage.local.get("bookmarkItems");
        const index = bookmarkItems.findIndex(b => b.id === bookmark.id); // Use the potentially updated bookmark ID
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
            // ... (rest of the try block is unchanged)
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
        const finalData = { ...enhancedResult, aiError: '' };
        await updateStatus('completed', finalData);
        // We get the most up-to-date version of the bookmark before syncing the update
        const currentBookmarkState = (await chrome.storage.local.get("bookmarkItems")).bookmarkItems.find(b => b.id === bookmark.id);
        if(currentBookmarkState) await syncItemChange('update', currentBookmarkState);

    } catch (error) {
        console.error(`AI processing error for bookmark ${bookmark.id}:`, error);
        let userFriendlyError = error.message;
        if (error.message.includes('API key')) userFriendlyError = chrome.i18n.getMessage("errorApiKeyInvalid");
        else if (error.message.includes('rate limit')) userFriendlyError = chrome.i18n.getMessage("errorRateLimit");
        else if (error.message.includes('timeout')) userFriendlyError = chrome.i18n.getMessage("errorTimeout");
        else if (error.message.includes(chrome.i18n.getMessage("contentExtractionFailed"))) userFriendlyError = chrome.i18n.getMessage("errorContentExtractionFailed");
        await updateStatus('failed', { aiError: userFriendlyError });
    }
}
*/

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
        headers['HTTP-Referer'] = 'https://github.com/CaspianLight/Smart-Bookmarker';
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
        //await syncItemChange('add', newBookmark);
    }
});

/**
 * A new function to handle batch synchronization of multiple changes in a single request.
 * This is crucial for bulk operations like importing bookmarks.
 * @param {Array<object>} changes - An array of change objects, e.g., [{ type: 'add', payload: newItem }, ...]
 * @returns {boolean} - True if the batch sync was successful, false otherwise.
 */
async function batchSyncChanges(changes) {
    if (!changes || changes.length === 0) {
        return true;
    }

    const token = await getJwt();
    if (!token) {
        console.log("Batch sync skipped: User not authenticated.");
        return false;
    }

    console.log(`Starting batch sync for ${changes.length} items.`);

    try {
        const response = await fetch(`${API_BASE_URL}/items/sync`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `${token}`
            },
            body: JSON.stringify(changes)
        });

        if (!response.ok) {
            const errorBody = await response.json().catch(() => ({}));
            console.error("Batch sync request failed with status:", response.status, "Error:", errorBody);
            return false;
        }

        const resultData = await response.json();
        
        if (resultData.results && resultData.results.length > 0) {
            const { bookmarkItems = [] } = await chrome.storage.local.get("bookmarkItems");
            let itemsWereUpdated = false;

            // Step 1: Update serverId for newly added items
            for (const result of resultData.results) {
                if (result.operation.type === 'add' && result.status === 'success' && result.data) {
                    const clientId = result.operation.payload.clientId;
                    const serverData = result.data;
                    
                    const itemIndex = bookmarkItems.findIndex(b => b.clientId === clientId);
                    if (itemIndex !== -1) {
                        bookmarkItems[itemIndex].serverId = serverData._id;
                        itemsWereUpdated = true;
                    }
                }
            }

            if (itemsWereUpdated) {
                // --- START OF FIX ---
                // After serverIds are populated, we MUST unify the parentIds

                // 1. Create a map from every item's clientId to its new serverId.
                const clientToServerIdMap = new Map();
                bookmarkItems.forEach(item => {
                    if (item.clientId && item.serverId) {
                        clientToServerIdMap.set(item.clientId, item.serverId);
                    }
                });

                // 2. Iterate again and "upgrade" any parentId that is a clientId to its serverId equivalent.
                const finalBookmarkItems = bookmarkItems.map(item => {
                    let finalParentId = item.parentId;
                    if (finalParentId && finalParentId !== 'root' && clientToServerIdMap.has(finalParentId)) {
                        finalParentId = clientToServerIdMap.get(finalParentId);
                    }
                    return { ...item, parentId: finalParentId };
                });

                await chrome.storage.local.set({ bookmarkItems: finalBookmarkItems });
                console.log("Batch sync successful. Local items updated with server IDs and parentIds unified.");
                // --- END OF FIX ---
            }
        }
        return true;

    } catch (e) {
        console.error("Network error during batch sync:", e);
        return false;
    }
}

/**
 * Forcefully clears and rebuilds the AI task queue based on the current state of bookmarks.
 * This version includes a performance optimization to batch-update bookmark statuses.
 * @returns {Promise<number>} - The number of tasks that were re-queued.
 */
async function forceRestartAiQueue() {
    console.log("Force restarting AI task queue as requested by user...");

    queueGeneration++;
    console.log(`Advancing to queue generation: ${queueGeneration}`);

    isProcessingQueue = false;
    taskQueue = [];
    
    const { bookmarkItems = [] } = await chrome.storage.local.get("bookmarkItems");

    const itemsToReprocess = bookmarkItems.filter(item => {
        if (item.type !== 'bookmark') return false;
        const isIncompleteStatus = ['pending', 'processing', 'failed'].includes(item.aiStatus);
        const isContentMissing = item.aiStatus === 'completed' && (!item.summary || !item.tags || item.tags.length === 0);
        return isIncompleteStatus || isContentMissing;
    });

    if (itemsToReprocess.length === 0) {
        console.log("No items found that require reprocessing.");
        // Even if no items to reprocess, we still need to start the queue processor
        // in case tasks were added while this function was running.
        processTaskQueue(queueGeneration);
        return 0;
    }

    // --- 性能优化：批量更新状态 ---
    // 1. 创建一个包含所有需要重置状态的书签ID的Set，以便快速查找。
    const reprocessSet = new Set(itemsToReprocess.map(item => item.clientId));
    let requiresUpdate = false;

    // 2. 在内存中遍历一次所有书签，修改需要重置的状态。
    const updatedBookmarkItems = bookmarkItems.map(item => {
        // 如果当前书签在需要重置的集合中，并且其状态不是'pending'
        if (reprocessSet.has(item.clientId) && item.aiStatus !== 'pending') {
            requiresUpdate = true; // 标记需要执行一次写操作
            return { ...item, aiStatus: 'pending', aiError: '' };
        }
        return item; // 其他情况保持不变
    });

    // 3. 如果有任何状态被修改，则执行一次性的、批量的写回操作。
    if (requiresUpdate) {
        console.log("Batch updating bookmark statuses to 'pending'...");
        await chrome.storage.local.set({ bookmarkItems: updatedBookmarkItems });
    }
    // --- 优化结束 ---
    
    // 4. 使用已过滤的列表重建任务队列（这部分不变）
    taskQueue = itemsToReprocess.map(item => item.clientId);
    console.log(`Rebuilt queue with ${taskQueue.length} tasks for generation ${queueGeneration}.`);

    // 5. 启动新世代的任务处理器（这部分不变）
    processTaskQueue(queueGeneration);

    return taskQueue.length;
}