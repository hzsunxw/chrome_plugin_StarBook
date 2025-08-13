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

//                const prompt = `You are a rigorous AI Q&A assistant. Please answer the user's question strictly based on the "Context" provided below.\n\n### Context:\n${pageContent.substring(0, 8000)}\n\n### User's Question:\n${question}\n\n### Your Requirements:\n- Your answer must be based entirely on the "Context" above.\n- If the "Context" does not contain enough information to answer the question, please state clearly: "Based on the provided article content, this question cannot be answered."\n- The answer should be direct and concise.`;
                const prompt = `你是一个严谨的AI问答助手。请严格根据下面提供的“上下文”来回答用户的问题。\n\n### 上下文:\n${pageContent.substring(0, 8000)}\n\n### 用户的问题:\n${question}\n\n### 你的要求:\n- 你的回答必须完全基于上述“上下文”。\n- 如果“上下文”中没有足够信息来回答问题，请明确指出：“根据所提供的文章内容，无法回答这个问题。”\n- 回答应直接、简洁。`;

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

//                const prompt = `You are an excellent learning tutor. Please read the following "Text Content" carefully, extract 3 to 5 of the most important key knowledge points, and design a learning quiz.\n\n### Text Content:\n${pageContent.substring(0, 8000)}\n\n### Your Task:\n1. Create 3-5 questions, which can be multiple-choice or short-answer.\n2. Ensure the questions effectively test understanding of the text's core content.\n3. Return a JSON object containing a "quiz" list. Each question object should include "question", "type" ('multiple-choice' or 'short-answer'), "options" (array of options for multiple-choice, empty for short-answer), and "answer".\n\n### JSON Format Example:\n{"quiz": [{"question": "What is the main purpose of React Hooks?","type": "multiple-choice","options": ["A. To style components","B. To use state and other React features in functional components","C. For routing management"],"answer": "B. To use state and other React features in functional components"}]}\n\n### Critical Instruction:\nYour response must be and only be a single, complete, syntactically correct JSON object. Do not add any extra text, explanations, or comments before or after the JSON code block. If you cannot generate a meaningful quiz from the content, you must return a JSON object with an empty list: {"quiz": []}`;
                const prompt = `你是一个优秀的学习导师。请仔细阅读以下“文本内容”，并从中提炼出3到5个最重要的核心知识点，设计成一个学习测验。\n\n### 文本内容:\n${pageContent.substring(0, 8000)}\n\n### 你的任务:\n1. 创建3-5个问题，可以是选择题或简答题。\n2. 确保问题能有效检验对文本核心内容的理解。\n3. 返回一个包含 "quiz" 列表的JSON对象。每个问题对象应包含 "question" (问题), "type" (类型: '选择题' 或 '简答题'), "options" (选择题选项数组，简答题则为空数组), 和 "answer" (答案)。\n\n### JSON格式示例:\n{"quiz": [{"question": "React Hooks 的主要目的是什么？","type": "选择题","options": ["A. 样式化组件","B. 在函数组件中使用 state 和其他 React 特性","C. 路由管理"],"answer": "B. 在函数组件中使用 state 和其他 React 特性"}]}\n\n### 关键指令:\n你的回答必须是且仅是一个完整的、语法正确的JSON对象。不要在JSON代码块前后添加任何额外的文字、解释或注释。如果无法根据内容生成有意义的测验，请必须返回一个包含空列表的JSON对象：{"quiz": []}`;

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
                (async () => {
                    try {
                        // const browserBookmarksTree = await chrome.bookmarks.getTree(); // 旧方式
                        const { bookmarkItems: currentItems = [] } = await chrome.storage.local.get("bookmarkItems");

                        const newItems = [];
                        const existingUrlSet = new Set(currentItems.filter(i => i.type === 'bookmark').map(i => i.url));

                        const folderMap = new Map();
                        currentItems.forEach(item => {
                            if (item.type === 'folder') {
                                folderMap.set(`${item.parentId}-${item.title}`, item.clientId);
                            }
                        });

                        const processNode = (node, extensionParentId) => {
                            // 1. Process Folders first
                            if (node.children) {
                                let nextParentId;
                                const folderTitle = node.title || 'Unnamed Folder'; // This is now safe because we skip the root.
                                const folderMapKey = `${extensionParentId}-${folderTitle}`;

                                if (folderMap.has(folderMapKey)) {
                                    nextParentId = folderMap.get(folderMapKey);
                                } else {
                                    const newFolder = {
                                        clientId: crypto.randomUUID(), serverId: null, parentId: extensionParentId,
                                        title: folderTitle, dateAdded: new Date(node.dateAdded || Date.now()).toISOString(),
                                        lastModified: new Date(node.dateAdded || Date.now()).toISOString(), type: 'folder'
                                    };
                                    newItems.push(newFolder);
                                    nextParentId = newFolder.clientId;
                                    folderMap.set(folderMapKey, nextParentId);
                                }
                                node.children.forEach(child => processNode(child, nextParentId));
                            }

                            // 2. Process Bookmarks
                            if (node.url) {
                                if (node.url.startsWith('javascript:') || node.url.startsWith('chrome:')) return;
                                if (existingUrlSet.has(node.url)) return;

                                const newBookmark = {
                                    clientId: crypto.randomUUID(), serverId: null, parentId: extensionParentId,
                                    title: node.title || 'No Title', url: node.url,
                                    dateAdded: new Date(node.dateAdded || Date.now()).toISOString(),
                                    lastModified: new Date(node.dateAdded || Date.now()).toISOString(),
                                    type: 'bookmark', isStarred: false, category: '', summary: '', tags: [],
                                    aiStatus: 'pending', notes: '', contentType: '', estimatedReadTime: null, readingLevel: ''
                                };
                                newItems.push(newBookmark);
                                existingUrlSet.add(newBookmark.url);
                            }
                        };
                        
                        // --- 核心修复：跳过不可见的根节点，直接处理其子节点 ---
                        // Get the single root node of the entire bookmark tree.
                        const [rootNode] = await chrome.bookmarks.getTree();
                        
                        // If the root exists and has children (like "Bookmarks Bar", "Other Bookmarks"),
                        // iterate over them and start the process. They will have our system's 'root' as their parent.
                        if (rootNode && rootNode.children) {
                            rootNode.children.forEach(childNode => processNode(childNode, 'root'));
                        }
                        // --- 修复结束 ---
                        
                        if (newItems.length > 0) {
                            const allItems = [...newItems, ...currentItems];
                            await chrome.storage.local.set({ bookmarkItems: allItems });
                            
                            const chunkSize = 50;
                            let allSyncsSuccess = true;
                            for (let i = 0; i < newItems.length; i += chunkSize) {
                                const chunk = newItems.slice(i, i + chunkSize);
                                const changesToSync = chunk.map(item => ({ type: 'add', payload: { ...item } }));
                                const syncSuccess = await batchSyncChanges(changesToSync);
                                if (!syncSuccess) {
                                    allSyncsSuccess = false;
                                    break;
                                }
                            }

                            if (allSyncsSuccess) {
                                const bookmarksToProcess = newItems.filter(item => item.type === 'bookmark');
                                for (const bookmark of bookmarksToProcess) await enqueueTask(bookmark.clientId);
                                sendResponse({ status: "success", count: bookmarksToProcess.length });
                            } else {
                                throw new Error("One or more chunks failed to sync with the server.");
                            }
                        } else {
                            sendResponse({ status: "success", count: 0 });
                        }
                    } catch (error) {
                        console.error("Critical error during bookmark import:", error);
                        sendResponse({ status: "error", message: error.message });
                    }
                })();
                return true;
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
    const token = await getJwt(); //
    if (!token) {
        // If the user is not logged in, we cannot sync. The change remains local.
        console.log("Sync skipped: User not authenticated."); //
        return;
    }

    // Create a deep copy of the payload to avoid modifying the original object.
    let apiPayload = JSON.parse(JSON.stringify(payload)); //
    
    // --- Prepare the payload based on the operation type ---
    if (type === 'add') {
        // For a new item, the server needs the `clientId` to link the response back to the request.
        // The `apiPayload` already contains the clientId from the local bookmark object.
        // We remove fields that should not be stored on the server, like serverId (which is null anyway).
        delete apiPayload.serverId;
        delete apiPayload.id; // Remove deprecated id field if it exists

    } else { // For 'update' or 'delete'
        if (!payload.serverId) {
            // This is a critical safeguard. We cannot update or delete an item on the server
            // without knowing its unique server ID.
            console.warn("Sync aborted for update/delete: serverId is missing.", payload);
            return;
        }
        // The server's API expects the ID field to be named `_id`.
        apiPayload._id = payload.serverId; //
        
        // Clean up local-only identifiers from the payload sent to the server.
        delete apiPayload.clientId;
        delete apiPayload.serverId;
        delete apiPayload.id;
    }

    // The sync API expects an array of change operations.
    const change = { type, payload: apiPayload }; //

    try {
        const response = await fetch(`${API_BASE_URL}/bookmarks/sync`, {
            method: 'POST', //
            headers: { 
                'Content-Type': 'application/json', //
                'Authorization': `${token}` //
            },
            body: JSON.stringify([change]) //
        });

        if (response.ok) { //
            const resultData = await response.json();
            
            // --- Handle the response, especially for the 'add' operation ---
            if (type === 'add' && resultData.results && resultData.results.length > 0) {
                // Find the result that corresponds to our added item by matching the clientId.
                const addResult = resultData.results.find(r => r.operation.payload.clientId === payload.clientId);
                
                if (addResult && addResult.status === 'success' && addResult.data) {
                    const serverData = addResult.data; // This object contains the new `_id` from the server.
                    
                    // --- ID Population ---
                    // Now, update the local bookmark with the `serverId` received from the server.
                    // This links the local item to the server item permanently.
                    await updateLocalBookmark(payload.clientId, { 
                        serverId: serverData._id, // Set the serverId
                        // Optionally, update with any other authoritative data from the server
                        // For example, if the server cleans up or adds fields.
                        ...serverData 
                    });
                    console.log(`Bookmark ${payload.clientId} successfully synced. ServerId set to ${serverData._id}.`);
                }
            } else {
                // For successful update/delete operations.
                console.log(`Sync successful for operation: '${type}' on item with serverId: ${payload.serverId}`);
            }
        } else {
            // Handle API errors (e.g., 400, 401, 500).
            const errorBody = await response.json();
            console.error("Sync change failed with status:", response.status, "Error:", errorBody); //
        }
    } catch (e) {
        // Handle network errors (e.g., no internet connection).
        console.error("Network error during sync change:", e); //
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
 * Initiates a robust, two-way merge synchronization.
 * This function acts as the single source of truth for reconciling local and server data.
 * It follows a "push-then-pull" strategy to ensure the client becomes fully aligned with the server.
 */
async function initiateMergeSync() {
    console.log("Starting bidirectional merge sync...");
    const token = await getJwt();
    if (!token) {
        console.error("Sync failed: User is not authenticated.");
        return { status: "error", message: "Not authenticated" };
    }

    try {
        // Step 1: Concurrently fetch all bookmarks from the server and local storage.
        const [serverResponse, localData] = await Promise.all([
            fetch(`${API_BASE_URL}/bookmarks/all`, { headers: { 'Authorization': `${token}` } }),
            chrome.storage.local.get("bookmarkItems")
        ]);

        if (!serverResponse.ok) {
            throw new Error(`Failed to fetch bookmarks from server. Status: ${serverResponse.status}`);
        }

        const serverBookmarksRaw = await serverResponse.json();
        const localBookmarks = localData.bookmarkItems || [];

        // Create a map of server bookmarks for efficient O(1) lookups by serverId.
        const serverMap = new Map(serverBookmarksRaw.map(b => [b._id, b]));

        const changesToPush = [];
        const finalBookmarks = []; // This will hold the final, merged list of bookmarks.

        // Step 2: Iterate through all local bookmarks to compare them with server data.
        for (const local of localBookmarks) {
            // A truly new item is one that has never been synced and thus has no serverId.
            const isTrulyNew = !local.serverId;
            const serverEquivalent = local.serverId ? serverMap.get(local.serverId) : null;

            if (isTrulyNew) {
                // --- Situation A: This is a new bookmark created locally. ---
                console.log(`Sync: Found new local bookmark to ADD: '${local.title}'`);
                // Prepare the payload for the 'add' operation. Use clientId for tracking.
                const payload = { ...local, id: undefined }; // Don't send the deprecated 'id' field
                changesToPush.push({ type: "add", payload: { ...payload, clientId: local.clientId } });
                // Add the local version as a placeholder. It will be replaced by the server's authoritative version after the sync.
                finalBookmarks.push(local);

            } else if (serverEquivalent) {
                // --- Situation B: The bookmark exists on both local and server. ---
                // We must decide which version to keep based on the last modification time.
                const localDate = new Date(local.lastModified || 0);
                const serverDate = new Date(serverEquivalent.lastModified || 0);

                if (localDate > serverDate) {
                    // Local version is newer, so prepare to update the server.
                    console.log(`Sync: Found newer local bookmark to UPDATE: '${local.title}'`);
                    changesToPush.push({ type: "update", payload: { ...local, _id: local.serverId, id: undefined } });
                    finalBookmarks.push(local); // Keep the newer local version.
                } else {
                    // Server version is newer or the same, so adopt the server's version.
                    finalBookmarks.push({ ...serverEquivalent, clientId: local.clientId }); // Keep existing clientId
                }
                // Remove the entry from the server map since it has been processed.
                serverMap.delete(local.serverId);

            } else {
                // --- Situation C: The bookmark has a serverId but is not on the server. ---
                // This means it was deleted on another device. We will remove it locally
                // by simply not adding it to the `finalBookmarks` array.
                console.log(`Sync: Item '${local.title}' was deleted on another device. Removing locally.`);
            }
        }

        // Step 3: Handle bookmarks that are only on the server.
        // Any items remaining in the serverMap are new to this client. Add them to the final list.
        for (const serverBookmark of serverMap.values()) {
            console.log(`Sync: Found new server bookmark to PULL: '${serverBookmark.title}'`);
            finalBookmarks.push({ ...serverBookmark, clientId: serverBookmark._id }); // Use serverId as clientId for new items
        }

        // Step 4: If there are local changes, push them to the server in a single batch request.
        if (changesToPush.length > 0) {
            console.log(`Sync: Pushing ${changesToPush.length} local changes (add/update) to the server.`);
            const syncResponse = await fetch(`${API_BASE_URL}/bookmarks/sync`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json', 'Authorization': `${token}` },
                body: JSON.stringify(changesToPush)
            });

            if (!syncResponse.ok) {
                throw new Error('Failed to sync local changes to the server.');
            }
            
            // --- The crucial "ID population" step for newly added items ---
            const syncResults = await syncResponse.json();
            if (syncResults.results) {
                for (const result of syncResults.results) {
                    if (result.operation.type === 'add' && result.status === 'success') {
                        const clientId = result.operation.payload.clientId;
                        const serverData = result.data; // This is the full bookmark data from the server, including the new _id
                        
                        // Find the placeholder in our final list and replace it with the complete server version.
                        const indexToReplace = finalBookmarks.findIndex(b => b.clientId === clientId);
                        if (indexToReplace !== -1) {
                            // Replace the temporary local version with the authoritative server version, preserving the clientId.
                            finalBookmarks[indexToReplace] = { ...serverData, clientId: clientId };
                        }
                    }
                }
            }
        }

        // Step 5: Format the final, merged list and update local storage.
        const finalBookmarksToStore = finalBookmarks.map(bookmark => {
            // The object from the server has `_id`. We map it to `serverId` for consistency.
            const serverId = bookmark._id || bookmark.serverId;
            const finalBookmark = {
                ...bookmark,
                serverId: serverId, // Ensure serverId is set
                id: undefined,      // Remove the deprecated 'id' field
                _id: undefined      // Remove the MongoDB '_id' field
            };
            
            // A small data integrity check
            if (finalBookmark.summary && !finalBookmark.aiStatus) {
                finalBookmark.aiStatus = 'completed';
            }
            
            return finalBookmark;
        });

        await chrome.storage.local.set({ bookmarkItems: finalBookmarksToStore });
        console.log(`Robust merge sync complete. Local store updated with ${finalBookmarksToStore.length} items.`);

        return { status: "success", count: finalBookmarksToStore.length, message: "Sync completed successfully" };

    } catch (e) {
        console.error("An error occurred during the robust merge sync process:", e);
        return { status: "error", message: e.message };
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
        return true; // Nothing to sync
    }

    const token = await getJwt();
    if (!token) {
        console.log("Batch sync skipped: User not authenticated.");
        return false;
    }

    console.log(`Starting batch sync for ${changes.length} items.`);

    try {
        const response = await fetch(`${API_BASE_URL}/bookmarks/sync`, {
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
        
        // --- CRITICAL STEP: Back-populate serverId to local items ---
        // After a successful sync, the server returns the newly created items with their server IDs (_id).
        // We must update our local storage with these IDs.
        
        if (resultData.results && resultData.results.length > 0) {
            const { bookmarkItems = [] } = await chrome.storage.local.get("bookmarkItems");
            let updated = false;

            for (const result of resultData.results) {
                // We only care about successful 'add' operations here
                if (result.operation.type === 'add' && result.status === 'success' && result.data) {
                    const clientId = result.operation.payload.clientId;
                    const serverData = result.data; // This contains the new `_id`
                    
                    const itemIndex = bookmarkItems.findIndex(b => b.clientId === clientId);
                    if (itemIndex !== -1) {
                        // Update the local item with the serverId and any other canonical data from the server.
                        bookmarkItems[itemIndex].serverId = serverData._id;
                        // You can also merge other fields if the server modifies them
                        // Object.assign(bookmarkItems[itemIndex], serverData);
                        updated = true;
                    }
                }
            }

            if (updated) {
                await chrome.storage.local.set({ bookmarkItems });
                console.log("Batch sync successful. Local items updated with server IDs.");
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
