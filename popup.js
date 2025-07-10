document.addEventListener('DOMContentLoaded', initPopup);

function initPopup() {
  // 初始化状态
  let currentTab = 'all';
  let bookmarks = [];

  // 元素引用
  const addCurrentBtn = document.getElementById('addCurrent');
  const openOptionsBtn = document.getElementById('openOptions');
  const tabs = document.querySelectorAll('.tab');
  const bookmarkList = document.getElementById('bookmarkList');

  // 事件监听
  addCurrentBtn.addEventListener('click', handleAddCurrent);
  openOptionsBtn.addEventListener('click', handleOpenOptions);
  tabs.forEach(tab => tab.addEventListener('click', handleTabSwitch));
  
  // 初始化数据加载
  loadBookmarks();
  
  // 监听存储变化
  chrome.storage.onChanged.addListener(handleStorageChange);

  // 处理添加当前页面
  function handleAddCurrent() {
    chrome.runtime.sendMessage({ action: "addCurrentPage" }, response => {
      if (chrome.runtime.lastError) {
        console.error('添加当前页面失败:', chrome.runtime.lastError);
        showToast("操作失败，请重试", 2000, "#ff4444");
        return;
      }
      if (response?.status === "success") {
        showToast("已添加当前页面");
      } else if (response?.status === "duplicate") {
        showToast("该页面已存在，无需重复添加", 2000, "#ff4444");
      } else if (response?.status === "no_active_tab") {
        showToast("未找到活动标签页", 2000, "#ff4444");
      }
    });
  }

  // 处理导入收藏夹
  function handleOpenOptions() {
    chrome.runtime.openOptionsPage();
  }

  // 加载书签数据
  function loadBookmarks() {
    chrome.storage.local.get("bookmarks", data => {
      bookmarks = data.bookmarks || [];
      renderBookmarks();
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
        ${bookmark.category ? `<div class="bookmark-category">${bookmark.category}</div>` : ''}
        ${bookmark.summary ? `<div class="bookmark-summary">${bookmark.summary}</div>` : ''}
        <div class="bookmark-date">${formatDate(bookmark.dateAdded)}</div>
      </div>
      <div class="star ${bookmark.isStarred ? 'starred' : ''}"
           data-id="${bookmark.id}">★</div>
    `;
    
    // 绑定点击事件
    div.querySelectorAll('.clickable').forEach(element => {
      element.addEventListener('click', () => {
        chrome.tabs.create({ url: bookmark.url });
      });
    });
    // 绑定星标点击
    div.querySelector('.star').addEventListener('click', handleStarToggle);
    return div;
  }

  // 处理星标切换
  function handleStarToggle(event) {
    const star = event.target;
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

  // 处理选项卡切换
  function handleTabSwitch(event) {
    const tab = event.target;
    if (tab.classList.contains('active')) return;

    tabs.forEach(t => t.classList.remove('active'));
    tab.classList.add('active');
    currentTab = tab.dataset.tab;
    renderBookmarks();
  }

  // 处理存储变化
  function handleStorageChange(changes) {
    if (changes.bookmarks) {
      bookmarks = changes.bookmarks.newValue;
      renderBookmarks();
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

  // 获取网站favicon
  function getFaviconUrl(url) {
    try {
      const domain = new URL(url).hostname;
      return `https://www.google.com/s2/favicons?domain=${domain}&sz=16`;
    } catch {
      return 'icons/icon16.png'; // 默认图标
    }
  }
}
