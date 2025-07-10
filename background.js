// 全局书签存储
let bookmarks = [];

// 初始化：从存储中加载书签
chrome.runtime.onStartup.addListener(loadBookmarksFromStorage);
chrome.runtime.onInstalled.addListener(loadBookmarksFromStorage);

function loadBookmarksFromStorage() {
  chrome.storage.local.get("bookmarks", (data) => {
    bookmarks = data.bookmarks || [];
    console.log("Bookmarks loaded on startup:", bookmarks.length);
  });
}

// 统一书签ID生成
function generateBookmarkId() {
  return crypto.randomUUID();
}

// 统一书签操作服务
const bookmarkService = {
  add: (bookmarkData) => {
    const newBookmark = {
      ...bookmarkData,
      id: generateBookmarkId(),
      dateAdded: new Date().toISOString(),
      isStarred: false,
      category: '',
      summary: '',
      aiStatus: 'pending' // 'pending', 'processing', 'completed', 'failed'
    };
    bookmarks.unshift(newBookmark);
    chrome.storage.local.set({ bookmarks });
    return newBookmark;
  },

  delete: (id) => {
    return new Promise((resolve, reject) => {
      const index = bookmarks.findIndex(b => b.id === id);
      if (index !== -1) {
        bookmarks.splice(index, 1);
        chrome.storage.local.set({ bookmarks }, () => {
          chrome.runtime.lastError 
            ? reject("存储更新失败") 
            : resolve(true);
        });
      } else {
        reject("书签不存在");
      }
    });
  },

  toggleStar: (id) => {
    return new Promise((resolve, reject) => {
      const bookmark = bookmarks.find(b => b.id === id);
      if (bookmark) {
        bookmark.isStarred = !bookmark.isStarred;
        chrome.storage.local.set({ bookmarks }, () => {
          chrome.runtime.lastError 
            ? reject("存储更新失败") 
            : resolve(bookmark.isStarred); // 返回最新的状态
        });
      } else {
        reject("书签不存在");
      }
    });
  },

  update: (id, updates) => {
      const index = bookmarks.findIndex(b => b.id === id);
      if (index !== -1) {
          bookmarks[index] = { ...bookmarks[index], ...updates, lastUpdated: new Date().toISOString() };
          chrome.storage.local.set({ bookmarks });
      }
  }
};

// 消息监听器
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  const action = request.action;
  
  if (action === "addCurrentPage") {
    chrome.tabs.query({active: true, currentWindow: true}, (tabs) => {
      if (!tabs[0] || !tabs[0].url || tabs[0].url.startsWith('chrome://')) {
        sendResponse({status: "error", message: "无法添加此类型的页面"});
        return;
      }

      const tab = tabs[0];
      if (bookmarks.some(b => b.url === tab.url)) {
        sendResponse({status: "duplicate"});
        return;
      }

      const newBookmark = bookmarkService.add({ url: tab.url, title: tab.title });
      sendResponse({status: "success", bookmark: newBookmark});

      // 异步AI处理 (此处为占位逻辑，实际AI调用需实现)
      // processBookmarkWithAI(newBookmark);
    });
    return true; // 异步需要返回true
  }

  if (action === "deleteBookmark") {
    bookmarkService.delete(request.id)
      .then(() => sendResponse({status: "success"}))
      .catch(errorMsg => sendResponse({status: "error", message: errorMsg}));
    return true;
  }

  if (action === "toggleStar") {
    bookmarkService.toggleStar(request.id)
      .then(newState => sendResponse({status: "success", isStarred: newState}))
      .catch(errorMsg => sendResponse({status: "error", message: errorMsg}));
    return true;
  }

  if (action === "importBrowserBookmarks") {
    chrome.bookmarks.getTree((bookmarkTree) => {
      const newBookmarks = [];
      const flattenBookmarks = (nodes) => {
        nodes.forEach(node => {
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
        });
      };

      flattenBookmarks(bookmarkTree);
      if (newBookmarks.length > 0) {
        bookmarks = [...newBookmarks, ...bookmarks];
        chrome.storage.local.set({bookmarks}, () => {
          sendResponse({status: "success", count: newBookmarks.length});
        });
      } else {
        sendResponse({status: "success", count: 0});
      }
    });
    return true;
  }
});

// 确保在background.js启动时加载一次书签
loadBookmarksFromStorage();
