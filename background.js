// 初始化书签存储
let bookmarks = [];

// 监听添加当前页请求
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.action === "addCurrentPage") {
    chrome.tabs.query({active: true, currentWindow: true}, (tabs) => {
      if (tabs[0]) {
        const tab = tabs[0];
        
        // 检查是否已存在相同URL的书签
        const isDuplicate = bookmarks.some(b => b.url === tab.url);
        if (isDuplicate) {
          sendResponse({status: "duplicate"});
          return true; // 保持消息通道开放
        }
        
        addBookmark({
          id: Date.now(),
          url: tab.url,
          title: tab.title,
          dateAdded: new Date().toISOString(),
          isStarred: false
        });
        sendResponse({status: "success"});
      } else {
        sendResponse({status: "no_active_tab"});
      }
    });
    return true; // 保持消息通道开放
  }
});

// 添加书签函数
function addBookmark(bookmark) {
  bookmarks.unshift(bookmark); // 新书签添加到开头
  chrome.storage.local.set({bookmarks});
}

// 导入浏览器书签
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.action === "importBrowserBookmarks") {
    chrome.bookmarks.getTree((bookmarkTree) => {
      const flattenBookmarks = (nodes) => {
        let results = [];
        nodes.forEach(node => {
          if (node.url) {
            // 检查是否已存在相同URL的书签
            const isDuplicate = bookmarks.some(b => b.url === node.url);
            if (!isDuplicate) {
              results.push({
                id: Date.now() + Math.random(), // 简易ID生成
                url: node.url,
                title: node.title,
                dateAdded: new Date().toISOString(),
                isStarred: false
              });
            }
          }
          if (node.children) {
            results = results.concat(flattenBookmarks(node.children));
          }
        });
        return results;
      };
      
      const newBookmarks = flattenBookmarks(bookmarkTree);
      bookmarks = [...newBookmarks, ...bookmarks];
      chrome.storage.local.set({bookmarks});
      sendResponse({count: newBookmarks.length});
    });
    return true;
  }
});

// 切换星标状态
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.action === "toggleStar") {
    const bookmark = bookmarks.find(b => b.id === request.id);
    if (bookmark) {
      bookmark.isStarred = !bookmark.isStarred;
      chrome.storage.local.set({bookmarks});
      sendResponse({status: "success", isStarred: bookmark.isStarred});
    } else {
      sendResponse({status: "not_found"});
    }
    return true;
  }
});

// 删除书签
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.action === "deleteBookmark") {
    const index = bookmarks.findIndex(b => b.id === request.id);
    if (index !== -1) {
      bookmarks.splice(index, 1);
      chrome.storage.local.set({bookmarks});
      sendResponse({status: "success"});
    } else {
      sendResponse({status: "not_found"});
    }
    return true;
  }
});

// 初始化加载存储的书签
chrome.storage.local.get("bookmarks", (data) => {
  if (data.bookmarks) bookmarks = data.bookmarks;
});
