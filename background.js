// --- Task Queue ---
let taskQueue = [];
let isProcessingQueue = false;

// --- Context Menu ID ---
const CONTEXT_MENU_ID = "bookmark_this_page";

// --- Lifecycle Events ---
chrome.runtime.onInstalled.addListener(() => {
    console.log("Smart Bookmarker installed or updated.");
    
    // Set language on first install
    chrome.storage.local.get('language', (data) => {
        if (!data.language) {
            const browserLang = chrome.i18n.getUILanguage();
            const langToSet = browserLang.startsWith('zh') ? 'zh_CN' : 'en';
            chrome.storage.local.set({ language: langToSet });
        }
    });

    // --- Create Context Menu Item ---
    chrome.contextMenus.create({
        id: CONTEXT_MENU_ID,
        title: chrome.i18n.getMessage("bookmarkThisPage"), // Use the new key
        contexts: ["page"] // Show context menu on pages
    });
});

chrome.runtime.onStartup.addListener(() => {
    console.log("Browser started.");
    setInterval(processTaskQueue, 60000);
});

// --- Context Menu Click Listener ---
chrome.contextMenus.onClicked.addListener(async (info, tab) => {
    if (info.menuItemId === CONTEXT_MENU_ID) {
        // Check for duplicates before adding to the queue
        const { bookmarks = [] } = await chrome.storage.local.get("bookmarks");
        if (tab && tab.url && !tab.url.startsWith('chrome://') && !bookmarks.some(b => b.url === tab.url)) {
            taskQueue.push(() => handleAsyncBookmarkAction('addCurrentPage', null, tab));
            processTaskQueue();
        } else {
            console.log("Page already exists or is not valid. Not adding from context menu.");
        }
    }
});


// --- Message Listener ---
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  (async () => {
    const { action, id } = request;

    if (action === "addCurrentPage" || action === "regenerateAiData") {
        const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
        const currentTab = tabs[0];
        
        if (action === 'addCurrentPage') {
            const { bookmarks = [] } = await chrome.storage.local.get("bookmarks");
            if (!currentTab || !currentTab.url || currentTab.url.startsWith('chrome://')) {
                sendResponse({ status: "no_active_tab" });
                return;
            }
            if (bookmarks.some(b => b.url === currentTab.url)) {
                sendResponse({ status: "duplicate" });
                return;
            }
        }

        taskQueue.push(() => handleAsyncBookmarkAction(action, id, currentTab));
        processTaskQueue();
        sendResponse({ status: "queued" });
        return;
    }
    
    const { bookmarks = [] } = await chrome.storage.local.get("bookmarks");
    const index = bookmarks.findIndex(b => b.id === id);

    if (action === "deleteBookmark") {
      if (index !== -1) {
        bookmarks.splice(index, 1);
        await chrome.storage.local.set({ bookmarks });
        sendResponse({ status: "success" });
      } else {
        sendResponse({ status: "error", message: chrome.i18n.getMessage("bookmarkNotFound") });
      }
    } else if (action === "toggleStar") {
      if (index !== -1) {
        bookmarks[index].isStarred = !bookmarks[index].isStarred;
        await chrome.storage.local.set({ bookmarks });
        sendResponse({ status: "success", isStarred: bookmarks[index].isStarred });
      } else {
        sendResponse({ status: "error", message: chrome.i18n.getMessage("bookmarkNotFound") });
      }
    } else if (action === "importBrowserBookmarks") {
        try {
            const browserBookmarksTree = await chrome.bookmarks.getTree();
            const { bookmarks: currentBookmarks = [] } = await chrome.storage.local.get("bookmarks");
            const newBookmarks = [];
            
            const flattenBookmarks = (nodes) => {
                for (const node of nodes) {
                    if (node.url && !node.url.startsWith('javascript:') && !currentBookmarks.some(b => b.url === node.url)) {
                        newBookmarks.push({
                            id: crypto.randomUUID(),
                            url: node.url,
                            title: node.title || 'No Title',
                            dateAdded: new Date(node.dateAdded).toISOString(),
                            isStarred: false, category: '', summary: '', aiStatus: 'pending'
                        });
                    }
                    if (node.children) {
                        flattenBookmarks(node.children);
                    }
                }
            };
            flattenBookmarks(browserBookmarksTree);

            if (newBookmarks.length > 0) {
                const updatedBookmarks = [...newBookmarks, ...currentBookmarks];
                await chrome.storage.local.set({ bookmarks: updatedBookmarks });

                newBookmarks.forEach(bm => {
                    taskQueue.push(() => processBookmarkWithAI(bm.id, null));
                });
                processTaskQueue();
                sendResponse({ status: "success", count: newBookmarks.length });
            } else {
                sendResponse({ status: "success", count: 0 });
            }
        } catch (e) {
            console.error("Error importing bookmarks:", e);
            sendResponse({ status: "error", message: chrome.i18n.getMessage("importFailed") });
        }
    }
  })();
  return true; // Indicates async response
});

