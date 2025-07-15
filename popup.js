document.addEventListener('DOMContentLoaded', async () => {
  const i18n = new I18nManager();

  // Determine language to use. Use 'zh_CN' to match folder name.
  const { language: storedLang } = await chrome.storage.local.get('language');
  const lang = storedLang || (chrome.i18n.getUILanguage().startsWith('zh') ? 'zh_CN' : 'en');
  
  await i18n.loadMessages(lang);
  i18n.applyToDOM();

  initPopup(i18n);
});


function initPopup(i18n) {
  // --- App State ---
  let currentTab = 'all';
  let bookmarks = [];

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
  loadBookmarks();
  chrome.storage.onChanged.addListener(handleStorageChange);

  // --- Event Handlers ---

  function handleAddCurrent() {
    chrome.runtime.sendMessage({ action: "addCurrentPage" }, response => {
      if (chrome.runtime.lastError) {
        console.error('Add current page failed:', chrome.runtime.lastError);
        showToast(i18n.get("operationFailed"), 2000, "#ff4444");
        return;
      }
      if (response?.status === "queued") {
        showToast(i18n.get("taskQueued"));
      } else if (response?.status === "duplicate") {
        showToast(i18n.get("pageExists"), 2000, "#ff4444");
      } else if (response?.status === "no_active_tab") {
        showToast(i18n.get("noActiveTab"), 2000, "#ff4444");
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
      const id = star.dataset.id;
      handleStarToggle(id, star);
      return;
    }

    const clickable = target.closest('.clickable');
    if (clickable) {
      const url = clickable.dataset.url;
      if (url) {
        chrome.tabs.create({ url: url });
      }
      return;
    }
  }

  function handleStarToggle(id, starElement) {
    chrome.runtime.sendMessage({ action: "toggleStar", id: id }, response => {
      if (chrome.runtime.lastError) {
        console.error('Toggle star failed:', chrome.runtime.lastError);
        showToast(i18n.get("operationFailed"), 2000, "#ff4444");
        return;
      }
      if (response?.status === "success") {
        starElement.classList.toggle('starred', response.isStarred);
      } else {
        showToast(response?.message || i18n.get("bookmarkNotFound"), 2000, "#ff4444");
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
    if (changes.bookmarks) {
      bookmarks = changes.bookmarks.newValue || [];
      renderBookmarks();
    }
    // If language is changed from options page, reload popup to reflect it.
    if (changes.language) {
        location.reload();
    }
  }

  // --- Data & Rendering ---

  function loadBookmarks() {
    chrome.storage.local.get("bookmarks", data => {
      bookmarks = data.bookmarks || [];
      renderBookmarks();
    });
  }

  function renderBookmarks() {
    bookmarkList.innerHTML = '';
    const filtered = currentTab === 'all' ? bookmarks : bookmarks.filter(b => b.isStarred);

    if (filtered.length === 0) {
      bookmarkList.innerHTML = `<div class="empty-state">${i18n.get("noBookmarks")}</div>`;
      return;
    }
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
      <div class="star ${bookmark.isStarred ? 'starred' : ''}" data-id="${bookmark.id}">★</div>
    `;
    return div;
  }

  // --- Utility Functions ---

  function getStatusHTML(bookmark) {
    const status = bookmark.aiStatus;
    if (!status || status === 'completed') return '';
    
    let statusClass = '', statusText = '';
    switch(status) {
      case 'pending':
      case 'processing':
        statusClass = 'status-processing';
        statusText = i18n.get("aiProcessing");
        break;
      case 'failed':
        statusClass = 'status-failed';
        statusText = bookmark.aiError || i18n.get("aiFailed");
        break;
    }
    
    return `
      <div class="ai-status">
        <div class="status-icon ${statusClass}"></div>
        <span class="status-text">${statusText}</span>
      </div>
    `;
  }

  function formatDate(isoString) {
    if (!isoString) return '';
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

  function getFaviconUrl(url) {
    try {
      const domain = new URL(url).hostname;
      return `https://www.google.com/s2/favicons?domain=${domain}&sz=16`;
    } catch {
      return 'icons/icon16.png';
    }
  }
}