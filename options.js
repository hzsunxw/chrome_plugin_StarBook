document.addEventListener('DOMContentLoaded', async () => {
  const i18n = new I18nManager();
  try {
    const { language: storedLang } = await chrome.storage.local.get('language');
    const lang = storedLang || (chrome.i18n.getUILanguage().startsWith('zh') ? 'zh_CN' : 'en');
    
    await i18n.loadMessages(lang);
    i18n.applyToDOM();
    
    initOptions(i18n, lang);
  } catch (error) {
    console.error("Failed to initialize options page:", error);
    // Display an error message to the user on the page itself
    document.body.innerHTML = `<div style="padding: 20px; text-align: center; color: red;">Error: Could not load extension settings. Please try reloading the page.</div>`;
  }
});

function initOptions(i18n, currentLang) {
  // --- App State ---
  let allItems = [];
  let activeFolderId = 'root';
  let contextMenuFolderId = null; // To store the ID of the right-clicked folder

  // --- Element References ---
  const importBtn = document.getElementById('importBookmarks');
  const searchInput = document.getElementById('searchInput');
  const languageSelector = document.getElementById('languageSelector');
  const toggleAIConfigBtn = document.getElementById('toggleAIConfig');
  const aiConfigSection = document.getElementById('aiConfigSection');
  const folderTreeContainer = document.getElementById('folder-tree-container');
  const bookmarkListContainer = document.getElementById('bookmark-list-container');
  const aiProvider = document.getElementById('aiProvider');
  // Context Menu Elements
  const folderContextMenu = document.getElementById('folder-context-menu');
  const deleteFolderBtn = document.getElementById('delete-folder-btn');


  // --- Event Listeners ---
  importBtn.addEventListener('click', handleImportBookmarks);
  searchInput.addEventListener('input', handleSearch);
  languageSelector.addEventListener('change', handleLanguageChange);
  toggleAIConfigBtn.addEventListener('click', () => { aiConfigSection.style.display = 'block'; });
  document.getElementById('closeAIConfig').addEventListener('click', () => { aiConfigSection.style.display = 'none'; });
  aiProvider.addEventListener('change', handleProviderChange);
  document.getElementById('saveAIConfig').addEventListener('click', saveAIConfig);
  folderTreeContainer.addEventListener('click', handleTreeClick);
  bookmarkListContainer.addEventListener('click', handleListClick);
  // Context Menu Listeners
  folderTreeContainer.addEventListener('contextmenu', handleTreeContextMenu);
  deleteFolderBtn.addEventListener('click', handleDeleteFolder);
  window.addEventListener('click', () => { folderContextMenu.style.display = 'none'; });


  // --- Init ---
  loadAllItems();
  loadAIConfig();
  loadLanguageSetting();
  chrome.storage.onChanged.addListener(handleStorageChange);
  
  // --- Main Functions ---
  function loadAllItems() {
    chrome.storage.local.get("bookmarkItems", data => {
      allItems = data.bookmarkItems || [];
      renderFolderTree();
      renderBookmarkList(activeFolderId);
    });
  }

  function renderFolderTree() {
    folderTreeContainer.innerHTML = '';
    const tree = document.createElement('div');
    tree.className = 'folder-tree';

    const specialFolders = [
        { id: 'root', titleKey: 'allBookmarks', count: allItems.filter(i => i.type === 'bookmark').length, icon: 'all' },
        { id: 'starred', titleKey: 'starredBookmarks', count: allItems.filter(i => i.isStarred).length, icon: 'star' }
    ];

    specialFolders.forEach(folder => {
        const itemEl = createTreeItem({ id: folder.id, title: i18n.get(folder.titleKey), type: 'special', icon: folder.icon }, 0, folder.count);
        tree.appendChild(itemEl);
    });

    const buildTree = (parentId, level) => {
        const ul = document.createElement('ul');
        const children = allItems.filter(item => item.parentId === parentId && item.type === 'folder');
        children.sort((a,b) => a.title.localeCompare(b.title));
        
        children.forEach(child => {
            const li = document.createElement('li');
            const childCount = allItems.filter(i => i.parentId === child.id && i.type === 'bookmark').length;
            const itemEl = createTreeItem(child, level, childCount);
            li.appendChild(itemEl);

            const grandChildrenContainer = document.createElement('div');
            grandChildrenContainer.className = 'tree-item-children';
            grandChildrenContainer.appendChild(buildTree(child.id, level + 1));
            li.appendChild(grandChildrenContainer);
            
            ul.appendChild(li);
        });
        return ul;
    };
    tree.appendChild(buildTree('root', 0));
    folderTreeContainer.appendChild(tree);

    const activeEl = folderTreeContainer.querySelector(`.tree-item[data-id="${activeFolderId}"]`);
    if (activeEl) activeEl.classList.add('active');
  }

  function renderBookmarkList(folderId, searchResults = null) {
      bookmarkListContainer.innerHTML = '';
      let itemsToShow = [];
      let breadcrumbText = '';

      if (searchResults !== null) {
          itemsToShow = searchResults;
          breadcrumbText = i18n.get('searchResults');
      } else {
          activeFolderId = folderId;
          if (folderId === 'starred') {
              itemsToShow = allItems.filter(item => item.isStarred && item.type === 'bookmark');
              breadcrumbText = i18n.get('starredBookmarks');
          } else if (folderId === 'root') {
              itemsToShow = allItems.filter(item => item.type === 'bookmark');
              breadcrumbText = i18n.get('allBookmarks');
          } else {
              itemsToShow = allItems.filter(item => item.parentId === folderId && item.type === 'bookmark');
              breadcrumbText = getBreadcrumb(folderId);
          }
          const oldActive = folderTreeContainer.querySelector('.tree-item.active');
          if(oldActive) oldActive.classList.remove('active');
          const newActive = folderTreeContainer.querySelector(`.tree-item[data-id="${folderId}"]`);
          if(newActive) newActive.classList.add('active');
      }
      
      const breadcrumbEl = document.createElement('div');
      breadcrumbEl.className = 'breadcrumb';
      breadcrumbEl.textContent = breadcrumbText;
      bookmarkListContainer.appendChild(breadcrumbEl);
      
      itemsToShow.sort((a, b) => new Date(b.dateAdded) - new Date(a.dateAdded));

      if (itemsToShow.length === 0) {
          const emptyState = document.createElement('div');
          emptyState.className = 'empty-state';
          emptyState.textContent = i18n.get(searchResults !== null ? 'noMatchingBookmarks' : 'folderEmpty');
          bookmarkListContainer.appendChild(emptyState);
          return;
      }
      
      itemsToShow.forEach(item => {
          const itemEl = createBookmarkElement(item);
          bookmarkListContainer.appendChild(itemEl);
      });
  }

  function handleSearch() {
      const query = searchInput.value.toLowerCase().trim();
      if (!query) {
          renderBookmarkList(activeFolderId);
          return;
      }
      const orGroups = query.split('|').map(g => g.trim()).filter(g => g);
      const results = allItems.filter(item => {
          if (item.type !== 'bookmark') return false;
          const searchableText = [item.title, item.summary, item.category, item.url].join(' ').toLowerCase();
          return orGroups.some(group => {
              const andKeywords = group.split(' ').filter(k => k);
              return andKeywords.every(keyword => searchableText.includes(keyword));
          });
      });
      renderBookmarkList(null, results);
  }

  // --- Event Handlers ---
  function handleTreeClick(event) {
      const target = event.target.closest('.tree-item');
      if (!target) return;
      
      const id = target.dataset.id;
      const type = target.dataset.type;

      if (type === 'folder') {
          const isToggleClick = event.target.closest('.icon.toggle');
          if (isToggleClick) {
              target.classList.toggle('collapsed');
          } else {
              searchInput.value = '';
              renderBookmarkList(id);
          }
      } else if (type === 'special') {
          searchInput.value = '';
          renderBookmarkList(id);
      }
  }
  
  function handleListClick(event) {
    const target = event.target;
    const actionBtn = target.closest('.action-btn');
    if (actionBtn) {
        const id = actionBtn.dataset.id;
        if (actionBtn.classList.contains('star')) handleStarToggle(id, actionBtn);
        if (actionBtn.classList.contains('delete-btn')) handleDelete(id);
        if (actionBtn.classList.contains('regenerate-btn')) handleRegenerateClick(id);
        return;
    }
    const clickable = target.closest('.clickable');
    if (clickable) {
      chrome.tabs.create({ url: clickable.dataset.url });
    }
  }

  function handleDelete(id) {
    if (confirm(i18n.get('confirmDelete'))) {
      chrome.runtime.sendMessage({ action: "deleteBookmark", id: id }, response => {
        if (chrome.runtime.lastError || response?.status !== "success") {
          showToast(i18n.get("operationFailed"), 2000, "#ff4444");
        } else {
          showToast(i18n.get('bookmarkDeleted'));
        }
      });
    }
  }
  
  function handleStorageChange(changes) {
    if (changes.bookmarkItems) {
      allItems = changes.bookmarkItems.newValue || [];
      // If the active folder no longer exists, switch to root
      if (!allItems.some(item => item.id === activeFolderId)) {
          activeFolderId = 'root';
      }
      renderFolderTree();
      if (searchInput.value.trim()) {
        handleSearch();
      } else {
        renderBookmarkList(activeFolderId);
      }
    }
  }

  function handleLanguageChange() {
    const selectedLang = languageSelector.value;
    chrome.storage.local.set({ language: selectedLang }, () => {
        showToast(i18n.get("languageChanged"));
        setTimeout(() => location.reload(), 1000);
    });
  }

  function handleProviderChange() {
    const provider = aiProvider.value;
    document.getElementById('openaiConfig').style.display = provider === 'openai' ? 'block' : 'none';
    document.getElementById('deepseekConfig').style.display = provider === 'deepseek' ? 'block' : 'none';
    document.getElementById('openrouterConfig').style.display = provider === 'openrouter' ? 'block' : 'none';
  }
  
  function saveAIConfig() {
    const provider = document.getElementById('aiProvider').value;
    let config = { provider };

    if (provider === 'openai') {
        config.apiKey = document.getElementById('openaiKey').value;
        config.model = document.getElementById('openaiModel').value;
    } else if (provider === 'deepseek') {
        config.apiKey = document.getElementById('deepseekKey').value;
        config.model = document.getElementById('deepseekModel').value;
    } else if (provider === 'openrouter') {
        config.apiKey = document.getElementById('openrouterKey').value;
        config.model = document.getElementById('openrouterModel').value;
    }

    chrome.storage.local.set({ aiConfig: config }, () => {
      showToast(i18n.get('configSaved'));
    });
  }

  function loadAIConfig() {
    chrome.storage.local.get('aiConfig', (data) => {
      const config = data.aiConfig || {};
      if (config.provider) {
        aiProvider.value = config.provider;
      }
      // Set values for all fields, regardless of current provider, to preserve them
      document.getElementById('openaiKey').value = config.provider === 'openai' ? config.apiKey || '' : '';
      document.getElementById('openaiModel').value = config.provider === 'openai' ? config.model || 'gpt-4o' : 'gpt-4o';
      
      document.getElementById('deepseekKey').value = config.provider === 'deepseek' ? config.apiKey || '' : '';
      document.getElementById('deepseekModel').value = config.provider === 'deepseek' ? config.model || 'deepseek-chat' : 'deepseek-chat';
      
      document.getElementById('openrouterKey').value = config.provider === 'openrouter' ? config.apiKey || '' : '';
      document.getElementById('openrouterModel').value = config.provider === 'openrouter' ? config.model || '' : '';
      
      handleProviderChange();
    });
  }

  function handleImportBookmarks() {
    chrome.runtime.sendMessage({ action: "importBrowserBookmarks" }, response => {
      if (chrome.runtime.lastError || response?.status !== "success") {
        showToast(i18n.get("importFailed"), 2000, "#ff4444");
      } else if (response.count > 0) {
        showToast(i18n.get('importSuccess', {count: response.count}));
      } else {
        showToast(i18n.get("importNoNew"));
      }
    });
  }

  function handleStarToggle(id, starElement) {
    chrome.runtime.sendMessage({ action: "toggleStar", id: id }, response => {
      if (chrome.runtime.lastError || response?.status !== "success") {
        showToast(i18n.get("operationFailed"), 2000, "#ff4444");
      }
    });
  }

  function handleRegenerateClick(id) {
    showToast(i18n.get('regenerateRequestSent'));
    chrome.runtime.sendMessage({ action: "regenerateAiData", id: id }, response => {
        if (chrome.runtime.lastError) {
            showToast(i18n.get("operationFailed"), 2000, "#ff4444");
        } else if (response?.status === "already_queued") {
            showToast(i18n.get("taskAlreadyQueued"), 2000, "#ff9800");
        }
    });
  }

  // --- Context Menu Handlers ---
  function handleTreeContextMenu(event) {
    const target = event.target.closest('.tree-item');
    // Only show context menu for actual folders, not special items like 'All Bookmarks'
    if (!target || target.dataset.type !== 'folder') {
        folderContextMenu.style.display = 'none';
        return;
    }
    
    event.preventDefault();
    contextMenuFolderId = target.dataset.id;
    
    folderContextMenu.style.top = `${event.pageY}px`;
    folderContextMenu.style.left = `${event.pageX}px`;
    folderContextMenu.style.display = 'block';
  }

  function handleDeleteFolder() {
    if (!contextMenuFolderId) return;

    const folderToDelete = allItems.find(item => item.id === contextMenuFolderId);
    if (!folderToDelete) return;

    // Manually handle placeholder replacement because the generic i18n function is not working as expected.
    let confirmationMessage = i18n.get('confirmDeleteFolder');
    confirmationMessage = confirmationMessage.replace('$folderName$', folderToDelete.title);
    
    if (confirm(confirmationMessage)) {
      // The background action 'deleteBookmark' is generic and can delete any item by ID, 
      // including folders and all their contents recursively.
      chrome.runtime.sendMessage({ action: "deleteBookmark", id: contextMenuFolderId }, response => {
        if (chrome.runtime.lastError || response?.status !== "success") {
          showToast(i18n.get("operationFailed"), 2000, "#ff4444");
        } else {
          showToast(i18n.get('folderDeleted'));
        }
      });
    }
    contextMenuFolderId = null; // Reset after use
  }


  // --- Helper Functions ---
  function createTreeItem(item, level, count) {
    const div = document.createElement('div');
    div.className = 'tree-item';
    div.dataset.id = item.id;
    div.dataset.type = item.type;
    div.style.paddingLeft = `${8 + level * 20}px`;

    let iconHtml = '';
    if (item.type === 'folder') {
        const hasChildren = allItems.some(i => i.parentId === item.id && i.type === 'folder');
        const toggleIcon = hasChildren ? `<svg class="icon toggle" viewBox="0 0 24 24"><path d="M7.41 8.59L12 13.17l4.59-4.58L18 10l-6 6-6-6 1.41-1.41z" fill="currentColor"></path></svg>` : `<span class="icon toggle" style="width: 24px; display: inline-block;"></span>`;
        iconHtml = `${toggleIcon}<svg class="icon folder" viewBox="0 0 24 24"><path d="M10 4H4c-1.1 0-1.99.9-1.99 2L2 18c0 1.1.9 2 2 2h16c1.1 0 2-.9 2-2V8c0-1.1-.9-2-2-2h-8l-2-2z" fill="currentColor"></path></svg>`;
    } else if (item.type === 'special') {
        const icon = item.icon === 'star' 
            ? `<svg class="icon star" viewBox="0 0 24 24" fill="gold"><path d="M12 17.27L18.18 21l-1.64-7.03L22 9.24l-7.19-.61L12 2 9.19 8.63 2 9.24l5.46 4.73L5.82 21z"></path></svg>`
            : `<svg class="icon" viewBox="0 0 24 24"><path d="M3 13h8V3H3v10zm0 8h8v-6H3v6zm10 0h8V11h-8v10zm0-18v6h8V3h-8z" fill="currentColor"></path></svg>`;
        iconHtml = `<span class="icon toggle" style="width: 24px; display: inline-block;"></span>${icon}`;
    }

    div.innerHTML = `${iconHtml}<span class="title">${item.title}</span> <span style="margin-left:auto; font-size:12px; color:#666;">${count}</span>`;
    return div;
  }

  function createBookmarkElement(bookmark) {
    const div = document.createElement('div');
    div.className = 'bookmark-item';
    const faviconUrl = getFaviconUrl(bookmark.url);
    const statusHTML = getStatusHTML(bookmark);
    const needsRegeneration = bookmark.aiStatus === 'failed' || bookmark.aiStatus === 'processing';
    const regenerateButtonHTML = needsRegeneration ? `<button class="action-btn regenerate-btn" data-id="${bookmark.id}" title="${i18n.get('regenerateTooltip')}"><svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor"><path d="M13.5 2c-5.621 0-10.211 4.443-10.475 10h-3.025l4.537 5.625 4.463-5.625h-2.975c.26-3.902 3.508-7 7.475-7 4.136 0 7.5 3.364 7.5 7.5s-3.364 7.5-7.5 7.5c-2.381 0-4.502-1.119-5.876-2.854l-1.849 2.463c1.979 2.338 4.992 3.891 8.225 3.891 6.075 0 11-4.925 11-11s-4.925-11-11-11z"/></svg></button>` : '';
    
    div.innerHTML = `
      <img class="favicon" src="${faviconUrl}" width="16" height="16" loading="lazy" alt="">
      <div class="bookmark-info">
        <div class="bookmark-title clickable" data-url="${bookmark.url}">${bookmark.title}</div>
        <div class="bookmark-url clickable" data-url="${bookmark.url}">${bookmark.url}</div>
        ${bookmark.category ? `<div class="bookmark-category" style="font-size: 11px; color: #4285f4; font-weight: bold; margin-top: 3px;">${bookmark.category}</div>` : ''}
        ${bookmark.summary ? `<div class="bookmark-summary" style="font-size: 11px; color: #666; margin-top: 2px;">${bookmark.summary}</div>` : ''}
        <div class="bookmark-date">${formatDate(bookmark.dateAdded)}</div>
        ${statusHTML}
      </div>
      <div class="actions">
        <button class="action-btn star ${bookmark.isStarred ? 'starred' : ''}" data-id="${bookmark.id}">★</button>
        ${regenerateButtonHTML}
        <button class="action-btn delete-btn" data-id="${bookmark.id}"><svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor"><path d="M3 6v18h18v-18h-18zm5 14c0 .552-.448 1-1 1s-1-.448-1-1v-10c0-.552.448-1 1-1s1 .448 1 1v10zm5 0c0 .552-.448 1-1 1s-1-.448-1-1v-10c0-.552.448-1 1-1s1 .448 1 1v10zm5 0c0 .552-.448 1-1 1s-1-.448-1-1v-10c0-.552.448-1 1-1s1 .448 1 1v10zm4-18v2h-20v-2h5.711c.9 0 1.631-1.099 1.631-2h5.315c0 .901.73 2 1.631 2h5.712z"/></svg></button>
      </div>`;
    return div;
  }

  function getBreadcrumb(folderId) {
      if (folderId === 'root') return i18n.get('allBookmarks');
      let path = [];
      let currentId = folderId;
      while (currentId && currentId !== 'root') {
          const folder = allItems.find(item => item.id === currentId);
          if (folder) {
              path.unshift(folder.title);
              currentId = folder.parentId;
          } else {
              break;
          }
      }
      return `${i18n.get('rootFolder')} / ${path.join(' / ')}`;
  }

  function getStatusHTML(bookmark) {
    const status = bookmark.aiStatus;
    if (!status || status === 'completed') return '';
    let statusText = '';
    switch(status) {
      case 'pending':
      case 'processing':
        statusText = i18n.get("aiProcessing");
        break;
      case 'failed':
        statusText = bookmark.aiError || i18n.get("aiFailed");
        break;
    }
    return `<div class="ai-status" style="font-size: 11px; color: #666; display: flex; align-items: center; gap: 5px; margin-top: 4px;">${statusText}</div>`;
  }
  
  function getFaviconUrl(url) { try { return `https://www.google.com/s2/favicons?domain=${new URL(url).hostname}&sz=16`; } catch { return 'icons/icon16.png'; } }
  function formatDate(isoString) { if (!isoString) return ''; const d = new Date(isoString); return `${d.getFullYear()}-${(d.getMonth()+1).toString().padStart(2, '0')}-${d.getDate().toString().padStart(2, '0')} ${d.getHours().toString().padStart(2, '0')}:${d.getMinutes().toString().padStart(2, '0')}`; }
  function showToast(message, duration=2000, color="#4285f4") { const t = document.createElement('div'); t.textContent = message; Object.assign(t.style, { position: 'fixed', bottom: '20px', left: '50%', transform: 'translateX(-50%)', background: color, color: 'white', padding: '10px 20px', borderRadius: '4px', zIndex: 1000, boxShadow: '0 2px 10px rgba(0,0,0,0.2)' }); document.body.appendChild(t); setTimeout(() => t.remove(), duration); }
  function loadLanguageSetting() { languageSelector.value = currentLang; }
}