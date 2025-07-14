// --- 任务队列相关变量 ---
let taskQueue = [];
let isProcessingQueue = false;

// 初始化监听器
chrome.runtime.onInstalled.addListener(() => {
    console.log("插件已安装或更新。");
});
chrome.runtime.onStartup.addListener(() => {
    console.log("浏览器已启动。");
});


// 消息监听器
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  const { action, id } = request;

  (async () => {
    if (action === "addCurrentPage" || action === "regenerateAiData") {
        taskQueue.push(() => handleAsyncBookmarkAction(action, id, sender.tab?.id));
        processTaskQueue();
        sendResponse({ status: "queued", message: "任务已加入处理队列" });
        return;
    }

    const { bookmarks = [] } = await chrome.storage.local.get("bookmarks");

    if (action === "deleteBookmark") {
      const index = bookmarks.findIndex(b => b.id === id);
      if (index !== -1) {
        bookmarks.splice(index, 1);
        await chrome.storage.local.set({ bookmarks });
        sendResponse({ status: "success" });
      } else {
        sendResponse({ status: "error", message: "书签不存在" });
      }
    }

    if (action === "toggleStar") {
      const bookmark = bookmarks.find(b => b.id === id);
      if (bookmark) {
        bookmark.isStarred = !bookmark.isStarred;
        await chrome.storage.local.set({ bookmarks });
        sendResponse({ status: "success", isStarred: bookmark.isStarred });
      } else {
        sendResponse({ status: "error", message: "书签不存在" });
      }
    }

    if (action === "importBrowserBookmarks") {
        try {
            const browserBookmarksTree = await chrome.bookmarks.getTree();
            const newBookmarks = [];
            
            const flattenBookmarks = (nodes) => {
                for (const node of nodes) {
                    if (node.url && !bookmarks.some(b => b.url === node.url)) {
                        newBookmarks.push({
                            id: crypto.randomUUID(),
                            url: node.url,
                            title: node.title || '无标题',
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
                const updatedBookmarks = [...newBookmarks, ...bookmarks];
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
            sendResponse({ status: "error", message: "导入失败" });
        }
    }
  })();

  return true;
});


// --- 新增：处理队列的函数 ---
async function processTaskQueue() {
    if (isProcessingQueue || taskQueue.length === 0) {
        return;
    }
    isProcessingQueue = true;

    const taskToRun = taskQueue.shift();
    try {
        await taskToRun();
    } catch (e) {
        console.error("处理任务队列时发生错误:", e);
    }

    isProcessingQueue = false;
    processTaskQueue();
}

// 【新增】统一处理书签动作的函数
async function handleAsyncBookmarkAction(action, id, tabId) {
    if (action === "addCurrentPage") {
        const { bookmarks = [] } = await chrome.storage.local.get("bookmarks");
        const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
        const tab = tabs[0];
        if (!tab || !tab.url || tab.url.startsWith('chrome://')) return;
        if (bookmarks.some(b => b.url === tab.url)) return;
        
        const newBookmark = {
          url: tab.url,
          title: tab.title,
          id: crypto.randomUUID(),
          dateAdded: new Date().toISOString(),
          isStarred: false, category: '', summary: '', aiStatus: 'pending'
        };
        const updatedBookmarks = [newBookmark, ...bookmarks];
        await chrome.storage.local.set({ bookmarks: updatedBookmarks });
        await processBookmarkWithAI(newBookmark.id, tab.id);

    } else if (action === "regenerateAiData") {
        await processBookmarkWithAI(id, null);
    }
}


// --- AI处理核心逻辑 (现在由任务队列安全调用) ---
async function processBookmarkWithAI(bookmarkId, tabId) {
  let { bookmarks = [], aiConfig } = await chrome.storage.local.get(["bookmarks", "aiConfig"]);
  const bookmarkIndex = bookmarks.findIndex(b => b.id === bookmarkId);

  if (bookmarkIndex === -1) {
    console.error(`AI处理失败: 未找到ID为 ${bookmarkId} 的书签。`);
    return;
  }
  
  if (!aiConfig || !aiConfig.apiKey) {
    bookmarks[bookmarkIndex].aiStatus = 'failed';
    bookmarks[bookmarkIndex].aiError = 'AI未配置或API密钥缺失';
    await chrome.storage.local.set({ bookmarks });
    return;
  }

  bookmarks[bookmarkIndex].aiStatus = 'processing';
  await chrome.storage.local.set({ bookmarks });

  try {
    const pageContent = await getPageContent(tabId, bookmarks[bookmarkIndex].url);
    if (!pageContent || pageContent.trim().length < 50) {
        throw new Error("无法提取有效页面内容");
    }

    const aiResponseText = await callAI(aiConfig, pageContent);
    
    const { summary, category } = parseAIResponse(aiResponseText);
    if (!summary && !category) {
        throw new Error("AI未能按预期格式返回内容");
    }
    
    let { bookmarks: finalBookmarks } = await chrome.storage.local.get("bookmarks");
    const finalIndex = finalBookmarks.findIndex(b => b.id === bookmarkId);
    if (finalIndex !== -1) {
        finalBookmarks[finalIndex].summary = summary;
        finalBookmarks[finalIndex].category = category;
        finalBookmarks[finalIndex].aiStatus = 'completed';
        finalBookmarks[finalIndex].aiError = '';
        await chrome.storage.local.set({ bookmarks: finalBookmarks });
    }

  } catch (error) {
    console.error(`AI处理书签 ${bookmarkId} 时出错:`, error);
    let { bookmarks: errorBookmarks } = await chrome.storage.local.get("bookmarks");
    const errorIndex = errorBookmarks.findIndex(b => b.id === bookmarkId);
    if (errorIndex !== -1) {
        errorBookmarks[errorIndex].aiStatus = 'failed';
        errorBookmarks[errorIndex].aiError = error.message;
        await chrome.storage.local.set({ bookmarks: errorBookmarks });
    }
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
            console.warn(`向标签页 ${tabId} 注入脚本失败, 回退到 fetch 模式。`, e);
        }
    }

    try {
        const response = await fetch(url);
        if (!response.ok) throw new Error(`Fetch请求失败，状态码: ${response.status}`);
        
        const html = await response.text();
        const textContent = await parseWithOffscreen(html);
        return textContent;

    } catch (fetchError) {
        console.error("内容提取的 fetch 回退模式也失败了:", fetchError);
        return null;
    }
}

// --- 离屏文档相关函数 ---
async function hasOffscreenDocument(path) {
    const offscreenUrl = chrome.runtime.getURL(path);
    const clients = await self.clients.matchAll();
    for (const client of clients) {
        if (client.url === offscreenUrl) {
            return true;
        }
    }
    return false;
}

async function setupOffscreenDocument(path) {
    if (await hasOffscreenDocument(path)) {
        return;
    }
    
    await chrome.offscreen.createDocument({
        url: path,
        reasons: ['DOM_PARSER'],
        justification: '用于在后台解析HTML字符串',
    }).catch(error => {
        if (!error.message.startsWith('Only a single offscreen')) {
            throw error;
        }
    });
}

async function parseWithOffscreen(html) {
    await setupOffscreenDocument('offscreen.html');
    const response = await chrome.runtime.sendMessage({
        action: 'parseHTML',
        html: html
    });
    return response.text;
}


async function callAI(aiConfig, content) {
    const truncatedContent = content.substring(0, 5000);
    
    const prompt = `你是一个严格遵循指令的文本处理API。你的任务是分析“网页内容”，并返回一个包含“summary”和“category”的JSON对象。

# 输出规则
- 摘要(summary): 严格限制在30个字以内。
- 分类(category): 提供最多6个最相关的分类，使用英文逗号(,)分隔。
- 你的回复必须且只能是一个格式正确的JSON对象，禁止包含任何解释、注释、Markdown标记或其他无关文本。

# 网页内容
---
${truncatedContent}
---

# 生成JSON输出`;

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
            max_tokens: 200,
            temperature: 0.2
        };
    } else if (aiConfig.provider === 'deepseek') {
        apiUrl = 'https://api.deepseek.com/v1/chat/completions';
        body = {
            model: aiConfig.model,
            messages: [{ role: 'user', content: prompt }],
            max_tokens: 200,
            temperature: 0.2
        };
    } else {
        throw new Error("不支持的AI提供商");
    }

    const response = await fetch(apiUrl, {
        method: 'POST',
        headers: headers,
        body: JSON.stringify(body)
    });

    if (!response.ok) {
        const errorBody = await response.json();
        console.error("AI API Error:", errorBody);
        throw new Error(`AI API请求失败: ${errorBody.error?.message || response.statusText}`);
    }

    const data = await response.json();
    if (!data.choices || !data.choices[0] || !data.choices[0].message) {
        throw new Error("AI返回了意料之外的数据结构");
    }
    
    return data.choices[0].message.content || data.choices[0].message.reasoning_content || "";
}

function parseAIResponse(text) {
    let summary = '';
    let category = '';

    try {
        const data = JSON.parse(text);
        summary = data.summary || '';
        category = data.category || '';
        if (summary || category) return { summary, category };
    } catch (e) {
        console.warn("AI response is not a direct JSON, trying to extract JSON block.");
    }

    try {
        const jsonMatch = text.match(/\{[\s\S]*\}/);
        if (jsonMatch) {
            const data = JSON.parse(jsonMatch[0]);
            summary = data.summary || '';
            category = data.category || '';
            if (summary || category) return { summary, category };
        }
    } catch (e) {
        console.warn("Failed to parse extracted JSON block, falling back to regex.");
    }
    
    if (!summary && !category) {
        const summaryMatch = text.match(/SUMMARY:\s*(.*)/i);
        const categoriesMatch = text.match(/CATEGORIES:\s*(.*)/i);
        summary = summaryMatch ? summaryMatch[1].trim() : '';
        category = categoriesMatch ? categoriesMatch[1].trim() : '';
    }

    return { summary, category };
}