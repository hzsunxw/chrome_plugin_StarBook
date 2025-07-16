document.addEventListener('DOMContentLoaded', async () => {
  const i18n = new I18nManager();

  // Determine language: 1. From storage, 2. From browser, 3. Default to 'en'
  // Use 'zh_CN' to match folder name.
  const { language: storedLang } = await chrome.storage.local.get('language');
  const lang = storedLang || (chrome.i18n.getUILanguage().startsWith('zh') ? 'zh_CN' : 'en');
  
  await i18n.loadMessages(lang);
  i18n.applyToDOM();
  
  initOptions(i18n, lang);
});

function initOptions(i18n, currentLang) {
  // --- App State ---
  let currentTab = 'all';
  let bookmarks = [];

  // --- Element References ---
  const importBtn = document.getElementById('importBookmarks');
  const tabs = document.querySelectorAll('.tab');
  const bookmarkList = document.getElementById('bookmarkList');
  const aiProvider = document.getElementById('aiProvider');
  const searchInput = document.getElementById('searchInput');
  const languageSelector = document.getElementById('languageSelector');
  const toggleAIConfigBtn = document.getElementById('toggleAIConfig');
  const aiConfigSection = document.getElementById('aiConfigSection');

  // --- Event Listeners ---
  importBtn.addEventListener('click', handleImportBookmarks);
  tabs.forEach(tab => tab.addEventListener('click', handleTabSwitch));
  searchInput.addEventListener('input', renderBookmarks);
  languageSelector.addEventListener('change', handleLanguageChange);
  
  // --- MODIFIED EVENT LISTENER ---
  toggleAIConfigBtn.addEventListener('click', () => {
    // Check the current display style to toggle visibility
    const isHidden = aiConfigSection.style.display === 'none' || aiConfigSection.style.display === '';
    aiConfigSection.style.display = isHidden ? 'block' : 'none';
  });

  document.getElementById('closeAIConfig').addEventListener('click', () => {
    aiConfigSection.style.display = 'none';
  });
  
  aiProvider.addEventListener('change', handleProviderChange);
  document.getElementById('saveAIConfig').addEventListener('click', saveAIConfig);
  bookmarkList.addEventListener('click', handleListClick);

  // --- Init ---
  loadBookmarks();
  loadAIConfig();
  loadLanguageSetting();
  chrome.storage.onChanged.addListener(handleStorageChange);
  
  // --- Event Handlers ---
  function handleLanguageChange() {
    const selectedLang = languageSelector.value;
    chrome.storage.local.set({ language: selectedLang }, () => {
        showToast(i18n.get("languageChanged"));
        setTimeout(() => location.reload(), 1500);
    });
  }

  function handleListClick(event) {
    const target = event.target;
    const star = target.closest('.star');
    if (star) {
      handleStarToggle(star.dataset.id, star);
      return;
    }
    const deleteBtn = target.closest('.delete-btn');
    if (deleteBtn) {
      handleDeleteBookmark(deleteBtn.dataset.id, deleteBtn);
      return;
    }
    const regenerateBtn = target.closest('.regenerate-btn');
    if (regenerateBtn) {
        handleRegenerateClick(regenerateBtn.dataset.id);
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

  function handleRegenerateClick(id) {
    showToast(i18n.get('regenerateRequestSent'));
    chrome.runtime.sendMessage({ action: "regenerateAiData", id: id }, response => {
        if (chrome.runtime.lastError) {
            console.error('Regeneration failed:', chrome.runtime.lastError);
            showToast(i18n.get("operationFailed"), 2000, "#ff4444");
            return;
        }
        if (response?.status === "queued") {
            // UI updates via storage listener
        } else if (response?.status !== "success") {
            showToast(response?.message || i18n.get("operationFailed"), 2000, "#ff4444");
        }
    });
  }

  function handleProviderChange() {
    const provider = aiProvider.value;
    document.getElementById('openaiConfig').style.display = provider === 'openai' ? 'block' : 'none';
    document.getElementById('deepseekConfig').style.display = provider === 'deepseek' ? 'block' : 'none';
  }
  
  function saveAIConfig() {
    const provider = document.getElementById('aiProvider').value;
    const config = {
      provider: provider,
      apiKey: provider === 'openai' ? document.getElementById('openaiKey').value : document.getElementById('deepseekKey').value,
      model: provider === 'openai' ? document.getElementById('openaiModel').value : document.getElementById('deepseekModel').value
    };
    chrome.storage.local.set({ aiConfig: config }, () => {
      showToast(i18n.get('configSaved'));
    });
  }
  
  function handleImportBookmarks() {
    chrome.runtime.sendMessage({ action: "importBrowserBookmarks" }, response => {
      if (chrome.runtime.lastError) {
        console.error('Import failed:', chrome.runtime.lastError);
        showToast(i18n.get("importFailed"), 2000, "#ff4444");
        return;
      }
      if (response?.count > 0) {
        showToast(i18n.get('importSuccess', {count: response.count}));
      } else if (response?.count === 0) {
        showToast(i18n.get("importNoNew"));
      }
    });
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
        if (currentTab === 'starred' && !response.isStarred) {
            starElement.closest('.bookmark-item').remove();
        }
        updateStats();
      } else {
        showToast(response?.message || i18n.get("bookmarkNotFound"), 2000, "#ff4444");
      }
    });
  }

  function handleDeleteBookmark(id) {
    if (confirm(i18n.get('confirmDelete'))) {
      chrome.runtime.sendMessage({ action: "deleteBookmark", id: id }, response => {
        if (chrome.runtime.lastError) {
          console.error('Delete failed:', chrome.runtime.lastError);
          showToast(i18n.get("operationFailed"), 2000, "#ff4444");
          return;
        }
        if (response?.status === "success") {
          showToast(i18n.get('bookmarkDeleted'));
        } else {
          showToast(response?.message || i18n.get("bookmarkNotFound"), 2000, "#ff4444");
        }
      });
    }
  }

  function handleTabSwitch(event) {
    const tab = event.target;
    if (tab.classList.contains('active')) return;
    tabs.forEach(t => t.classList.remove('active'));
    tab.classList.add('active');
    currentTab = tab.dataset.tab;
    renderBookmarks();
  }

  // --- Data & Rendering ---
  function loadLanguageSetting() {
    // The language has already been determined. Just set the dropdown to match.
    languageSelector.value = currentLang;
  }

  function loadBookmarks() {
    chrome.storage.local.get("bookmarks", data => {
      bookmarks = data.bookmarks || [];
      renderBookmarks();
      updateStats();
    });
  }

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

  function renderBookmarks() {
    bookmarkList.innerHTML = '';
    const query = searchInput.value.toLowerCase().trim();
    let filtered = currentTab === 'all' ? bookmarks : bookmarks.filter(b => b.isStarred);

    if (query) {
        // 首先，按 "或" 关系 `|` 分割成组
        const orGroups = query.split('|').map(g => g.trim()).filter(g => g);

        filtered = filtered.filter(b => {
            // 将书签的所有可搜索字段（标题、摘要、分类、URL）合并成一个字符串
            const searchableText = [
                b.title?.toLowerCase() || '',
                b.summary?.toLowerCase() || '',
                b.category?.toLowerCase() || '',
                b.url?.toLowerCase() || ''
            ].join(' ');

            // 只要有一个 "或" 组匹配成功即可 (some)
            return orGroups.some(group => {
                // 然后，在每个组内，按 "与" 关系 ` ` 分割成关键词
                const andKeywords = group.split(' ').filter(k => k);
                
                // 组内的所有关键词都必须匹配 (every)
                return andKeywords.every(keyword => searchableText.includes(keyword));
            });
        });
    }

    if (filtered.length === 0) {
      const messageKey = query ? "noMatchingBookmarks" : "noBookmarks";
      bookmarkList.innerHTML = `<div class="empty-state">${i18n.get(messageKey)}</div>`;
      return;
    }

    filtered.forEach(bookmark => {
      const item = createBookmarkElement(bookmark);
      bookmarkList.appendChild(item);
    });
  }

  function createBookmarkElement(bookmark) {
    const div = document.createElement('div');
    div.className = 'bookmark-item';
    const faviconUrl = getFaviconUrl(bookmark.url);
    const statusHTML = getStatusHTML(bookmark);
    const needsRegeneration = bookmark.aiStatus === 'failed' || (!bookmark.summary && !bookmark.category && bookmark.aiStatus !== 'processing' && bookmark.aiStatus !== 'pending');
    const regenerateButtonHTML = needsRegeneration ? `
      <button class="regenerate-btn" data-id="${bookmark.id}" aria-label="Regenerate">
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
        <button class="delete-btn" data-id="${bookmark.id}" aria-label="Delete">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor">
            <path d="M3 6v18h18v-18h-18zm5 14c0 .552-.448 1-1 1s-1-.448-1-1v-10c0-.552.448-1 1-1s1 .448 1 1v10zm5 0c0 .552-.448 1-1 1s-1-.448-1-1v-10c0-.552.448-1 1-1s1 .448 1 1v10zm5 0c0 .552-.448 1-1 1s-1-.448-1-1v-10c0-.552.448-1 1-1s1 .448 1 1v10zm4-18v2h-20v-2h5.711c.9 0 1.631-1.099 1.631-2h5.315c0 .901.73 2 1.631 2h5.712z"/>
          </svg>
        </button>
      </div>
    `;
    return div;
  }

  function handleStorageChange(changes) {
    if (changes.bookmarks) {
      bookmarks = changes.bookmarks.newValue || [];
      renderBookmarks();
      updateStats();
    }
  }

  function updateStats() {
    document.getElementById('totalCount').textContent = bookmarks.length;
    document.getElementById('starredCount').textContent = bookmarks.filter(b => b.isStarred).length;
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

  function getFaviconUrl(url) {
    try {
      const domain = new URL(url).hostname;
      return `https://www.google.com/s2/favicons?domain=${domain}&sz=16`;
    } catch {
      return 'icons/icon16.png';
    }
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
      bottom: '20px',
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
