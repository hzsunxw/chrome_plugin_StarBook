document.addEventListener('DOMContentLoaded', initOptions);

function initOptions() {
  // 初始化状态
  let currentTab = 'all';
  let bookmarks = [];

  // 元素引用
  const importBtn = document.getElementById('importBookmarks');
  const tabs = document.querySelectorAll('.tab');
  const bookmarkList = document.getElementById('bookmarkList');

  // 事件监听
  importBtn.addEventListener('click', handleImportBookmarks);
  tabs.forEach(tab => tab.addEventListener('click', handleTabSwitch));
  
  // 初始化数据加载
  loadBookmarks();
  
  // 监听存储变化
  chrome.storage.onChanged.addListener(handleStorageChange);

  // 处理导入收藏夹
  function handleImportBookmarks() {
    chrome.runtime.sendMessage(
      { action: "importBrowserBookmarks" },
      response => {
        if (chrome.runtime.lastError) {
          console.error('导入失败:', chrome.runtime.lastError);
          showToast("导入失败，请重试", 2000, "#ff4444");
          return;
        }
        if (response?.count > 0) {
          showToast(`成功导入 ${response.count} 个书签`);
          loadBookmarks();
        } else if (response?.count === 0) {
          showToast("没有新书签可导入，所有书签均已存在");
        }
      }
    );
  }

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
        <div class="bookmark-title clickable">${bookmark.title}</div>
        <div class="bookmark-url clickable">${bookmark.url}</div>
        <div class="bookmark-date">${formatDate(bookmark.dateAdded)}</div>
      </div>
      <div class="star ${bookmark.isStarred ? 'starred' : ''}"
           data-id="${bookmark.id}">★</div>
      <button class="delete-btn" data-id="${bookmark.id}" aria-label="删除">
        <svg width="16" height="16" viewBox="0 0 24 24" fill="#dc3545">
          <path d="M3 6v18h18v-18h-18zm5 14c0 .552-.448 1-1 1s-1-.448-1-1v-10c0-.552.448-1 1-1s1 .448 1 1v10zm5 0c0 .552-.448 1-1 1s-1-.448-1-1v-10c0-.552.448-1 1-1s1 .448 1 1v10zm5 0c0 .552-.448 1-1 1s-1-.448-1-1v-10c0-.552.448-1 1-1s1 .448 1 1v10zm4-18v2h-20v-2h5.711c.9 0 1.631-1.099 1.631-2h5.315c0 .901.73 2 1.631 2h5.712z"/>
        </svg>
      </button>
    `;
    
    return div;
  }

  // 处理星标切换
  // 初始化事件委托
  bookmarkList.addEventListener('click', event => {
    // 处理星标点击
    const star = event.target.closest('.star');
    if (star) {
      handleStarToggle(star);
      return;
    }
    
    // 处理删除点击
    const deleteBtn = event.target.closest('.delete-btn');
    if (deleteBtn) {
      handleDeleteBookmark(deleteBtn);
      return;
    }
    
    // 处理标题/URL点击
    const clickable = event.target.closest('.clickable');
    if (clickable) {
      const bookmarkItem = event.target.closest('.bookmark-item');
      const id = parseFloat(bookmarkItem.querySelector('.star').dataset.id);
      const bookmark = bookmarks.find(b => b.id === id);
      if (bookmark) {
        chrome.tabs.create({ url: bookmark.url });
      }
      return;
    }
  });

  function handleStarToggle(star) {
    const id = parseFloat(star.dataset.id);
    
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
        star.classList.toggle('starred');
      } else if (response?.status === "not_found") {
        showToast("书签不存在", 2000, "#ff4444");
      }
    });
  }

  // 处理删除书签
  function handleDeleteBookmark(button) {
    const id = parseFloat(button.dataset.id);
    if (confirm('确定要删除这个书签吗？')) {
      chrome.runtime.sendMessage({
        action: "deleteBookmark",
        id: id
      }, response => {
        if (chrome.runtime.lastError) {
          console.error('删除失败:', chrome.runtime.lastError);
          showToast("删除失败，请重试", 2000, "#ff4444");
          return;
        }
        if (response?.status === "success") {
          showToast("书签已删除");
          loadBookmarks();
        } else if (response?.status === "not_found") {
          showToast("书签不存在", 2000, "#ff4444");
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
    updateStats();
  }

  // 处理存储变化
  function handleStorageChange(changes) {
    if (changes.bookmarks) {
      bookmarks = changes.bookmarks.newValue;
      renderBookmarks();
      updateStats();
    }
  }

  // 更新统计信息
  function updateStats() {
    document.getElementById('totalCount').textContent = bookmarks.length;
    document.getElementById('starredCount').textContent = bookmarks.filter(b => b.isStarred).length;
  }
  
  // 获取网站favicon
  function getFaviconUrl(url) {
    try {
      const domain = new URL(url).hostname;
      return `https://www.google.com/s2/favicons?domain=${domain}&sz=16`;
    } catch {
      return 'icons/icon16.png'; // 默认图标
    }
  }

  // 工具函数：格式化日期
  function formatDate(isoString) {
    const date = new Date(isoString);
    return `${date.getFullYear()}-${(date.getMonth()+1).toString().padStart(2, '0')}-${date.getDate().toString().padStart(2, '0')} ${date.getHours().toString().padStart(2, '0')}:${date.getMinutes().toString().padStart(2, '0')}`;
  }

  // 工具函数：显示操作提示
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
      zIndex: 1000
    });
    
    document.body.appendChild(toast);
    setTimeout(() => toast.remove(), duration);
  }
}