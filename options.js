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

  // --- 事件监听 ---
  importBtn.addEventListener('click', handleImportBookmarks);
  tabs.forEach(tab => tab.addEventListener('click', handleTabSwitch));
  
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

    // 处理星标点击
    const star = target.closest('.star');
    if (star) {
      // 修复: ID是字符串，不应使用 parseFloat
      const id = star.dataset.id;
      handleStarToggle(id, star);
      return;
    }
    
    // 处理删除点击
    const deleteBtn = target.closest('.delete-btn');
    if (deleteBtn) {
      // 修复: ID是字符串，不应使用 parseFloat
      const id = deleteBtn.dataset.id;
      handleDeleteBookmark(id, deleteBtn);
      return;
    }
    
    // 处理标题/URL点击
    const clickable = target.closest('.clickable');
    if (clickable) {
      const url = clickable.dataset.url;
      if (url) {
        chrome.tabs.create({ url: url });
      }
    }
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
        // loadBookmarks() 会被 storage.onChanged 触发，无需手动调用
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
        // 优化: 根据后台返回的真实状态更新UI
        starElement.classList.toggle('starred', response.isStarred);
        // 更新统计
        updateStats(); 
        // 如果在“重点关注”标签页，且取消了星标，则移除该项
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
          // 优化: 直接从DOM中移除元素，而不是重新加载所有
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

  // 渲染书签列表
  function renderBookmarks() {
    bookmarkList.innerHTML = '';
    
    const filtered = currentTab === 'all' 
      ? bookmarks 
      : bookmarks.filter(b => b.isStarred);

    if (filtered.length === 0) {
      bookmarkList.innerHTML = '<div class="empty-state">暂无收藏</div>';
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
    
    div.innerHTML = `
      <img class="favicon" src="${faviconUrl}" width="16" height="16" loading="lazy" alt="">
      <div class="bookmark-info">
        <div class="bookmark-title clickable" data-url="${bookmark.url}">${bookmark.title}</div>
        <div class="bookmark-url clickable" data-url="${bookmark.url}">${bookmark.url}</div>
        <div class="bookmark-date">${formatDate(bookmark.dateAdded)}</div>
      </div>
      <div class="star ${bookmark.isStarred ? 'starred' : ''}" data-id="${bookmark.id}">★</div>
      <button class="delete-btn" data-id="${bookmark.id}" aria-label="删除">
        <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor">
          <path d="M3 6v18h18v-18h-18zm5 14c0 .552-.448 1-1 1s-1-.448-1-1v-10c0-.552.448-1 1-1s1 .448 1 1v10zm5 0c0 .552-.448 1-1 1s-1-.448-1-1v-10c0-.552.448-1 1-1s1 .448 1 1v10zm5 0c0 .552-.448 1-1 1s-1-.448-1-1v-10c0-.552.448-1 1-1s1 .448 1 1v10zm4-18v2h-20v-2h5.711c.9 0 1.631-1.099 1.631-2h5.315c0 .901.73 2 1.631 2h5.712z"/>
        </svg>
      </button>
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
