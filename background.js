// 初始化书签存储
let bookmarks = [];

// 获取页面文本内容
async function getPageContent(url) {
  return new Promise((resolve, reject) => {
    chrome.tabs.create({ url, active: false }, tab => {
      chrome.scripting.executeScript({
        target: { tabId: tab.id },
        func: () => {
          // 提取页面主要内容
          const mainContent = document.querySelector('article, main, .post-content') ||
                             document.querySelector('body');
          return mainContent?.innerText || document.body.innerText;
        }
      }, results => {
        chrome.tabs.remove(tab.id);
        if (chrome.runtime.lastError) {
          reject(chrome.runtime.lastError);
        } else {
          resolve(results[0].result || '');
        }
      });
    });
  });
}

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
        
        // 添加书签并处理AI分类/摘要
        const newBookmark = {
          id: Date.now(),
          url: tab.url,
          title: tab.title,
          dateAdded: new Date().toISOString(),
          isStarred: false,
          category: '',
          summary: ''
        };
        
        addBookmark(newBookmark);
        sendResponse({status: "success"});
        
        // 异步处理AI分类和摘要
        processBookmarkWithAI(newBookmark).then(processed => {
          const index = bookmarks.findIndex(b => b.id === newBookmark.id);
          if (index !== -1) {
            bookmarks[index] = processed;
            chrome.storage.local.set({bookmarks});
          }
        });
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
                isStarred: false,
                category: '',      // 新增分类字段
                summary: ''        // 新增摘要字段
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
      
      // 异步处理所有新书签的AI分类/摘要
      newBookmarks.forEach(bookmark => {
        processBookmarkWithAI(bookmark).then(processed => {
          const index = bookmarks.findIndex(b => b.id === bookmark.id);
          if (index !== -1) {
            bookmarks[index] = processed;
            chrome.storage.local.set({bookmarks});
          }
        });
      });
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

// ====================== AI服务模块 ====================== //

// 书签自动分类处理
async function processBookmarkWithAI(bookmark) {
  try {
    // 获取页面内容
    const content = await getPageContent(bookmark.url);
    if (!content) return bookmark;
    
    // 生成分类和摘要提示词
    const categoryPrompt = `请将以下网页内容分类到以下类别之一：技术、新闻、购物、教育、娱乐、社交媒体、其他。只返回类别名称。\n\n${content.substring(0, 2000)}`;
    const summaryPrompt = `请用一句话总结以下网页内容（不超过20字）：\n\n${content.substring(0, 2000)}`;
    
    // 并行处理分类和摘要
    const [category, summary] = await Promise.all([
      callAIService(categoryPrompt),
      callAIService(summaryPrompt)
    ]);
    
    return {
      ...bookmark,
      category: category || '其他',
      summary: summary || '暂无摘要'
    };
  } catch (error) {
    console.error('AI处理失败:', error);
    return bookmark;
  }
}

// 获取AI配置
async function getAIConfig() {
  return new Promise(resolve => {
    chrome.storage.local.get('aiConfig', data => {
      resolve(data.aiConfig || {});
    });
  });
}

// 统一API调用函数
async function callAIService(prompt) {
  const config = await getAIConfig();
  
  if (!config.provider || !config.apiKey) {
    throw new Error('请先在选项中配置AI服务');
  }

  const endpointMap = {
    openai: 'https://api.openai.com/v1/chat/completions',
    deepseek: 'https://api.deepseek.com/v1/chat/completions'
  };

  const headers = {
    'Content-Type': 'application/json',
    'Authorization': `Bearer ${config.apiKey}`
  };

  const body = JSON.stringify({
    model: config.model || 'gpt-3.5-turbo',
    messages: [{ role: 'user', content: prompt }],
    temperature: 0.7
  });

  try {
    const response = await fetch(endpointMap[config.provider], {
      method: 'POST',
      headers,
      body
    });

    if (!response.ok) {
      const errorData = await response.json();
      throw new Error(`API错误: ${errorData.error?.message || response.statusText}`);
    }

    const result = await response.json();
    return result.choices[0].message.content.trim();
  } catch (error) {
    console.error('AI服务调用失败:', error);
    throw new Error(`服务不可用: ${error.message}`);
  }
}

// 监听AI处理请求
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.action === "processWithAI") {
    callAIService(request.prompt)
      .then(result => sendResponse({ success: true, result }))
      .catch(error => sendResponse({ success: false, error: error.message }));
    return true; // 保持消息通道开放
  }
});