// --- Task Processing ---
async function processTaskQueue() {
    if (isProcessingQueue || taskQueue.length === 0) return;
    isProcessingQueue = true;

    const taskToRun = taskQueue.shift();
    try {
        await taskToRun();
    } catch (e) {
        console.error("Error processing task queue:", e);
    }

    isProcessingQueue = false;
    setTimeout(processTaskQueue, 500); 
}

async function handleAsyncBookmarkAction(action, id, tab) {
    if (action === "addCurrentPage") {
        const { bookmarks = [] } = await chrome.storage.local.get("bookmarks");
        const newBookmark = {
          url: tab.url, title: tab.title, id: crypto.randomUUID(),
          dateAdded: new Date().toISOString(), isStarred: false, 
          category: '', summary: '', aiStatus: 'pending'
        };
        const updatedBookmarks = [newBookmark, ...bookmarks];
        await chrome.storage.local.set({ bookmarks: updatedBookmarks });
        await processBookmarkWithAI(newBookmark.id, tab.id);

    } else if (action === "regenerateAiData") {
        await processBookmarkWithAI(id, null);
    }
}

// --- AI Core Logic ---
async function processBookmarkWithAI(bookmarkId, tabId) {
  const updateStatus = async (status, error = '') => {
      const { bookmarks = [] } = await chrome.storage.local.get("bookmarks");
      const index = bookmarks.findIndex(b => b.id === bookmarkId);
      if (index !== -1) {
          bookmarks[index].aiStatus = status;
          bookmarks[index].aiError = error;
          await chrome.storage.local.set({ bookmarks });
      }
  };

  await updateStatus('processing');

  const { aiConfig } = await chrome.storage.local.get("aiConfig");
  if (!aiConfig || !aiConfig.apiKey) {
    await updateStatus('failed', chrome.i18n.getMessage("errorMissingApiKey"));
    return;
  }

  try {
    const { bookmarks } = await chrome.storage.local.get("bookmarks");
    const bookmark = bookmarks.find(b => b.id === bookmarkId);
    if (!bookmark) throw new Error("Bookmark disappeared during processing.");

    const pageContent = await getPageContent(tabId, bookmark.url);
    if (!pageContent || pageContent.trim().length < 50) {
        throw new Error(chrome.i18n.getMessage("errorContentExtraction"));
    }

    const aiResponseText = await callAI(aiConfig, pageContent);
    const { summary, category } = parseAIResponse(aiResponseText);
    if (!summary && !category) {
        throw new Error(chrome.i18n.getMessage("errorAiResponseFormat"));
    }
    
    const { bookmarks: finalBookmarks } = await chrome.storage.local.get("bookmarks");
    const finalIndex = finalBookmarks.findIndex(b => b.id === bookmarkId);
    if (finalIndex !== -1) {
        finalBookmarks[finalIndex].summary = summary;
        finalBookmarks[finalIndex].category = category;
        finalBookmarks[finalIndex].aiStatus = 'completed';
        finalBookmarks[finalIndex].aiError = '';
        await chrome.storage.local.set({ bookmarks: finalBookmarks });
    }
  } catch (error) {
    console.error(`AI processing error for bookmark ${bookmarkId}:`, error);
    await updateStatus('failed', error.message);
  }
}

