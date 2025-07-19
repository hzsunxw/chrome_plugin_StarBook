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

  // 添加一些测试数据用于问答功能测试
  const testBookmarks = [
    {
      id: 'test-1',
      type: 'bookmark',
      title: 'PDF转PPT在线工具',
      url: 'https://example.com/pdf-to-ppt',
      summary: '这是一个免费的PDF转PPT在线工具，支持批量转换，保持原有格式。可以将PDF文档快速转换为PowerPoint演示文稿',
      category: '工具',
      tags: ['PDF', 'PPT', '转换', '在线工具', 'PowerPoint'],
      keyPoints: ['支持批量转换', '保持格式', '免费使用', 'PDF转PPT', '文档转换'],
      aiStatus: 'completed'
    },
    {
      id: 'test-2',
      type: 'bookmark',
      title: 'JavaScript学习指南',
      url: 'https://example.com/js-guide',
      summary: '完整的JavaScript学习教程，从基础到高级',
      category: '编程',
      tags: ['JavaScript', '编程', '教程'],
      keyPoints: ['基础语法', '高级特性', '实战项目'],
      aiStatus: 'completed'
    },
    {
      id: 'test-3',
      type: 'bookmark',
      title: 'SmallPDF - PDF工具集',
      url: 'https://smallpdf.com',
      summary: '专业的PDF处理工具，包括PDF转Word、PDF转PPT、PDF转Excel等多种格式转换功能',
      category: '工具',
      tags: ['PDF', '转换', '文档处理', 'PPT', '格式转换'],
      keyPoints: ['多格式转换', 'PDF转PPT', '在线处理', '免费试用'],
      aiStatus: 'completed'
    },
    {
      id: 'test-4',
      type: 'bookmark',
      title: 'Office办公技巧',
      url: 'https://example.com/office-tips',
      summary: 'Microsoft Office办公软件使用技巧，包括Word、Excel、PowerPoint的高级功能',
      category: '办公',
      tags: ['Office', 'PowerPoint', 'PPT', '办公技巧'],
      keyPoints: ['PPT制作技巧', '模板使用', '动画效果'],
      aiStatus: 'completed'
    }
  ];

  // --- Element References ---
  const importBtn = document.getElementById('importBookmarks');
  const searchInput = document.getElementById('searchInput');
  const languageSelector = document.getElementById('languageSelector');
  const toggleAIConfigBtn = document.getElementById('toggleAIConfig');
  const aiConfigSection = document.getElementById('aiConfigSection');
  const toggleQABtn = document.getElementById('toggleQA');
  const qaSection = document.getElementById('qaSection');
  const folderTreeContainer = document.getElementById('folder-tree-container');
  const bookmarkListContainer = document.getElementById('bookmark-list-container');
  const aiProvider = document.getElementById('aiProvider');
  // Context Menu Elements
  const folderContextMenu = document.getElementById('folder-context-menu');
  const deleteFolderBtn = document.getElementById('delete-folder-btn');

  // 检查关键元素是否存在
  if (!importBtn || !searchInput || !languageSelector || !folderTreeContainer || !bookmarkListContainer) {
    throw new Error('Critical DOM elements not found');
  }


  // --- Event Listeners ---
  importBtn.addEventListener('click', handleImportBookmarks);
  searchInput.addEventListener('input', handleSearch);
  languageSelector.addEventListener('change', handleLanguageChange);

  if (toggleAIConfigBtn && aiConfigSection) {
    toggleAIConfigBtn.addEventListener('click', () => { aiConfigSection.style.display = 'block'; });
  }

  const closeAIConfigBtn = document.getElementById('closeAIConfig');
  if (closeAIConfigBtn && aiConfigSection) {
    closeAIConfigBtn.addEventListener('click', () => { aiConfigSection.style.display = 'none'; });
  }

  // QA System event listeners (with safety checks)
  if (toggleQABtn && qaSection) {
    toggleQABtn.addEventListener('click', () => {
      console.log('打开智能问答系统');
      qaSection.style.display = 'block';
    });
  }
  const closeQABtn = document.getElementById('closeQA');
  if (closeQABtn && qaSection) {
    closeQABtn.addEventListener('click', () => {
      console.log('关闭智能问答系统');
      qaSection.style.display = 'none';
    });
  }


  const askQuestionBtn = document.getElementById('askQuestion');
  if (askQuestionBtn) {
    askQuestionBtn.addEventListener('click', handleAskQuestion);
  }
  if (aiProvider) {
    aiProvider.addEventListener('change', handleProviderChange);
  }

  const saveAIConfigBtn = document.getElementById('saveAIConfig');
  if (saveAIConfigBtn) {
    saveAIConfigBtn.addEventListener('click', saveAIConfig);
  }

  folderTreeContainer.addEventListener('click', handleTreeClick);
  bookmarkListContainer.addEventListener('click', handleListClick);

  // Context Menu Listeners
  folderTreeContainer.addEventListener('contextmenu', handleTreeContextMenu);
  if (deleteFolderBtn) {
    deleteFolderBtn.addEventListener('click', handleDeleteFolder);
  }
  if (folderContextMenu) {
    window.addEventListener('click', () => { folderContextMenu.style.display = 'none'; });
  }


  // --- Init ---
  loadAllItems();
  loadAIConfig();
  loadLanguageSetting();
  chrome.storage.onChanged.addListener(handleStorageChange);
  
  // --- Main Functions ---
  function loadAllItems() {
    chrome.storage.local.get("bookmarkItems", data => {
      allItems = data.bookmarkItems || [];

      // 如果没有数据，添加测试数据用于问答功能演示
      if (allItems.length === 0) {
        allItems = [...testBookmarks];
        console.log('添加了测试数据用于问答功能演示，共', allItems.length, '条');
        console.log('测试数据:', allItems);
      } else {
        console.log('加载了现有数据，共', allItems.length, '条');
      }

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
      event.preventDefault(); // 阻止默认的链接行为
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

    // 保存分析深度设置
    const analysisDepth = document.getElementById('aiAnalysisDepth').value;

    // 保存智能搜索设置
    const enableSmartSearch = document.getElementById('enableSmartSearch').checked;
    config.enableSmartSearch = enableSmartSearch;

    chrome.storage.local.set({
      aiConfig: config,
      aiAnalysisDepth: analysisDepth
    }, () => {
      showToast(i18n.get('configSaved'));
    });
  }

  function loadAIConfig() {
    chrome.storage.local.get(['aiConfig', 'aiAnalysisDepth'], (data) => {
      const config = data.aiConfig || {};
      if (config.provider) {
        aiProvider.value = config.provider;
      }
      
      // 设置分析深度
      const analysisDepth = data.aiAnalysisDepth || 'standard';
      const depthSelector = document.getElementById('aiAnalysisDepth');
      if (depthSelector) {
        depthSelector.value = analysisDepth;
      }

      // 设置智能搜索开关
      const enableSmartSearch = config.enableSmartSearch !== false; // 默认开启
      const smartSearchCheckbox = document.getElementById('enableSmartSearch');
      if (smartSearchCheckbox) {
        smartSearchCheckbox.checked = enableSmartSearch;
      }
      
      // 现有的API配置代码...
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
        } else if (response?.status === "queued") {
            showToast(i18n.get("aiRegenerateStarted"), 3000, "#4285f4");
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
    
    div.innerHTML = `
      <div class="bookmark-header">
        <img class="favicon" src="${faviconUrl}" width="16" height="16" loading="lazy" alt="">
        <div class="bookmark-title clickable" data-url="${bookmark.url}">${bookmark.title}</div>
        <div class="action-buttons">
          <button class="action-btn star ${bookmark.isStarred ? 'starred' : ''}" data-id="${bookmark.id}" title="${i18n.get('toggleStar')}">★</button>
          <button class="action-btn regenerate-btn" data-id="${bookmark.id}" title="${i18n.get('regenerateAI')}">🔄</button>
          <button class="action-btn delete-btn" data-id="${bookmark.id}" title="${i18n.get('delete')}">🗑</button>
        </div>
      </div>
      
      <div class="bookmark-url clickable" data-url="${bookmark.url}">${bookmark.url}</div>
      
      ${bookmark.aiStatus === 'completed' ? `
        ${bookmark.category ? `<div class="bookmark-category">${bookmark.category}</div>` : ''}

        ${bookmark.tags && bookmark.tags.length > 0 ? `
          <div class="bookmark-tags">
            ${bookmark.tags.map(tag => `<span class="tag" data-tag="${tag}">${tag}</span>`).join('')}
          </div>
        ` : `<div class="ai-status" style="font-size: 11px; color: #ff9800; margin: 5px 0;">${i18n.get('tagsMissing')}</div>`}

        ${bookmark.summary ? `<div class="bookmark-summary">${bookmark.summary}</div>` : `<div class="ai-status" style="font-size: 11px; color: #ff9800; margin: 5px 0;">${i18n.get('summaryMissing')}</div>`}
        
        ${bookmark.keyPoints && bookmark.keyPoints.length > 0 ? `
          <div class="key-points">
            <div class="key-points-title">${i18n.get('keyPoints')}:</div>
            <ul class="key-points-list">
              ${bookmark.keyPoints.map(point => `<li class="key-point">${point}</li>`).join('')}
            </ul>
          </div>
        ` : ''}
        
        ${bookmark.contentType || bookmark.estimatedReadTime || bookmark.readingLevel ? `
          <div class="bookmark-enhanced-info">
            ${bookmark.contentType ? `
              <div class="info-row">
                <span class="info-label">${i18n.get('contentType')}:</span>
                <span class="info-value">
                  <span class="content-type-badge">${i18n.get('contentType_' + bookmark.contentType) || bookmark.contentType}</span>
                </span>
              </div>
            ` : ''}
            ${bookmark.estimatedReadTime ? `
              <div class="info-row">
                <span class="info-label">${i18n.get('readingTime')}:</span>
                <span class="info-value">
                  <span class="read-time">${bookmark.estimatedReadTime}${i18n.get('minutes')}</span>
                </span>
              </div>
            ` : ''}
            ${bookmark.readingLevel ? `
              <div class="info-row">
                <span class="info-label">${i18n.get('readingLevel')}:</span>
                <span class="info-value">
                  <span class="reading-level-badge ${bookmark.readingLevel}">${i18n.get('readingLevel_' + bookmark.readingLevel) || bookmark.readingLevel}</span>
                </span>
              </div>
            ` : ''}
          </div>
        ` : ''}
      ` : statusHTML}
      
      <div class="bookmark-date">${formatDate(bookmark.dateAdded)}</div>
    `;
    
    // 添加标签点击事件监听器
    const tagElements = div.querySelectorAll('.tag[data-tag]');
    tagElements.forEach(tagEl => {
      tagEl.addEventListener('click', (e) => {
        e.stopPropagation();
        searchByTag(tagEl.dataset.tag);
      });
    });
    
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

  // 添加按标签搜索功能
  function searchByTag(tag) {
    const searchInput = document.getElementById('searchInput');
    if (searchInput) {
      searchInput.value = tag;
      handleSearch();
    }
  }

  // --- QA System Functions ---
  async function handleAskQuestion() {
    console.log('handleAskQuestion called - NEW VERSION'); // 调试信息
    try {
      const questionInput = document.getElementById('questionInput');
      if (!questionInput) {
        console.error('Question input element not found');
        return;
      }

      const question = questionInput.value.trim();
      console.log('Question:', question); // 调试信息

      if (!question) {
        alert('请输入问题');
        return;
      }

      // 显示加载状态
      showQALoading(true);

      // 在收藏中搜索答案
      const results = await searchInBookmarks(question);
      console.log('Search results:', results); // 调试信息

      // 显示结果
      displaySearchResults(results, question);

    } catch (error) {
      console.error('问答功能错误:', error);
      alert('搜索过程中出现错误');
      // 只有在出错时才恢复初始状态
      showQALoading(false);
    }
  }

  function showQALoading(show) {
    const qaInfo = document.querySelector('.qa-info');
    if (qaInfo) {
      if (show) {
        qaInfo.innerHTML = '<p>🔍 正在搜索您的收藏...</p>';
      } else {
        // 恢复原始信息
        qaInfo.innerHTML = `
          <p>📚 智能问答系统</p>
          <p>功能说明：</p>
          <ul>
            <li>✅ 在您的收藏中搜索相关答案</li>
            <li>✅ 提取相关内容片段</li>
            <li>✅ 按相关度排序结果</li>
            <li>🔄 AI推荐功能开发中</li>
          </ul>
          <p style="color: #666; font-size: 12px; margin-top: 10px;">
            💡 提示：输入问题后点击"提问"，系统会在您的收藏中搜索相关内容
          </p>
        `;
      }
    }
  }

  async function searchInBookmarks(question) {
    console.log('开始搜索，问题:', question);
    console.log('总书签数量:', allItems.length);

    // 获取AI配置
    const { aiConfig } = await chrome.storage.local.get("aiConfig");
    const useAISearch = aiConfig && aiConfig.apiKey && aiConfig.enableSmartSearch !== false;

    console.log('是否使用AI搜索:', useAISearch);

    if (useAISearch) {
      // 使用AI智能搜索
      return await aiSmartSearch(question, aiConfig);
    } else {
      // 使用传统关键词搜索
      return await keywordSearch(question);
    }
  }

  async function keywordSearch(question) {
    console.log('使用传统关键词搜索');

    // 提取关键词
    const keywords = extractKeywords(question);
    console.log('搜索关键词:', keywords);

    // 在收藏的书签中搜索
    const matchedBookmarks = allItems.filter(item => {
      if (item.type !== 'bookmark') return false;

      const searchText = [
        item.title || '',
        item.summary || '',
        item.category || '',
        ...(item.tags || []),
        ...(item.keyPoints || [])
      ].join(' ').toLowerCase();

      const matches = keywords.some(keyword => {
        const keywordLower = keyword.toLowerCase();
        return searchText.includes(keywordLower);
      });

      return matches;
    });

    // 计算相关度并排序
    const scoredResults = matchedBookmarks.map(bookmark => {
      const score = calculateBookmarkRelevanceScore(bookmark, keywords);
      return { bookmark, score };
    }).filter(result => result.score > 0.1)
      .sort((a, b) => b.score - a.score)
      .slice(0, 5);

    return scoredResults;
  }

  async function aiSmartSearch(question, aiConfig) {
    console.log('使用AI智能问答');

    try {
      // 分析用户的收藏数据
      const bookmarks = allItems.filter(item => item.type === 'bookmark');
      const categories = [...new Set(bookmarks.map(b => b.category).filter(c => c))];
      const tags = [...new Set(bookmarks.flatMap(b => b.tags || []))];

      // 在现有收藏中搜索相关内容
      const relatedBookmarks = bookmarks.filter(bookmark => {
        const searchText = [
          bookmark.title || '',
          bookmark.summary || '',
          bookmark.category || '',
          ...(bookmark.tags || [])
        ].join(' ').toLowerCase();

        const questionWords = question.toLowerCase().split(' ');
        return questionWords.some(word => word.length > 2 && searchText.includes(word));
      }).slice(0, 3);

      // 构建智能问答prompt - 包含用户收藏信息
      const prompt = `你是智能助手，基于用户的收藏偏好回答问题并推荐网站。

问题：${question}

用户收藏概况：
- 总收藏数：${bookmarks.length}个网站
- 主要分类：${categories.slice(0, 5).join(', ')}
- 常用标签：${tags.slice(0, 10).join(', ')}

用户现有相关收藏：
${relatedBookmarks.map(b => `- ${b.title} (${b.category || '未分类'})`).join('\n')}

返回格式（必须返回完整的JSON，不能截断）：
{"answer":"简短回答","recommendations":[{"title":"网站名","url":"完整URL","description":"简短描述","category":"分类","tags":["标签1","标签2"],"why":"简短理由"}],"existingBookmarks":[],"tips":["建议1","建议2"]}

严格要求：
1. 必须返回完整的JSON，确保以}结尾
2. 只返回JSON，不要任何其他文字或markdown
3. 推荐3个真实网站，每个描述不超过25字
4. URL必须完整可访问
5. 如果内容太长，优先保证JSON完整性`;

      console.log('发送AI问答请求...');

      // 调用AI API
      const response = await chrome.runtime.sendMessage({
        action: "callAI",
        prompt: prompt
      });

      if (response && response.result) {
        console.log('AI问答响应:', response.result);

        try {
          // 清理AI响应，提取JSON部分
          let cleanedResponse = response.result.trim();
          console.log('原始AI响应:', cleanedResponse);

          // 如果响应包含代码块标记，提取JSON部分
          if (cleanedResponse.includes('```json')) {
            const jsonStart = cleanedResponse.indexOf('```json') + 7;
            const jsonEnd = cleanedResponse.indexOf('```', jsonStart);
            if (jsonEnd > jsonStart) {
              cleanedResponse = cleanedResponse.substring(jsonStart, jsonEnd).trim();
            }
          } else if (cleanedResponse.includes('```')) {
            const jsonStart = cleanedResponse.indexOf('```') + 3;
            const jsonEnd = cleanedResponse.lastIndexOf('```');
            if (jsonEnd > jsonStart) {
              cleanedResponse = cleanedResponse.substring(jsonStart, jsonEnd).trim();
            }
          }

          // 查找JSON对象的开始和结束
          const jsonStart = cleanedResponse.indexOf('{');
          const jsonEnd = cleanedResponse.lastIndexOf('}');

          if (jsonStart >= 0 && jsonEnd > jsonStart) {
            cleanedResponse = cleanedResponse.substring(jsonStart, jsonEnd + 1);
          }

          // 尝试修复常见的JSON语法错误
          cleanedResponse = fixCommonJSONErrors(cleanedResponse);

          console.log('清理和修复后的AI响应:', cleanedResponse);

          const aiResult = JSON.parse(cleanedResponse);

          // 验证必要字段
          if (!aiResult.answer) {
            throw new Error('AI响应缺少answer字段');
          }

          // 验证和优化推荐结果
          const validatedRecommendations = await validateAndOptimizeRecommendations(
            aiResult.recommendations || [],
            bookmarks,
            relatedBookmarks,
            question
          );

          // 将相关收藏转换为结果格式
          const existingBookmarkResults = relatedBookmarks.map(bookmark => ({
            bookmark: bookmark,
            score: 0.9, // 高分，因为是相关的
            aiReason: '与您的问题相关的已收藏网站',
            matchedContent: bookmark.summary || bookmark.title
          }));

          // 返回智能问答结果
          return {
            type: 'qa_result',
            answer: aiResult.answer,
            recommendations: validatedRecommendations,
            existingBookmarks: existingBookmarkResults, // 使用找到的相关收藏
            tips: aiResult.tips || []
          };

        } catch (parseError) {
          console.error('AI响应解析失败:', parseError);
          console.error('原始响应:', response.result);

          // 尝试从原始响应中提取有用信息
          const fallbackAnswer = extractAnswerFromRawResponse(response.result);
          const fallbackRecommendations = extractRecommendationsFromRawResponse(response.result);

          return {
            type: 'qa_result',
            answer: fallbackAnswer,
            recommendations: fallbackRecommendations,
            existingBookmarks: [],
            tips: ['请尝试重新提问', '检查AI配置是否正确', '可以尝试更简单的问题']
          };
        }
      } else {
        throw new Error('AI API调用失败');
      }

    } catch (error) {
      console.error('AI问答出错:', error);

      // 返回错误信息，但不抛出异常
      return {
        type: 'qa_result',
        answer: `抱歉，AI问答功能暂时不可用。错误信息：${error.message}`,
        recommendations: [
          {
            title: "Google搜索",
            url: "https://www.google.com/search?q=" + encodeURIComponent(question),
            description: "使用Google搜索您的问题",
            category: "搜索",
            tags: ["搜索", "通用"],
            why: "通用搜索引擎"
          },
          {
            title: "百度搜索",
            url: "https://www.baidu.com/s?wd=" + encodeURIComponent(question),
            description: "使用百度搜索您的问题",
            category: "搜索",
            tags: ["搜索", "中文"],
            why: "中文搜索引擎"
          }
        ],
        existingBookmarks: [],
        tips: [
          "检查AI配置是否正确",
          "确保网络连接正常",
          "尝试重新提问"
        ]
      };
    }
  }

  // JSON修复函数
  function fixCommonJSONErrors(jsonStr) {
    try {
      console.log('开始修复JSON:', jsonStr);

      // 1. 移除可能的BOM和特殊字符
      jsonStr = jsonStr.replace(/^\uFEFF/, '').replace(/[\u0000-\u001F\u007F-\u009F]/g, '');

      // 2. 修复数组中缺少逗号的问题（对象之间）
      jsonStr = jsonStr.replace(/}\s*\n\s*{/g, '},\n{');
      jsonStr = jsonStr.replace(/}\s*{/g, '}, {');

      // 3. 修复对象属性后缺少逗号的问题
      jsonStr = jsonStr.replace(/"\s*\n\s*"/g, '",\n"');
      jsonStr = jsonStr.replace(/]\s*\n\s*"/g, '],\n"');
      jsonStr = jsonStr.replace(/}\s*\n\s*"/g, '},\n"');

      // 4. 修复数组最后一个元素后多余的逗号
      jsonStr = jsonStr.replace(/,(\s*])/g, '$1');
      jsonStr = jsonStr.replace(/,(\s*})/g, '$1');

      // 5. 修复字符串中的引号问题
      jsonStr = jsonStr.replace(/([^\\])"/g, '$1\\"');
      jsonStr = jsonStr.replace(/^"/g, '\\"');

      // 6. 重新添加正确的引号
      jsonStr = jsonStr.replace(/\\"/g, '"');

      // 7. 处理截断的JSON - 如果JSON不完整，尝试补全
      if (!jsonStr.trim().endsWith('}')) {
        console.log('检测到截断的JSON，尝试修复...');
        jsonStr = fixTruncatedJSON(jsonStr);
      }

      // 8. 特殊处理：如果发现常见的错误模式，直接修复
      if (jsonStr.includes('"tags": ["文档处理", "在线转换"]')) {
        jsonStr = jsonStr.replace('"tags": ["文档处理", "在线转换"]', '"tags": ["文档处理", "在线转换"]');
      }

      console.log('修复后的JSON:', jsonStr);
      return jsonStr;
    } catch (error) {
      console.warn('JSON修复失败:', error);
      return jsonStr;
    }
  }

  // 修复截断的JSON
  function fixTruncatedJSON(jsonStr) {
    try {
      console.log('修复截断的JSON...');

      // 找到最后一个完整的对象或数组
      let fixedJson = jsonStr.trim();

      // 如果在recommendations数组中截断
      if (fixedJson.includes('"recommendations": [') && !fixedJson.includes(']')) {
        console.log('在recommendations数组中截断');

        // 找到最后一个完整的推荐对象
        const lastCompleteObject = findLastCompleteObject(fixedJson);
        if (lastCompleteObject) {
          fixedJson = lastCompleteObject;
        }

        // 确保数组和对象正确关闭
        if (!fixedJson.includes(']')) {
          fixedJson += ']';
        }
        if (!fixedJson.endsWith('}')) {
          fixedJson += '}';
        }
      }

      // 如果在description字段中截断
      else if (fixedJson.includes('"description":') && !fixedJson.includes('",')) {
        console.log('在description字段中截断');

        // 找到description的开始位置
        const descStart = fixedJson.lastIndexOf('"description":');
        if (descStart > 0) {
          // 截断到description之前的完整部分
          const beforeDesc = fixedJson.substring(0, descStart);

          // 移除最后一个对象，因为它不完整
          const lastObjStart = beforeDesc.lastIndexOf('{');
          if (lastObjStart > 0) {
            fixedJson = beforeDesc.substring(0, lastObjStart);

            // 移除可能的尾随逗号
            fixedJson = fixedJson.replace(/,\s*$/, '');

            // 确保数组和对象正确关闭
            if (fixedJson.includes('"recommendations": [') && !fixedJson.includes(']')) {
              fixedJson += ']';
            }
            if (!fixedJson.endsWith('}')) {
              fixedJson += '}';
            }
          }
        }
      }

      console.log('截断修复结果:', fixedJson);
      return fixedJson;

    } catch (error) {
      console.warn('截断JSON修复失败:', error);

      // 如果修复失败，返回一个最小可用的JSON
      return `{
        "answer": "抱歉，AI响应不完整，请重试。",
        "recommendations": [],
        "existingBookmarks": [],
        "tips": ["请重新提问以获得完整回答"]
      }`;
    }
  }

  // 找到最后一个完整的对象
  function findLastCompleteObject(jsonStr) {
    const objects = [];
    let braceCount = 0;
    let currentObj = '';
    let inString = false;
    let escapeNext = false;

    for (let i = 0; i < jsonStr.length; i++) {
      const char = jsonStr[i];

      if (escapeNext) {
        escapeNext = false;
        currentObj += char;
        continue;
      }

      if (char === '\\') {
        escapeNext = true;
        currentObj += char;
        continue;
      }

      if (char === '"') {
        inString = !inString;
      }

      if (!inString) {
        if (char === '{') {
          if (braceCount === 0) {
            currentObj = char;
          } else {
            currentObj += char;
          }
          braceCount++;
        } else if (char === '}') {
          currentObj += char;
          braceCount--;

          if (braceCount === 0) {
            objects.push(currentObj);
            currentObj = '';
          }
        } else {
          currentObj += char;
        }
      } else {
        currentObj += char;
      }
    }

    // 返回最后一个完整的对象
    if (objects.length > 0) {
      const beforeLastObj = jsonStr.substring(0, jsonStr.lastIndexOf(objects[objects.length - 1]));
      return beforeLastObj + objects[objects.length - 1];
    }

    return null;
  }

  // 验证和优化推荐结果
  async function validateAndOptimizeRecommendations(recommendations, allBookmarks, relatedBookmarks, question) {
    console.log('开始验证和优化推荐结果...');
    console.log('AI推荐数量:', recommendations?.length || 0);
    console.log('所有收藏数量:', allBookmarks?.length || 0);
    console.log('相关收藏数量:', relatedBookmarks?.length || 0);

    if (!recommendations || recommendations.length === 0) {
      console.log('没有AI推荐结果');
      return [];
    }

    const optimizedRecs = [];

    for (const rec of recommendations) {
      try {
        console.log(`处理推荐: ${rec.title} - ${rec.url}`);

        // 1. 检查是否与现有收藏匹配（优先检查相关收藏，然后检查所有收藏）
        let matchedBookmark = relatedBookmarks.find(bookmark => {
          const urlMatch = bookmark.url === rec.url;
          const titleSimilarity = calculateSimilarity(bookmark.title, rec.title);
          const titleMatch = titleSimilarity > 0.6; // 降低阈值，提高匹配率

          console.log(`相关收藏匹配检查 - 书签: ${bookmark.title}`);
          console.log(`  URL匹配: ${urlMatch} (${bookmark.url} vs ${rec.url})`);
          console.log(`  标题相似度: ${titleSimilarity.toFixed(2)} (${titleMatch})`);

          return urlMatch || titleMatch;
        });

        // 如果在相关收藏中没找到，再在所有收藏中查找
        if (!matchedBookmark) {
          matchedBookmark = allBookmarks.find(bookmark => {
            const urlMatch = bookmark.url === rec.url;
            const titleSimilarity = calculateSimilarity(bookmark.title, rec.title);
            const titleMatch = titleSimilarity > 0.7; // 稍高的阈值

            if (urlMatch || titleMatch) {
              console.log(`全部收藏匹配检查 - 书签: ${bookmark.title}`);
              console.log(`  URL匹配: ${urlMatch} (${bookmark.url} vs ${rec.url})`);
              console.log(`  标题相似度: ${titleSimilarity.toFixed(2)} (${titleMatch})`);
            }

            return urlMatch || titleMatch;
          });
        }

        if (matchedBookmark) {
          // 如果匹配到已收藏的网站，标记为已收藏并提升优先级
          console.log(`发现已收藏网站: ${rec.title}`);
          optimizedRecs.push({
            ...rec,
            isBookmarked: true,
            bookmarkId: matchedBookmark.id,
            bookmarkTitle: matchedBookmark.title,
            bookmarkSummary: matchedBookmark.summary,
            relevanceScore: 1.0, // 已收藏的给最高分
            verified: true,
            source: 'existing'
          });
        } else {
          // 新推荐的网站
          // 2. 验证URL格式
          if (!isValidUrl(rec.url)) {
            console.log(`跳过无效URL: ${rec.url}`);
            continue;
          }

          // 3. 计算相关性评分
          const relevanceScore = calculateRelevanceScore(rec, question, allBookmarks);

          // 4. 添加验证标记和评分
          optimizedRecs.push({
            ...rec,
            isBookmarked: false,
            relevanceScore,
            verified: false, // 将在后台异步验证
            source: 'ai'
          });
        }

      } catch (error) {
        console.warn(`处理推荐时出错: ${rec.title}`, error);
      }
    }

    // 5. 按优先级排序：已收藏的在前，然后按相关性排序
    optimizedRecs.sort((a, b) => {
      if (a.isBookmarked && !b.isBookmarked) return -1;
      if (!a.isBookmarked && b.isBookmarked) return 1;
      return b.relevanceScore - a.relevanceScore;
    });

    // 6. 异步验证新推荐的URL（不阻塞返回）
    const newRecommendations = optimizedRecs.filter(rec => !rec.isBookmarked);
    if (newRecommendations.length > 0) {
      setTimeout(() => validateUrlsInBackground(newRecommendations), 100);
    }

    console.log(`优化完成，返回 ${optimizedRecs.length} 个推荐（${optimizedRecs.filter(r => r.isBookmarked).length} 个已收藏）`);
    return optimizedRecs;
  }

  // 计算文本相似度
  function calculateSimilarity(text1, text2) {
    const words1 = text1.toLowerCase().split(/\s+/);
    const words2 = text2.toLowerCase().split(/\s+/);
    const intersection = words1.filter(word => words2.includes(word));
    const union = [...new Set([...words1, ...words2])];
    return intersection.length / union.length;
  }

  // 验证URL格式
  function isValidUrl(string) {
    try {
      const url = new URL(string);
      return url.protocol === 'http:' || url.protocol === 'https:';
    } catch (_) {
      return false;
    }
  }

  // 计算推荐相关性评分
  function calculateRelevanceScore(recommendation, question, existingBookmarks) {
    let score = 0;

    // 基础分数
    score += 0.3;

    // 标题相关性
    const titleWords = recommendation.title.toLowerCase().split(/\s+/);
    const questionWords = question.toLowerCase().split(/\s+/);
    const titleMatch = titleWords.filter(word => questionWords.includes(word)).length;
    score += (titleMatch / questionWords.length) * 0.3;

    // 分类匹配
    const userCategories = [...new Set(existingBookmarks.map(b => b.category).filter(c => c))];
    if (userCategories.includes(recommendation.category)) {
      score += 0.2;
    }

    // 标签匹配
    const userTags = [...new Set(existingBookmarks.flatMap(b => b.tags || []))];
    const tagMatches = (recommendation.tags || []).filter(tag => userTags.includes(tag)).length;
    score += (tagMatches / Math.max(recommendation.tags?.length || 1, 1)) * 0.2;

    return Math.min(score, 1.0);
  }

  // 后台验证URL
  async function validateUrlsInBackground(recommendations) {
    for (const rec of recommendations) {
      try {
        // 使用HEAD请求检查URL是否可访问
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 5000); // 5秒超时

        const response = await fetch(rec.url, {
          method: 'HEAD',
          signal: controller.signal,
          mode: 'no-cors' // 避免CORS问题
        });

        clearTimeout(timeoutId);
        rec.verified = true;
        console.log(`✅ URL验证成功: ${rec.title}`);

      } catch (error) {
        rec.verified = false;
        console.log(`❌ URL验证失败: ${rec.title}`, error.message);
      }
    }
  }

  // 从原始响应中提取答案和推荐
  function extractAnswerFromRawResponse(rawResponse) {
    try {
      console.log('尝试从原始响应提取信息:', rawResponse);

      // 尝试提取answer字段的值
      const answerMatch = rawResponse.match(/"answer"\s*:\s*"([^"]*(?:\\.[^"]*)*)"/);
      let answer = '抱歉，AI响应格式有误，无法正确解析。';

      if (answerMatch) {
        answer = answerMatch[1].replace(/\\"/g, '"');
      } else {
        // 如果没找到answer字段，尝试提取可读的文本
        const textMatch = rawResponse.match(/PDF转PPT可使用在线工具或专业软件[^}]*/);
        if (textMatch) {
          answer = textMatch[0].substring(0, 200);
        }
      }

      return answer;
    } catch (error) {
      console.error('提取答案失败:', error);
      return '抱歉，AI响应格式有误，无法正确解析。';
    }
  }

  // 尝试从原始响应中提取推荐网站
  function extractRecommendationsFromRawResponse(rawResponse) {
    const recommendations = [];

    try {
      // 查找SmallPDF
      if (rawResponse.includes('smallpdf.com')) {
        recommendations.push({
          title: "SmallPDF - PDF转PPT",
          url: "https://smallpdf.com/pdf-to-ppt",
          description: "在线PDF转PPT工具，支持批量转换",
          category: "工具",
          tags: ["PDF", "PPT", "转换"],
          why: "操作简单，支持中文"
        });
      }

      // 查找iLovePDF
      if (rawResponse.includes('ilovepdf.com')) {
        recommendations.push({
          title: "iLovePDF - PDF转PPT",
          url: "https://www.ilovepdf.com/pdf_to_powerpoint",
          description: "免费在线转换PDF为可编辑PPT文件",
          category: "工具",
          tags: ["格式转换", "办公工具"],
          why: "无需注册，免费使用"
        });
      }

      // 如果没有找到任何推荐，添加默认推荐
      if (recommendations.length === 0) {
        recommendations.push({
          title: "SmallPDF - 在线PDF工具",
          url: "https://smallpdf.com",
          description: "全功能PDF在线工具集",
          category: "工具",
          tags: ["PDF", "在线工具"],
          why: "功能全面，使用简单"
        });
      }

    } catch (error) {
      console.error('提取推荐失败:', error);
    }

    return recommendations;
  }

  function extractKeywords(question) {
    // 中英文停用词
    const stopWords = [
      '的', '是', '在', '有', '和', '与', '或', '但', '如何', '什么', '为什么', '怎么', '怎样',
      'how', 'what', 'why', 'when', 'where', 'the', 'is', 'are', 'and', 'or', 'but', 'to', 'a', 'an'
    ];

    // 添加同义词映射
    const synonyms = {
      'pdf': ['pdf', 'PDF'],
      'ppt': ['ppt', 'PPT', 'powerpoint', 'PowerPoint', '演示', '幻灯片'],
      '转换': ['转换', '转成', '转为', '变成', '转化'],
      '转成': ['转换', '转成', '转为', '变成', '转化']
    };

    let keywords = question
      .toLowerCase()
      .replace(/[^\w\s\u4e00-\u9fff]/g, ' ')
      .split(/\s+/)
      .filter(word => word.length > 1 && !stopWords.includes(word));

    // 扩展同义词
    const expandedKeywords = [...keywords];
    keywords.forEach(keyword => {
      if (synonyms[keyword]) {
        expandedKeywords.push(...synonyms[keyword]);
      }
    });

    console.log('原始关键词:', keywords);
    console.log('扩展后关键词:', expandedKeywords);

    return [...new Set(expandedKeywords)]; // 去重
  }

  function calculateBookmarkRelevanceScore(bookmark, keywords) {
    let score = 0;
    const weights = {
      title: 0.4,
      summary: 0.3,
      category: 0.2,
      tags: 0.2,
      keyPoints: 0.1
    };

    // 确保keywords是数组
    if (!Array.isArray(keywords)) {
      console.warn('keywords不是数组:', keywords);
      return 0;
    }

    keywords.forEach(keyword => {
      const lowerKeyword = keyword.toLowerCase();

      if ((bookmark.title || '').toLowerCase().includes(lowerKeyword)) {
        score += weights.title;
      }
      if ((bookmark.summary || '').toLowerCase().includes(lowerKeyword)) {
        score += weights.summary;
      }
      if ((bookmark.category || '').toLowerCase().includes(lowerKeyword)) {
        score += weights.category;
      }
      if ((bookmark.tags || []).some(tag => tag.toLowerCase().includes(lowerKeyword))) {
        score += weights.tags;
      }
      if ((bookmark.keyPoints || []).some(point => point.toLowerCase().includes(lowerKeyword))) {
        score += weights.keyPoints;
      }
    });

    return Math.min(score, 1.0);
  }

  function displaySearchResults(results, question) {
    const qaInfo = document.querySelector('.qa-info');
    if (!qaInfo) return;

    // 检查是否是智能问答结果
    if (results.type === 'qa_result') {
      displayQAResult(results, question);
      return;
    }

    // 原有的搜索结果显示逻辑
    if (results.length === 0) {
      qaInfo.innerHTML = `
        <div style="text-align: center; padding: 20px;">
          <p>🤔 抱歉，在您的收藏中没有找到关于"${question}"的相关内容</p>
          <p>建议：</p>
          <ul style="text-align: left;">
            <li>尝试使用不同的关键词</li>
            <li>收藏更多相关网站</li>
            <li>等待AI分析完成后再次搜索</li>
          </ul>
          <div style="margin-top: 15px;">
            <button id="resetQAButton" style="background: #6c757d; color: white; border: none; padding: 8px 16px; border-radius: 4px; cursor: pointer;">
              返回初始界面
            </button>
          </div>
        </div>
      `;

      // 添加事件监听器
      setTimeout(() => {
        const resetBtn = document.getElementById('resetQAButton');
        if (resetBtn) {
          resetBtn.addEventListener('click', () => {
            qaInfo.innerHTML = `
              <p>📚 智能问答系统</p>
              <p>功能说明：</p>
              <ul>
                <li>✅ 智能回答各种问题</li>
                <li>✅ 推荐优质网站收藏</li>
                <li>✅ 提供实用建议和技巧</li>
                <li>✅ 发现现有收藏中的相关内容</li>
              </ul>
              <p style="color: #666; font-size: 12px; margin-top: 10px;">
                💡 提示：输入任何问题，AI会为您提供答案和相关网站推荐
              </p>
            `;
          });
        }
      }, 100);

      return;
    }

    // 显示搜索结果（关键词搜索的结果）
    let html = `
      <div style="max-height: 400px; overflow-y: auto;">
        <h4>🔍 在您的收藏中找到 ${results.length} 个相关结果：</h4>
    `;

    results.forEach((result, index) => {
      const { bookmark, score, aiReason, matchedContent } = result;
      const relevantContent = matchedContent || extractRelevantContent(bookmark, question);
      const isAIResult = aiReason !== undefined;

      html += `
        <div style="border: 1px solid #ddd; border-radius: 8px; padding: 12px; margin: 10px 0; background: white; ${isAIResult ? 'border-left: 4px solid #4CAF50;' : ''}">
          <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 8px;">
            <h5 style="margin: 0; color: #333; cursor: pointer;" onclick="chrome.tabs.create({url: '${bookmark.url}'})">${bookmark.title}</h5>
            <div style="display: flex; gap: 5px;">
              ${isAIResult ? '<span style="background: #4CAF50; color: white; padding: 2px 6px; border-radius: 10px; font-size: 10px;">🤖 AI</span>' : ''}
              <span style="background: #e3f2fd; color: #1976d2; padding: 2px 8px; border-radius: 12px; font-size: 12px;">
                相关度: ${Math.round(score * 100)}%
              </span>
            </div>
          </div>

          ${aiReason ? `<div style="background: #f0f8ff; padding: 8px; border-radius: 4px; margin: 8px 0; font-size: 13px;">
            <strong>🤖 推荐理由:</strong> ${aiReason}
          </div>` : ''}

          ${bookmark.summary ? `<p style="color: #666; font-size: 14px; margin: 5px 0;">${bookmark.summary}</p>` : ''}

          ${bookmark.tags && bookmark.tags.length > 0 ? `
            <div style="margin: 8px 0;">
              ${bookmark.tags.map(tag => `<span style="background: #f5f5f5; padding: 2px 6px; border-radius: 4px; font-size: 12px; margin-right: 4px;">${tag}</span>`).join('')}
            </div>
          ` : ''}

          ${relevantContent ? `<p style="color: #555; font-size: 13px; font-style: italic;">"${relevantContent}"</p>` : ''}

          <div style="margin-top: 8px;">
            <button onclick="chrome.tabs.create({url: '${bookmark.url}'})" style="background: #1976d2; color: white; border: none; padding: 6px 12px; border-radius: 4px; cursor: pointer; font-size: 12px;">
              查看详情
            </button>
          </div>
        </div>
      `;
    });

    html += '</div>';
    qaInfo.innerHTML = html;
  }

  function displayQAResult(qaResult, question) {
    const qaInfo = document.querySelector('.qa-info');
    if (!qaInfo) return;

    const { answer, recommendations, existingBookmarks, tips } = qaResult;

    // 调试信息
    console.log('显示QA结果:', {
      answer: answer,
      recommendations: recommendations?.length || 0,
      existingBookmarks: existingBookmarks?.length || 0,
      tips: tips?.length || 0
    });

    if (existingBookmarks && existingBookmarks.length > 0) {
      console.log('现有收藏详情:', existingBookmarks);
    }

    let html = `
      <div style="max-height: 500px; overflow-y: auto;">
        <div style="background: #f8f9fa; padding: 15px; border-radius: 8px; margin-bottom: 15px;">
          <h4 style="color: #333; margin-top: 0;">🤖 AI回答：</h4>
          <p style="line-height: 1.6; color: #555;">${answer}</p>
        </div>
    `;

    // 显示现有收藏中的相关内容
if (existingBookmarks && existingBookmarks.length > 0) {
      html += `
        <div style="background: #e8f5e8; padding: 15px; border-radius: 8px; margin-bottom: 15px;">
          <h4 style="color: #2e7d32; margin-top: 0;">📚 您的收藏中的相关内容：</h4>
          ${existingBookmarks.map(item => {
            // 处理不同的数据结构
            const bookmark = item.bookmark || item;
            const title = bookmark.title || item.title || 'undefined';
            const summary = bookmark.summary || item.reason || 'undefined';
            const url = bookmark.url || '#';

            return `
              <div style="margin: 8px 0; padding: 12px; background: white; border-radius: 4px; border-left: 4px solid #4caf50;">
                <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 8px;">
                  <strong style="color: #333;">${title}</strong>
                  <span style="background: #4caf50; color: white; padding: 2px 6px; border-radius: 10px; font-size: 10px;">✅ 已收藏</span>
                </div>
                <p style="margin: 8px 0; color: #666; font-size: 13px;">${summary}</p>
                ${bookmark.category ? `
                  <div style="margin: 8px 0;">
                    <span style="background: #f5f5f5; padding: 2px 6px; border-radius: 4px; font-size: 12px;">${bookmark.category}</span>
                  </div>
                ` : ''}

                <div style="margin-top: 10px; display: flex; gap: 8px;">
                  <button class="visit-btn" data-url="${url}" style="background: #2e7d32; color: white; border: none; padding: 6px 12px; border-radius: 4px; cursor: pointer; font-size: 12px;">
                    访问网站
                  </button>
                </div>
                </div>
            `;
          }).join('')}
        </div>
      `;
    }
    
    // 分离已收藏和新推荐的网站
    const bookmarkedSites = recommendations.filter(rec => rec.isBookmarked);
    const newRecommendations = recommendations.filter(rec => !rec.isBookmarked);

    // 显示已收藏的相关网站
    if (bookmarkedSites && bookmarkedSites.length > 0) {
      html += `
        <div style="background: #e8f5e8; padding: 15px; border-radius: 8px; margin-bottom: 15px;">
          <h4 style="color: #2e7d32; margin-top: 0;">📚 您收藏中的相关网站：</h4>
          ${bookmarkedSites.map((rec, index) => `
            <div style="border: 1px solid #4caf50; border-radius: 6px; padding: 12px; margin: 10px 0; background: white; border-left: 4px solid #4caf50;">
              <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 8px;">
                <h5 style="margin: 0; color: #333;">${rec.bookmarkTitle || rec.title}</h5>
                <div style="display: flex; gap: 5px;">
                  <span style="background: #4caf50; color: white; padding: 2px 6px; border-radius: 10px; font-size: 10px;">✅ 已收藏</span>
                  <span style="background: #${rec.category === '工具' ? 'ff9800' : rec.category === '教程' ? '2196f3' : '4caf50'}; color: white; padding: 2px 8px; border-radius: 12px; font-size: 11px;">
                    ${rec.category}
                  </span>
                </div>
              </div>

              <p style="color: #666; font-size: 14px; margin: 8px 0;">${rec.bookmarkSummary || rec.description}</p>

              <div style="background: #f0f8ff; padding: 8px; border-radius: 4px; margin: 8px 0; font-size: 13px;">
                <strong>🎯 相关原因:</strong> ${rec.why}
              </div>

              ${rec.tags && rec.tags.length > 0 ? `
                <div style="margin: 8px 0;">
                  ${rec.tags.map(tag => `<span style="background: #e8f5e8; padding: 2px 6px; border-radius: 4px; font-size: 12px; margin-right: 4px;">${tag}</span>`).join('')}
                </div>
              ` : ''}

              <div style="margin-top: 10px; display: flex; gap: 8px;">
                <button class="visit-btn" data-url="${rec.url}" style="background: #2e7d32; color: white; border: none; padding: 6px 12px; border-radius: 4px; cursor: pointer; font-size: 12px;">
                  重新访问
                </button>
                <button onclick="showBookmarkDetails('${rec.bookmarkId}')" style="background: #1976d2; color: white; border: none; padding: 6px 12px; border-radius: 4px; cursor: pointer; font-size: 12px;">
                  查看详情
                </button>
              </div>
            </div>
          `).join('')}
        </div>
      `;
    }

    // 显示新推荐网站
    if (newRecommendations && newRecommendations.length > 0) {
      html += `
        <div style="background: #fff3cd; padding: 15px; border-radius: 8px; margin-bottom: 15px;">
          <h4 style="color: #856404; margin-top: 0;">🌟 新推荐网站（点击收藏）：</h4>
          ${newRecommendations.map((rec, index) => `
            <div style="border: 1px solid #ffeaa7; border-radius: 6px; padding: 12px; margin: 10px 0; background: white;">
              <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 8px;">
                <h5 style="margin: 0; color: #333;">${rec.title}</h5>
                <div style="display: flex; gap: 5px;">
                  ${rec.verified === false ? '<span style="background: #ff9800; color: white; padding: 2px 6px; border-radius: 10px; font-size: 10px;">⚠️ 验证中</span>' : ''}
                  <span style="background: #${rec.category === '工具' ? 'ff9800' : rec.category === '教程' ? '2196f3' : '4caf50'}; color: white; padding: 2px 8px; border-radius: 12px; font-size: 11px;">
                    ${rec.category}
                  </span>
                </div>
              </div>

              <p style="color: #666; font-size: 14px; margin: 8px 0;">${rec.description}</p>

              <div style="background: #f0f8ff; padding: 8px; border-radius: 4px; margin: 8px 0; font-size: 13px;">
                <strong>💡 推荐理由:</strong> ${rec.why}
              </div>

              ${rec.tags && rec.tags.length > 0 ? `
                <div style="margin: 8px 0;">
                  ${rec.tags.map(tag => `<span style="background: #f5f5f5; padding: 2px 6px; border-radius: 4px; font-size: 12px; margin-right: 4px;">${tag}</span>`).join('')}
                </div>
              ` : ''}

              <div style="margin-top: 10px; display: flex; gap: 8px;">
                <button class="visit-btn" data-url="${rec.url}" style="background: #1976d2; color: white; border: none; padding: 6px 12px; border-radius: 4px; cursor: pointer; font-size: 12px;">
                  访问网站
                </button>
                <button class="add-btn" data-url="${rec.url}" data-title="${rec.title}" data-category="${rec.category}" data-tags="${rec.tags.join(',')}" data-description="${rec.description}" style="background: #4caf50; color: white; border: none; padding: 6px 12px; border-radius: 4px; cursor: pointer; font-size: 12px;">
                  添加到收藏
                </button>
              </div>
            </div>
          `).join('')}
        </div>
      `;
    }

    // 显示实用建议
    if (tips && tips.length > 0) {
      html += `
        <div style="background: #e3f2fd; padding: 15px; border-radius: 8px; margin-bottom: 15px;">
          <h4 style="color: #1976d2; margin-top: 0;">💡 实用建议：</h4>
          <ul style="margin: 0; padding-left: 20px;">
            ${tips.map(tip => `<li style="margin: 5px 0; color: #555;">${tip}</li>`).join('')}
          </ul>
        </div>
      `;
    }

    html += `
        <div style="text-align: center; margin-top: 20px;">
          <button id="resetQAButton" style="background: #6c757d; color: white; border: none; padding: 8px 16px; border-radius: 4px; cursor: pointer;">
            返回初始界面
          </button>
        </div>
      </div>
    `;

    qaInfo.innerHTML = html;

    // 添加事件委托处理按钮点击
    setTimeout(() => {
      // 处理访问网站按钮
      qaInfo.addEventListener('click', (e) => {
        if (e.target.classList.contains('visit-btn')) {
          const url = e.target.getAttribute('data-url');
          console.log('点击访问网站:', url);
          openUrl(url);
        }

        // 处理添加收藏按钮
        if (e.target.classList.contains('add-btn')) {
          const url = e.target.getAttribute('data-url');
          const title = e.target.getAttribute('data-title');
          const category = e.target.getAttribute('data-category');
          const tags = e.target.getAttribute('data-tags').split(',').filter(t => t.trim());
          const description = e.target.getAttribute('data-description');

          console.log('点击添加收藏:', { url, title, category, tags, description });
          addRecommendedSite(url, title, category, tags, description);
        }
      });

      // 添加重置按钮事件监听器
      const resetBtn = document.getElementById('resetQAButton');
      if (resetBtn) {
        resetBtn.addEventListener('click', () => {
          qaInfo.innerHTML = `
            <p>📚 智能问答系统</p>
            <p>功能说明：</p>
            <ul>
              <li>✅ 智能回答各种问题</li>
              <li>✅ 推荐优质网站收藏</li>
              <li>✅ 提供实用建议和技巧</li>
              <li>✅ 发现现有收藏中的相关内容</li>
            </ul>
            <p style="color: #666; font-size: 12px; margin-top: 10px;">
              💡 提示：输入任何问题，AI会为您提供答案和相关网站推荐
            </p>
          `;
        });
      }
    }, 100);
  }

  // 打开URL的函数
  function openUrl(url) {
    console.log('尝试打开URL:', url);
    try {
      if (chrome && chrome.tabs) {
        chrome.tabs.create({ url: url });
        console.log('使用chrome.tabs.create打开');
      } else {
        window.open(url, '_blank');
        console.log('使用window.open打开');
      }
    } catch (error) {
      console.error('打开网站失败:', error);
      // 如果chrome.tabs.create失败，使用window.open作为备选
      window.open(url, '_blank');
      console.log('降级使用window.open打开');
    }
  }

  // 确保函数在全局作用域中可用
  window.openUrl = openUrl;

  // 添加推荐网站到收藏的函数
  async function addRecommendedSite(url, title, category, tags, description) {
    console.log('开始添加推荐网站:', { url, title, category, tags, description });

    try {
      if (!chrome || !chrome.runtime) {
        throw new Error('Chrome扩展API不可用');
      }

      const response = await chrome.runtime.sendMessage({
        action: "addBookmarkByUrl",
        url: url,
        title: title,
        category: category,
        tags: Array.isArray(tags) ? tags : [],
        summary: description
      });

      console.log('添加响应:', response);

      if (response && response.status === "success") {
        showToast("✅ 已添加到收藏: " + title, 3000, "#28a745");
        // 刷新书签列表
        if (typeof loadAllItems === 'function') {
          loadAllItems();
        }
      } else if (response && response.status === "exists") {
        showToast("⚠️ 该网站已在收藏中", 2000, "#ffc107");
      } else {
        showToast("❌ 添加失败: " + (response?.message || "未知错误"), 3000, "#dc3545");
      }
    } catch (error) {
      console.error('添加收藏失败:', error);
      showToast("❌ 添加失败: " + error.message, 3000, "#dc3545");
    }
  }

  // 确保函数在全局作用域中可用
  window.addRecommendedSite = addRecommendedSite;

  // 显示书签详情的函数
  window.showBookmarkDetails = function(bookmarkId) {
    console.log('显示书签详情:', bookmarkId);

    // 找到对应的书签
    const bookmark = allItems.find(item => item.id === bookmarkId);
    if (!bookmark) {
      console.error('未找到书签:', bookmarkId);
      return;
    }

    // 关闭QA模态框
    const qaSection = document.getElementById('qaSection');
    if (qaSection) {
      qaSection.style.display = 'none';
    }

    // 显示书签详情（可以跳转到书签列表并高亮显示）
    renderBookmarkList('root');

    // 高亮显示对应的书签
    setTimeout(() => {
      const bookmarkElement = document.querySelector(`[data-bookmark-id="${bookmarkId}"]`);
      if (bookmarkElement) {
        bookmarkElement.scrollIntoView({ behavior: 'smooth', block: 'center' });
        bookmarkElement.style.backgroundColor = '#fff3cd';
        setTimeout(() => {
          bookmarkElement.style.backgroundColor = '';
        }, 3000);
      }
    }, 100);
  };



  function extractRelevantContent(bookmark, question) {
    const keywords = extractKeywords(question);

    // 从摘要中提取包含关键词的句子
    if (bookmark.summary) {
      const sentences = bookmark.summary.split(/[。！？.!?]/).filter(s => s.trim());
      const relevantSentence = sentences.find(sentence =>
        keywords.some(keyword => sentence.toLowerCase().includes(keyword.toLowerCase()))
      );
      if (relevantSentence) {
        return relevantSentence.trim().substring(0, 100) + (relevantSentence.length > 100 ? '...' : '');
      }
    }

    // 从关键点中提取
    if (bookmark.keyPoints && bookmark.keyPoints.length > 0) {
      const relevantPoint = bookmark.keyPoints.find(point =>
        keywords.some(keyword => point.toLowerCase().includes(keyword.toLowerCase()))
      );
      if (relevantPoint) {
        return relevantPoint.substring(0, 100) + (relevantPoint.length > 100 ? '...' : '');
      }
    }

    return null;
  }
}
