// --- Task Queue Configuration ---
let taskQueue = []; // Now stores only bookmark IDs
let isProcessingQueue = false;
const CONCURRENT_LIMIT = 3; // 同时处理3个AI任务

// --- Context Menu ID ---
const CONTEXT_MENU_ID = "bookmark_this_page";

// --- Enqueue Task Function ---
function enqueueTask(bookmarkId) {
    if (!taskQueue.includes(bookmarkId)) {
        taskQueue.push(bookmarkId);
        processTaskQueue(); // Start processing if not already running
        return true;
    }
    return false;
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
        stuckItems.forEach(item => enqueueTask(item.id));
    }
}

// --- Message Listener ---
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
    handleMessages(request, sendResponse);
    return true; // Indicates async response
});

async function handleMessages(request, sendResponse) {
    try {
        const { action, id, data } = request;

        switch (action) {
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
                if (enqueueTask(id)) {
                    sendResponse({ status: "queued" });
                } else {
                    sendResponse({ status: "already_queued" });
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
                    newItems.forEach(item => {
                        if (item.type === 'bookmark') {
                            enqueueTask(item.id);
                        }
                    });
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
        console.error(`An unexpected error occurred while handling action "${request.action}":`, e);
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

    await updateStatus('processing', { aiError: '' });

    const { aiConfig } = await chrome.storage.local.get("aiConfig");
    if (!aiConfig || !aiConfig.apiKey) {
      await updateStatus('failed', { aiError: "API key is not configured." });
      return;
    }

    try {
      let pageContent = await getPageContent(bookmark.url);

      if (!pageContent || pageContent.trim().length < 50) {
          console.warn(`Extracted content for ${bookmark.url} is too short. Trying fallback...`);
          if (bookmark.title && bookmark.title.trim().length > 0) {
              pageContent = bookmark.title;
          } else {
              try {
                  const urlObj = new URL(bookmark.url);
                  const pathParts = urlObj.pathname.split('/').filter(p => p && isNaN(p));
                  const hostParts = urlObj.hostname.replace('www.', '').split('.');
                  pageContent = [hostParts[0], ...pathParts].join(' ').replace(/[-_]/g, ' ');
              } catch {
                  pageContent = bookmark.url;
              }
          }
          if (!pageContent || pageContent.trim().length === 0) {
              throw new Error("Content, title, and URL are all empty or invalid.");
          }
      }

      const aiResponseText = await callAI(aiConfig, pageContent);
      const { summary, category } = parseAIResponse(aiResponseText);
      if (!summary && !category) {
          const truncatedResponse = aiResponseText ? aiResponseText.substring(0, 200) : "empty response";
          throw new Error(`Failed to parse AI response. Received: "${truncatedResponse}..."`);
      }
      
      await updateStatus('completed', { summary, category, aiError: '' });

    } catch (error) {
      console.error(`AI processing error for bookmark ${bookmarkId}:`, error);
      await updateStatus('failed', { aiError: error.message });
    }
}

async function handleAsyncBookmarkAction(action, data, tab) {
    if (action === "addCurrentPage") {
        const { bookmarkItems = [] } = await chrome.storage.local.get("bookmarkItems");
        const newBookmark = {
          type: 'bookmark',
          url: tab.url, title: tab.title, id: crypto.randomUUID(),
          parentId: data.parentId || 'root',
          dateAdded: new Date().toISOString(), isStarred: false, 
          category: '', summary: '', aiStatus: 'pending'
        };
        await chrome.storage.local.set({ bookmarkItems: [newBookmark, ...bookmarkItems] });
        enqueueTask(newBookmark.id);
    }
}

// --- Utility Functions ---
async function getPageContent(url) {
    try {
        const response = await fetch(url);
        if (!response.ok) throw new Error(`Fetch failed with status: ${response.status}`);
        const html = await response.text();
        return await parseWithOffscreen(html);
    } catch (fetchError) {
        console.error("Content extraction via fetch also failed:", fetchError);
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

    const commonBodyParams = {
        max_tokens: 512, 
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