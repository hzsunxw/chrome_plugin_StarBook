document.addEventListener('DOMContentLoaded', async () => {
  const i18n = new I18nManager();
  const { language: storedLang } = await chrome.storage.local.get('language');
  const lang = storedLang || (chrome.i18n.getUILanguage().startsWith('zh') ? 'zh_CN' : 'en');
  
  await i18n.loadMessages(lang);
  i18n.applyToDOM();

  initPopup(i18n);
});


function initPopup(i18n) {
  // --- App State ---
  let currentTab = 'all';
  let allItems = [];

  // --- Element References ---
  const addCurrentBtn = document.getElementById('addCurrent');
  const openOptionsBtn = document.getElementById('openOptions');
  const tabs = document.querySelectorAll('.tab');
  const bookmarkList = document.getElementById('bookmarkList');

  // --- Event Listeners ---
  addCurrentBtn.addEventListener('click', handleAddCurrent);
  openOptionsBtn.addEventListener('click', handleOpenOptions);
  tabs.forEach(tab => tab.addEventListener('click', handleTabSwitch));
  bookmarkList.addEventListener('click', handleListClick);

  // --- Init ---
  loadItems();
  chrome.storage.onChanged.addListener(handleStorageChange);

  // --- Event Handlers ---

  function handleAddCurrent() {
    // 添加调试信息
    console.log("Add current page button clicked");
    
    // 显示加载状态
    showToast(i18n.get("processing") || "Processing...");
    
    // Adding to root by default from popup
    chrome.runtime.sendMessage({ action: "addCurrentPage", data: { parentId: 'root' } }, response => {
      console.log("Response received:", response);
      
      if (chrome.runtime.lastError) {
        console.error("Runtime error:", chrome.runtime.lastError);
        showToast(i18n.get("operationFailed") || "Operation failed", 2000, "#ff4444");
        return;
      }
      
      if (!response) {
        console.error("No response received");
        showToast(i18n.get("operationFailed") || "Operation failed", 2000, "#ff4444");
        return;
      }
      
      if (response.status === "queued") {
        showToast(i18n.get("taskQueued") || "Task queued");
      } else if (response.status === "duplicate") {
        showToast(i18n.get("pageExists") || "Page already exists", 2000, "#ff4444");
      } else if (response.status === "no_active_tab") {
        showToast(i18n.get("noActiveTab") || "No active tab", 2000, "#ff4444");
      } else {
        showToast(i18n.get("operationFailed") || "Operation failed", 2000, "#ff4444");
      }
    });
  }

  function handleOpenOptions() {
    chrome.runtime.openOptionsPage();
  }

  function handleListClick(event) {
    const target = event.target;
    const star = target.closest('.star');
    if (star) {
      handleStarToggle(star.dataset.id, star);
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

  function handleStarToggle(id, starElement) {
    chrome.runtime.sendMessage({ action: "toggleStar", id: id }, response => {
      if (chrome.runtime.lastError) {
        showToast(i18n.get("operationFailed"), 2000, "#ff4444");
        return;
      }
      if (response?.status === "success") {
        starElement.classList.toggle('starred', response.isStarred);
      }
    });
  }

  function handleTabSwitch(event) {
    const tab = event.target;
    if (tab.classList.contains('active')) return;
    tabs.forEach(t => t.classList.remove('active'));
    tab.classList.add('active');
    currentTab = tab.dataset.tab;
    renderBookmarks();
  }

  function handleStorageChange(changes) {
    if (changes.bookmarkItems) {
      allItems = changes.bookmarkItems.newValue || [];
      renderBookmarks();
    }
    if (changes.language) {
        location.reload();
    }
  }

  // --- Data & Rendering ---

  function loadItems() {
    chrome.storage.local.get("bookmarkItems", data => {
      allItems = data.bookmarkItems || [];
      renderBookmarks();
    });
  }

  function renderBookmarks() {
    bookmarkList.innerHTML = '';
    
    // Get only bookmarks, not folders
    let bookmarks = allItems.filter(item => item.type === 'bookmark');

    // Filter by tab (all or starred)
    const filtered = currentTab === 'all' ? bookmarks : bookmarks.filter(b => b.isStarred);

    if (filtered.length === 0) {
      bookmarkList.innerHTML = `<div class="empty-state">${i18n.get("noBookmarks")}</div>`;
      return;
    }

    // Sort by date added and take the most recent 100
    filtered.sort((a, b) => new Date(b.dateAdded) - new Date(a.dateAdded));
    filtered.slice(0, 100).forEach(bookmark => {
      const item = createBookmarkElement(bookmark);
      bookmarkList.appendChild(item);
    });
  }

  function createBookmarkElement(bookmark) {
    const div = document.createElement('div');
    div.className = 'bookmark-item';
    const faviconUrl = getFaviconUrl(bookmark.url);
    const statusHTML = getStatusHTML(bookmark);
    
    let html = `
      <img class="favicon" src="${faviconUrl}" width="16" height="16" loading="lazy" alt="">
      <div class="bookmark-info">
        <div class="bookmark-title clickable" data-url="${bookmark.url}">${bookmark.title}</div>
        <div class="bookmark-url clickable" data-url="${bookmark.url}">${bookmark.url}</div>
    `;
    
    // 显示增强的AI分析结果
    if (bookmark.aiStatus === 'completed') {
      // 主分类
      if (bookmark.category) {
        html += `<div class="bookmark-category">${bookmark.category}</div>`;
      }
      
      // 标签（在弹窗中只显示前3个）
      if (bookmark.tags && bookmark.tags.length > 0) {
        const displayTags = bookmark.tags.slice(0, 3);
        html += `<div class="bookmark-tags-popup">
          ${displayTags.map(tag => `<span class="tag-popup" data-tag="${tag}">${tag}</span>`).join('')}
          ${bookmark.tags.length > 3 ? `<span class="tag-more">+${bookmark.tags.length - 3}</span>` : ''}
        </div>`;
      }
      
      // 摘要
      if (bookmark.summary) {
        html += `<div class="bookmark-summary">${bookmark.summary}</div>`;
      }
      
      // 内容类型和阅读时间（紧凑显示）
      if (bookmark.contentType || bookmark.estimatedReadTime) {
        html += `<div class="bookmark-meta">`;
        if (bookmark.contentType) {
          html += `<span class="meta-item">${i18n.get('contentType_' + bookmark.contentType) || bookmark.contentType}</span>`;
        }
        if (bookmark.estimatedReadTime) {
          html += `<span class="meta-item">${bookmark.estimatedReadTime}${i18n.get('minutes')}</span>`;
        }
        html += `</div>`;
      }
    } else {
      html += statusHTML;
    }
    
    html += `
        <div class="bookmark-date">${formatDate(bookmark.dateAdded)}</div>
      </div>
      <div class="star ${bookmark.isStarred ? 'starred' : ''}" data-id="${bookmark.id}">★</div>
    `;
    
    div.innerHTML = html;
    
    // 添加标签点击事件监听器
    const tagElements = div.querySelectorAll('.tag-popup[data-tag]');
    tagElements.forEach(tagEl => {
      tagEl.addEventListener('click', (e) => {
        e.stopPropagation();
        // 可以添加标签搜索功能
        console.log('Tag clicked:', tagEl.dataset.tag);
      });
    });
    
    return div;
  }

  // --- Utility Functions ---

  function getStatusHTML(bookmark) {
    const status = bookmark.aiStatus;
    if (!status || status === 'completed') return '';
    
    let statusText = '';
    let statusClass = '';

    switch(status) {
      case 'pending':
        statusText = i18n.get("aiProcessing");
        statusClass = 'status-processing';
        break;
      case 'processing':
        statusText = i18n.get("aiProcessing");
        statusClass = 'status-processing';
        break;
      case 'failed':
        statusText = i18n.get("aiFailed");
        statusClass = 'status-failed';
        break;
    }

    if (statusText) {
      return `<div class="ai-status"><div class="status-icon ${statusClass}"></div>${statusText}</div>`;
    }
    return '';
  }

  function formatDate(isoString) { if (!isoString) return ''; const d = new Date(isoString); return `${d.getFullYear()}-${(d.getMonth()+1).toString().padStart(2, '0')}-${d.getDate().toString().padStart(2, '0')} ${d.getHours().toString().padStart(2, '0')}:${d.getMinutes().toString().padStart(2, '0')}`; }
  function showToast(message, duration=2000, color="#4285f4") { const t = document.createElement('div'); t.textContent = message; Object.assign(t.style, { position: 'fixed', top: '20px', left: '50%', transform: 'translateX(-50%)', background: color, color: 'white', padding: '10px 20px', borderRadius: '4px', zIndex: 1000, textAlign: 'center' }); document.body.appendChild(t); setTimeout(() => t.remove(), duration); }
  function getFaviconUrl(url) { try { return `https://www.google.com/s2/favicons?domain=${new URL(url).hostname}&sz=16`; } catch { return 'icons/icon16.png'; } }
}
