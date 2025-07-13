// 全局书签存储（主要用于非关键性读取或缓存，但写操作不应依赖它）
let bookmarksCache = [];

// 初始化：从存储中加载书签到缓存
chrome.runtime.onStartup.addListener(loadBookmarksToCache);
chrome.runtime.onInstalled.addListener(loadBookmarksToCache);

function loadBookmarksToCache() {
  chrome.storage.local.get("bookmarks", (data) => {
    bookmarksCache = data.bookmarks || [];
    console.log("Bookmarks loaded to cache:", bookmarksCache.length);
  });
}

// 统一书签ID生成
function generateBookmarkId() {
  return crypto.randomUUID();
}

// 消息监听器
// 关键改动：将回调函数声明为 async，以便内部可以使用 await
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  const { action, id } = request;

  // 使用立即执行的异步函数来处理逻辑
  (async () => {
    // 关键修复：对于任何修改操作，都先从 storage 读取最新数据
    const { bookmarks = [] } = await chrome.storage.local.get("bookmarks");

    if (action === "addCurrentPage") {
      try {
        const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
        if (!tabs[0] || !tabs[0].url || tabs[0].url.startsWith('chrome://')) {
          sendResponse({ status: "error", message: "无法添加此类型的页面" });
          return;
        }

        const tab = tabs[0];
        if (bookmarks.some(b => b.url === tab.url)) {
          sendResponse({ status: "duplicate" });
          return;
        }

        const newBookmark = {
          url: tab.url,
          title: tab.title,
          id: generateBookmarkId(),
          dateAdded: new Date().toISOString(),
          isStarred: false,
          category: '',
          summary: '',
          aiStatus: 'pending' // 'pending', 'processing', 'completed', 'failed'
        };

        // 修改本地副本
        const updatedBookmarks = [newBookmark, ...bookmarks];

        // 将修改后的完整数据写回
        await chrome.storage.local.set({ bookmarks: updatedBookmarks });
        
        sendResponse({ status: "success", bookmark: newBookmark });

      } catch (e) {
        console.error("Error adding current page:", e);
        sendResponse({ status: "error", message: "操作失败" });
      }
    }

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
                    // 检查URL有效且在当前存储中不存在
                    if (node.url && !bookmarks.some(b => b.url === node.url)) {
                        newBookmarks.push({
                            id: generateBookmarkId(),
                            url: node.url,
                            title: node.title || '无标题',
                            dateAdded: new Date(node.dateAdded).toISOString(),
                            isStarred: false,
                            category: '',
                            summary: ''
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

  // 必须返回 true，因为我们使用了异步的 sendResponse
  return true;
});

// 确保在background.js启动时加载一次书签到缓存
loadBookmarksToCache();