async function getPageContent(tabId, url) {
    if (tabId) {
        try {
            const results = await chrome.scripting.executeScript({
                target: { tabId: tabId },
                func: () => document.body.innerText,
            });
            if (results && results[0] && results[0].result) {
                return results[0].result;
            }
        } catch (e) {
            console.warn(`Script injection failed for tab ${tabId}, falling back to fetch.`, e);
        }
    }
    try {
        const response = await fetch(url);
        if (!response.ok) throw new Error(`Fetch failed with status: ${response.status}`);
        const html = await response.text();
        return await parseWithOffscreen(html);
    } catch (fetchError) {
        console.error("Content extraction via fetch also failed:", fetchError);
        throw new Error(chrome.i18n.getMessage("errorContentExtraction"));
    }
}

// --- Offscreen Document Logic ---
let creating; 
async function setupOffscreenDocument(path) {
  const hasDoc = await chrome.offscreen.hasDocument();
  if (hasDoc) return;

  if (creating) {
    await creating;
  } else {
    creating = chrome.offscreen.createDocument({
      url: path,
      reasons: [chrome.offscreen.Reason.DOM_PARSER],
      justification: 'To parse HTML strings in the background service worker',
    });
    await creating;
    creating = null;
  }
}

async function parseWithOffscreen(html) {
    await setupOffscreenDocument('offscreen.html');
    const response = await chrome.runtime.sendMessage({
        action: 'parseHTML',
        html: html
    });
    return response.text;
}


// --- AI API Call ---
async function callAI(aiConfig, content) {
    const { language: langCode = 'en' } = await chrome.storage.local.get('language');
    const targetLanguage = langCode.startsWith('zh') ? 'Simplified Chinese' : 'English';
    const truncatedContent = content.substring(0, 5000);
    
    const prompt = `You are a text processing API that strictly follows instructions. Your task is to analyze the "Page Content" and return a single, valid JSON object with two keys: "summary" and "category".

# Rules
- The language for the "summary" and "category" values MUST be: ${targetLanguage}.
- summary: A concise summary, strictly under 30 words.
- category: Provide up to 6 most relevant categories, separated by a single comma.
- Your entire response must ONLY be the JSON object, with no extra text, explanations, or markdown.

# Page Content
---
${truncatedContent}
---

# Generate JSON output in ${targetLanguage}`;

    let apiUrl, body;
    const headers = {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${aiConfig.apiKey}`
    };

    if (aiConfig.provider === 'openai') {
        apiUrl = 'https://api.openai.com/v1/chat/completions';
        body = {
            model: aiConfig.model,
            messages: [{ role: 'user', content: prompt }],
            response_format: { type: "json_object" },
            max_tokens: 250, temperature: 0.2
        };
    } else if (aiConfig.provider === 'deepseek') {
        apiUrl = 'https://api.deepseek.com/v1/chat/completions';
        body = {
            model: aiConfig.model,
            messages: [{ role: 'user', content: prompt }],
            max_tokens: 250, temperature: 0.2
        };
    } else {
        throw new Error(chrome.i18n.getMessage("errorUnsupportedProvider"));
    }

    const response = await fetch(apiUrl, {
        method: 'POST',
        headers: headers,
        body: JSON.stringify(body)
    });

    if (!response.ok) {
        const errorBody = await response.json().catch(() => ({}));
        const errorMessage = errorBody.error?.message || response.statusText;
        throw new Error(chrome.i18n.getMessage("errorApiRequest", { message: errorMessage }));
    }

    const data = await response.json();
    return data.choices?.[0]?.message?.content || "";
}

function parseAIResponse(text) {
    try {
        const jsonMatch = text.match(/\{[\s\S]*\}/);
        if (jsonMatch) {
            const data = JSON.parse(jsonMatch[0]);
            return {
                summary: data.summary || '',
                category: data.category || ''
            };
        }
    } catch (e) {
        console.warn("Failed to parse JSON from AI response:", text, e);
    }
    return { summary: '', category: '' };
}