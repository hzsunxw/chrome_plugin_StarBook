document.addEventListener('DOMContentLoaded', initOptions);

function initOptions() {
  // 初始化状态
  let currentTab = 'all';
  let bookmarks = [];

  // 元素引用
  const importBtn = document.getElementById('importBookmarks');
  const tabs = document.querySelectorAll('.tab');
  const bookmarkList = document.getElementById('bookmarkList');
  const aiProvider = document.getElementById('aiProvider');
  const searchInput = document.getElementById('searchInput'); // 【新增】获取搜索框元素

  // --- 事件监听 ---
  importBtn.addEventListener('click', handleImportBookmarks);
  tabs.forEach(tab => tab.addEventListener('click', handleTabSwitch));
  searchInput.addEventListener('input', renderBookmarks); // 【新增】为搜索框添加实时输入事件监听

  // AI配置相关事件绑定
  document.getElementById('toggleAIConfig').addEventListener('click', () => {
    document.getElementById('aiConfigSection').style.display = 'block';
  });
  
  document.getElementById('closeAIConfig').addEventListener('click', () => {
    document.getElementById('aiConfigSection').style.display = 'none';
  });
  
  aiProvider.addEventListener('change', handleProviderChange);
  document.getElementById('saveAIConfig').addEventListener('click', saveAIConfig);

  // 使用事件委托处理书签列表的点击事件
  bookmarkList.addEventListener('click', handleListClick);

  // 初始化数据加载
  loadBookmarks();
  loadAIConfig();
  
  // 监听存储变化
  chrome.storage.onChanged.addListener(handleStorageChange);
  
  // --- 事件处理函数 ---

  // 处理书签列表的集中点击事件
  function handleListClick(event) {
    const target = event.target;

    const star = target.closest('.star');
    if (star) {
      const id = star.dataset.id;
      handleStarToggle(id, star);
      return;
    }
    
    const deleteBtn = target.closest('.delete-btn');
    if (deleteBtn) {
      const id = deleteBtn.dataset.id;
      handleDeleteBookmark(id, deleteBtn);
      return;
    }

    const regenerateBtn = target.closest('.regenerate-btn');
    if (regenerateBtn) {
        const id = regenerateBtn.dataset.id;
        handleRegenerateClick(id);
        return;
    }
    
    const clickable = target.closest('.clickable');
    if (clickable) {
      const url = clickable.dataset.url;
      if (url) {
        chrome.tabs.create({ url: url });
      }
    }
  }

  // 处理重新生成的点击事件
  function handleRegenerateClick(id) {
    showToast('已发送重新生成请求...');
    // 注意：这里的响应处理可能需要根据background.js的修改来调整
    chrome.runtime.sendMessage({ action: "regenerateAiData", id: id }, response => {
        if (chrome.runtime.lastError) {
            console.error('重新生成失败:', chrome.runtime.lastError);
            showToast("操作失败，请重试", 2000, "#ff4444");
            return;
        }
        if (response?.status === "queued") {
            // "queued" 是我们新加的状态，表示任务已成功加入队列
            // showToast('请求已加入处理队列'); // 可以选择性提示，或不做任何事等待自动刷新
        } else if (response?.status !== "success") {
            showToast(response?.message || "请求失败", 2000, "#ff4444");
        }
    });
  }

  // 处理提供商切换
  function handleProviderChange() {
    const provider = aiProvider.value;
    document.getElementById('openaiConfig').style.display = provider === 'openai' ? 'block' : 'none';
    document.getElementById('deepseekConfig').style.display = provider === 'deepseek' ? 'block' : 'none';
  }
  
  // 保存AI配置
  function saveAIConfig() {
    const provider = document.getElementById('aiProvider').value;
    const openaiKey = document.getElementById('openaiKey').value;
    const deepseekKey = document.getElementById('deepseekKey').value;
    
    const config = {
      provider: provider,
      apiKey: provider === 'openai' ? openaiKey : deepseekKey,
      model: provider === 'openai'
        ? document.getElementById('openaiModel').value
        : document.getElementById('deepseekModel').value
    };
    
    chrome.storage.local.set({ aiConfig: config }, () => {
      showToast('AI设置已保存');
    });
  }
  
  // 加载AI配置
  function loadAIConfig() {
    chrome.storage.local.get('aiConfig', (data) => {
      const config = data.aiConfig || {};
      if (config.provider) {
        aiProvider.value = config.provider;
      }
      
      if (config.provider === 'openai') {
        document.getElementById('openaiKey').value = config.apiKey || '';
        document.getElementById('openaiModel').value = config.model || 'gpt-4o';
      } else {
        document.getElementById('deepseekKey').value = config.apiKey || '';
        document.getElementById('deepseekModel').value = config.model || 'deepseek-chat';
      }
      
      handleProviderChange();
    });
  }

  // 处理导入收藏夹
  function handleImportBookmarks() {
    chrome.runtime.sendMessage({ action: "importBrowserBookmarks" }, response => {
      if (chrome.runtime.lastError) {
        console.error('导入失败:', chrome.runtime.lastError);
        showToast("导入失败，请重试", 2000, "#ff4444");
        return;
      }
      if (response?.count > 0) {
        showToast(`成功导入 ${response.count} 个书签`);
      } else if (response?.count === 0) {
        showToast("没有新书签可导入");
      }
    });
  }

  // 处理星标切换
  function handleStarToggle(id, starElement) {
    chrome.runtime.sendMessage({
      action: "toggleStar",
      id: id
    }, response => {
      if (chrome.runtime.lastError) {
        console.error('切换星标失败:', chrome.runtime.lastError);
        showToast("操作失败，请重试", 2000, "#ff4444");
        return;
      }
      if (response?.status === "success") {
        starElement.classList.toggle('starred', response.isStarred);
        updateStats(); 
        if (currentTab === 'starred' && !response.isStarred) {
            starElement.closest('.bookmark-item').remove();
        }
      } else {
        showToast(response?.message || "书签不存在", 2000, "#ff4444");
      }
    });
  }

  // 处理删除书签
  function handleDeleteBookmark(id, button) {
    if (confirm('确定要删除这个书签吗？')) {
      chrome.runtime.sendMessage({ action: "deleteBookmark", id: id }, response => {
        if (chrome.runtime.lastError) {
          console.error('删除失败:', chrome.runtime.lastError);
          showToast("删除失败，请重试", 2000, "#ff4444");
          return;
        }
        if (response?.status === "success") {
          showToast("书签已删除");
          button.closest('.bookmark-item').remove();
          // 更新本地数据和统计
          bookmarks = bookmarks.filter(b => b.id !== id);
          updateStats();
        } else {
          showToast(response?.message || "书签不存在", 2000, "#ff4444");
        }
      });
    }
  }

  // 处理选项卡切换
  function handleTabSwitch(event) {
    const tab = event.target;
    if (tab.classList.contains('active')) return;

    tabs.forEach(t => t.classList.remove('active'));
    tab.classList.add('active');
    currentTab = tab.dataset.tab;
    renderBookmarks();
  }

  // --- 数据和渲染 ---

  // 加载书签数据
  function loadBookmarks() {
    chrome.storage.local.get("bookmarks", data => {
      bookmarks = data.bookmarks || [];
      renderBookmarks();
      updateStats();
    });
  }

  // 【已修改】渲染书签列表，集成搜索功能
  function renderBookmarks() {
    bookmarkList.innerHTML = '';
    
    const query = searchInput.value.toLowerCase().trim();

    // 1. 先根据Tab（全部/重点关注）进行筛选
    let filtered = currentTab === 'all' 
      ? bookmarks 
      : bookmarks.filter(b => b.isStarred);

    // 2. 如果有搜索词，在第一步筛选结果的基础上，再进行关键词筛选
    if (query) {
        filtered = filtered.filter(b => {
            const titleMatch = b.title?.toLowerCase().includes(query);
            const summaryMatch = b.summary?.toLowerCase().includes(query);
            const categoryMatch = b.category?.toLowerCase().includes(query);
            // 假设您的tags字段是一个字符串，如果是数组请使用 b.tags?.join(' ').toLowerCase().includes(query)
            const tagsMatch = b.tags?.toLowerCase().includes(query);

            return titleMatch || summaryMatch || categoryMatch || tagsMatch;
        });
    }

    if (filtered.length === 0) {
      bookmarkList.innerHTML = '<div class="empty-state">无匹配收藏</div>';
      return;
    }

    filtered.forEach(bookmark => {
      const item = createBookmarkElement(bookmark);
      bookmarkList.appendChild(item);
    });
  }

  // 创建单个书签元素
  function createBookmarkElement(bookmark) {
    const div = document.createElement('div');
    div.className = 'bookmark-item';
    const faviconUrl = getFaviconUrl(bookmark.url);
    
    let statusHTML = getStatusHTML(bookmark);

    const needsRegeneration = bookmark.aiStatus === 'failed' || (!bookmark.summary && !bookmark.category && bookmark.aiStatus !== 'processing' && bookmark.aiStatus !== 'pending');
    const regenerateButtonHTML = needsRegeneration ? `
      <button class="regenerate-btn" data-id="${bookmark.id}" aria-label="重新生成">
        <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor">
          <path d="M13.5 2c-5.621 0-10.211 4.443-10.475 10h-3.025l4.537 5.625 4.463-5.625h-2.975c.26-3.902 3.508-7 7.475-7 4.136 0 7.5 3.364 7.5 7.5s-3.364 7.5-7.5 7.5c-2.381 0-4.502-1.119-5.876-2.854l-1.849 2.463c1.979 2.338 4.992 3.891 8.225 3.891 6.075 0 11-4.925 11-11s-4.925-11-11-11z"/>
        </svg>
      </button>
    ` : '';
    
    div.innerHTML = `
      <img class="favicon" src="${faviconUrl}" width="16" height="16" loading="lazy" alt="">
      <div class="bookmark-info">
        <div class="bookmark-title clickable" data-url="${bookmark.url}">${bookmark.title}</div>
        <div class="bookmark-url clickable" data-url="${bookmark.url}">${bookmark.url}</div>
        ${bookmark.category ? `<div class="bookmark-category">${bookmark.category}</div>` : ''}
        ${bookmark.summary ? `<div class="bookmark-summary">${bookmark.summary}</div>` : ''}
        <div class="bookmark-date">${formatDate(bookmark.dateAdded)}</div>
        ${statusHTML}
      </div>
      <div class="actions" style="display: flex; align-items: center;">
        <div class="star ${bookmark.isStarred ? 'starred' : ''}" data-id="${bookmark.id}">★</div>
        ${regenerateButtonHTML}
        <button class="delete-btn" data-id="${bookmark.id}" aria-label="删除">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor">
            <path d="M3 6v18h18v-18h-18zm5 14c0 .552-.448 1-1 1s-1-.448-1-1v-10c0-.552.448-1 1-1s1 .448 1 1v10zm5 0c0 .552-.448 1-1 1s-1-.448-1-1v-10c0-.552.448-1 1-1s1 .448 1 1v10zm5 0c0 .552-.448 1-1 1s-1-.448-1-1v-10c0-.552.448-1 1-1s1 .448 1 1v10zm4-18v2h-20v-2h5.711c.9 0 1.631-1.099 1.631-2h5.315c0 .901.73 2 1.631 2h5.712z"/>
          </svg>
        </button>
      </div>
    `;
    
    return div;
  }

  // 处理存储变化
  function handleStorageChange(changes) {
    if (changes.bookmarks) {
      bookmarks = changes.bookmarks.newValue || [];
      renderBookmarks();
      updateStats();
    }
  }

  // 更新统计信息
  function updateStats() {
    document.getElementById('totalCount').textContent = bookmarks.length;
    document.getElementById('starredCount').textContent = bookmarks.filter(b => b.isStarred).length;
  }
  
  // --- 工具函数 ---

  function getStatusHTML(bookmark) {
    const status = bookmark.aiStatus;
    if (!status || status === 'completed') return '';
    
    let statusClass = '', statusText = '';
    switch(status) {
      case 'pending':
      case 'processing':
        statusClass = 'status-processing';
        statusText = 'AI处理中...';
        break;
      case 'failed':
        statusClass = 'status-failed';
        statusText = bookmark.aiError || 'AI处理失败';
        break;
    }
    
    return `
      <div class="ai-status">
        <div class="status-icon ${statusClass}"></div>
        <span class="status-text">${statusText}</span>
      </div>
    `;
  }

  function getFaviconUrl(url) {
    try {
      const domain = new URL(url).hostname;
      return `https://www.google.com/s2/favicons?domain=${domain}&sz=16`;
    } catch {
      return 'icons/icon16.png';
    }
  }

  function formatDate(isoString) {
    const date = new Date(isoString);
    return `${date.getFullYear()}-${(date.getMonth()+1).toString().padStart(2, '0')}-${date.getDate().toString().padStart(2, '0')} ${date.getHours().toString().padStart(2, '0')}:${date.getMinutes().toString().padStart(2, '0')}`;
  }

  function showToast(message, duration=2000, color="#4285f4") {
    const toast = document.createElement('div');
    toast.textContent = message;
    Object.assign(toast.style, {
      position: 'fixed',
      top: '20px',
      left: '50%',
      transform: 'translateX(-50%)',
      background: color,
      color: 'white',
      padding: '10px 20px',
      borderRadius: '4px',
      zIndex: 1000,
      textAlign: 'center'
    });
    
    document.body.appendChild(toast);
    setTimeout(() => toast.remove(), duration);
  }
}