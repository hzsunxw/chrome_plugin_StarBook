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
    const i18nError = new I18nManager();
    await i18nError.loadMessages('en'); // Fallback to english for error message
    document.body.innerHTML = `<div style="padding: 20px; text-align: center; color: red;">${i18n.get('initializationError')}</div>`;
  }
});

// ===== 智能分类管理器类定义 =====
/**
 * 智能分类管理器类
 */
class SmartCategoryManager {
  constructor(i18n) {
    this.categories = new Map();
    this.isEnabled = false;
    this.isProcessing = false;
    this.i18n = i18n;
  }

  async init() {
    await this.loadSmartCategories();
    this.bindEvents();
    this.renderSmartCategories();

    // 监听来自background的进度更新
    chrome.runtime.onMessage.addListener((message) => {
      if (message.action === 'aiQueueProgress') {
        this.updateProgress(message.progress);
      } else if (message.action === 'smartCategoryProgress') {
        // 兼容旧的智能分类进度消息
        this.updateProgress(message.progress);
      }
    });
  }

  async loadSmartCategories() {
    try {
      const data = await chrome.storage.local.get(['smartCategoriesConfig', 'bookmarkItems']);
      const config = data.smartCategoriesConfig || { enabled: true, categories: {} };
      const bookmarks = data.bookmarkItems || [];

      this.isEnabled = config.enabled;

      // 从书签数据中统计分类
      this.categories.clear();
      bookmarks.forEach(bookmark => {
        if (bookmark.type === 'bookmark' && bookmark.smartCategories) {
          bookmark.smartCategories.forEach(category => {
            if (!this.categories.has(category)) {
              this.categories.set(category, {
                name: category,
                count: 0,
                bookmarkIds: []
              });
            }
            const cat = this.categories.get(category);
            cat.count++;
            cat.bookmarkIds.push(bookmark.clientId || bookmark.serverId);
          });
        }
      });

      console.log(this.i18n.get('smartCategoriesLoaded'), this.categories.size);
    } catch (error) {
      console.error(this.i18n.get('smartCategoriesLoadFailed'), error);
    }
  }

  renderSmartCategories() {
    const container = document.getElementById('smart-categories-content');
    if (!container) return;

    if (!this.isEnabled || this.categories.size === 0) {
      container.innerHTML = `
        <div class="empty-state">
          <p>${this.i18n.get('noSmartCategories')}</p>
          <button id="enableSmartCategoryBtn" class="btn-primary">${this.i18n.get('enableSmartCategories')}</button>
        </div>
      `;

      // 绑定启用按钮事件
      const enableBtn = document.getElementById('enableSmartCategoryBtn');
      if (enableBtn) {
        enableBtn.addEventListener('click', () => this.enableSmartCategory());
      }
      return;
    }

    const categoriesArray = Array.from(this.categories.values())
      .sort((a, b) => b.count - a.count);

    container.innerHTML = categoriesArray.map(category => `
      <div class="category-item" data-category="${category.name}">
        <span class="category-name">${category.name}</span>
        <span class="category-count">[${category.count}]</span>
      </div>
    `).join('');

    // 绑定点击事件
    container.querySelectorAll('.category-item').forEach(item => {
      item.addEventListener('click', (e) => {
        const categoryName = e.currentTarget.dataset.category;
        this.filterByCategory(categoryName);
      });
    });
  }

  async filterByCategory(categoryName) {
    const category = this.categories.get(categoryName);
    if (!category) return;

    // 高亮选中的分类
    document.querySelectorAll('.category-item').forEach(item => {
      item.classList.remove('active');
    });
    document.querySelector(`[data-category="${categoryName}"]`)?.classList.add('active');

    // 过滤显示书签
    const bookmarks = await this.getBookmarksByIds(category.bookmarkIds);
    this.displayFilteredBookmarks(bookmarks, this.i18n.get('smartCategoryFilter', { category: categoryName }));
  }

  async getBookmarksByIds(bookmarkIds) {
    try {
      const data = await chrome.storage.local.get('bookmarkItems');
      const allBookmarks = data.bookmarkItems || [];

      return allBookmarks.filter(bookmark =>
        bookmarkIds.includes(bookmark.clientId) || bookmarkIds.includes(bookmark.serverId)
      );
    } catch (error) {
      console.error('获取书签失败:', error);
      return [];
    }
  }

  displayFilteredBookmarks(bookmarks, title) {
    // 调用全局的renderBookmarkList函数
    if (window.renderBookmarkList) {
      window.renderBookmarkList(null, bookmarks, title);
    }
  }

  bindEvents() {
    // 继续分析按钮
    const continueBtn = document.getElementById('continueAnalysisBtn');
    if (continueBtn) {
      continueBtn.addEventListener('click', () => this.startBatchAnalysis('continue'));
    }

    // 重新分析按钮
    const reanalysisBtn = document.getElementById('reanalysisBtn');
    if (reanalysisBtn) {
      reanalysisBtn.addEventListener('click', () => this.startBatchAnalysis('reanalysis'));
    }

    // 分类设置按钮已移除
  }

  async enableSmartCategory() {
    try {
      // 检查AI配置
      const { aiConfig } = await chrome.storage.local.get("aiConfig");
      if (!aiConfig || !aiConfig.apiKey) {
        if (window.showToast) {
          window.showToast(this.i18n.get('aiConfigRequired'), 5000, '#f44336');
        }
        return;
      }

      console.log('AI配置检查通过，提供商:', aiConfig.provider);

      // 启用智能分类
      const config = {
        enabled: true,
        version: 1,
        lastBatchUpdate: null,
        categories: {}
      };

      await chrome.storage.local.set({ smartCategoriesConfig: config });
      this.isEnabled = true;

      // 开始批量分析（继续分析模式）
      await this.startBatchAnalysis('continue');

    } catch (error) {
      console.error(this.i18n.get('smartCategoriesLoadFailed'), error);
      if (window.showToast) {
        window.showToast(this.i18n.get('smartCategoriesEnableFailed'), 3000, '#f44336');
      }
    }
  }

  async startBatchAnalysis(mode = 'continue') {
    try {
      const data = await chrome.storage.local.get('bookmarkItems');
      const bookmarks = data.bookmarkItems || [];

      let targetBookmarks = [];
      let modeText = '';

      if (mode === 'reanalysis') {
        // 重新分析模式：处理所有书签，重置AI状态
        targetBookmarks = bookmarks.filter(bookmark => bookmark.type === 'bookmark');
        modeText = '重新分析';

        // 重置AI分析状态，让系统重新进行完整分析（包括分类）
        targetBookmarks.forEach(bookmark => {
          bookmark.aiStatus = 'pending';
          bookmark.aiError = '';
          // 清空所有AI生成的内容，让系统重新生成
          bookmark.summary = '';
          bookmark.tags = [];
          bookmark.smartCategories = [];
          bookmark.smartCategoriesUpdated = null;
          bookmark.smartCategoriesVersion = 0;
          bookmark.smartCategoriesConfidence = null;
          bookmark.contentType = '';
          bookmark.readingLevel = '';
          bookmark.estimatedReadTime = null;
          bookmark.keyPoints = [];
        });

        // 保存重置后的数据
        await chrome.storage.local.set({ bookmarkItems: bookmarks });

      } else {
        // 继续分析模式：只处理未完成分析的书签
        targetBookmarks = bookmarks.filter(bookmark =>
          bookmark.type === 'bookmark' &&
          (['pending', 'processing', 'failed'].includes(bookmark.aiStatus) ||
           (bookmark.aiStatus === 'completed' && (!bookmark.summary || !bookmark.tags || bookmark.tags.length === 0)))
        );
        modeText = '继续分析';
      }

      if (targetBookmarks.length === 0) {
        const message = mode === 'reanalysis' ? '没有书签需要重新分析' : '所有书签都已分析完成';
        if (window.showToast) {
          window.showToast(message);
        }
        return;
      }

      console.log(`开始批量AI${modeText}，共 ${targetBookmarks.length} 个书签`);

      // 显示进度条
      this.showProgress(true);
      this.isProcessing = true;

      // 发送批量分析请求到background（复用现有的AI队列系统）
      chrome.runtime.sendMessage({
        action: 'forceRestartAiQueue'
      }, (response) => {
        if (chrome.runtime.lastError) {
          console.error('发送批量分析请求失败:', chrome.runtime.lastError);
          this.showProgress(false);
          this.isProcessing = false;
          if (window.showToast) {
            window.showToast('启动AI分析失败', 3000, '#f44336');
          }
        } else {
          console.log(`AI分析队列已重启，处理 ${response.restartedCount} 个书签`);
          if (window.showToast) {
            window.showToast(`开始AI分析 ${response.restartedCount} 个书签`);
          }
        }
      });

    } catch (error) {
      console.error('启动批量分析失败:', error);
      this.showProgress(false);
      this.isProcessing = false;
      if (window.showToast) {
        window.showToast('启动AI分析失败', 3000, '#f44336');
      }
    }
  }

  showProgress(show) {
    const progressContainer = document.getElementById('classification-progress');
    if (progressContainer) {
      progressContainer.style.display = show ? 'block' : 'none';
    }
  }

  updateProgress(progress) {
    const progressFill = document.querySelector('.progress-fill');
    const progressText = document.getElementById('progress-count');

    if (progressFill && progressText) {
      const percentage = progress.total > 0 ? (progress.completed / progress.total) * 100 : 0;
      progressFill.style.width = `${percentage}%`;
      progressText.textContent = `${progress.completed}/${progress.total}`;

      if (progress.completed === progress.total) {
        setTimeout(() => {
          this.showProgress(false);
          this.isProcessing = false;
          this.loadSmartCategories().then(() => {
            this.renderSmartCategories();
            const successCount = progress.completed - progress.failed;
            if (window.showToast) {
              window.showToast(this.i18n.get('smartCategoriesComplete', { count: successCount }));
            }
          });
        }, 1000);
      }
    }
  }

  // showCategorySettings方法已移除
}

function initOptions(i18n, currentLang) {
  // --- App State ---
  let allItems = [];
  let activeFolderId = 'root';
  let contextMenuFolderId = null; // To store the ID of the right-clicked folder
  let currentEditingBookmarkId = null; // <-- Add this variable
  let smartCategoryManager = null; // 智能分类管理器

  const langKey = currentLang.startsWith('zh') ? 'zh_CN' : 'en';

  const langData = {
    en: {
      stopWords: [ 'how', 'what', 'why', 'when', 'where', 'the', 'is', 'are', 'and', 'or', 'but', 'to', 'a', 'an', 'in', 'for', 'of' ],
      synonyms: {
        'ppt': ['ppt', 'powerpoint', 'slides', 'presentation'],
        'convert': ['convert', 'change', 'transform', 'turn into'],
        'conversion': ['convert', 'change', 'transform', 'turn into'],
      }
    },
    zh_CN: {
      stopWords: [ '的', '是', '在', '有', '和', '与', '或', '但', '如何', '什么', '为什么', '怎么', '怎样', '我', '你', '他', '她', '它' ],
      synonyms: {
        'pdf': ['pdf', 'PDF'],
        'ppt': ['ppt', 'PPT', 'powerpoint', 'PowerPoint', '演示', '幻灯片'],
        '转换': ['转换', '转成', '转为', '变成', '转化'],
        '转成': ['转换', '转成', '转为', '变成', '转化']
      }
    }
  };


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
      aiStatus: 'completed',
      notes: 'Test notes for item 1'
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
      aiStatus: 'completed',
      notes: ''
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
      aiStatus: 'completed',
      notes: ''
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
      aiStatus: 'completed',
      notes: ''
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
  const restartAiTasksBtn = document.getElementById('restartAiTasksBtn');
  // Context Menu Elements
  const folderContextMenu = document.getElementById('folder-context-menu');
  const deleteFolderBtn = document.getElementById('delete-folder-btn');
  const notesEditModal = document.getElementById('notesEditModal'); // <-- Add this
  const closeNotesModal = document.getElementById('closeNotesModal'); // <-- Add this
  const saveNotesBtn = document.getElementById('saveNotesBtn');       // <-- Add this
  const cancelNotesBtn = document.getElementById('cancelNotesBtn');   // <-- Add this
  const notesEditTextarea = document.getElementById('notesEditTextarea'); // <-- Add this
  const notesEditTitle = document.getElementById('notesEditTitle');     // <-- Add this

  //更新开始
  const loadingOverlay = document.getElementById('loadingOverlay');
  const loadingMessage = document.getElementById('loadingMessage');
  const progressMessage = document.getElementById('progressMessage');

  // 检查关键元素是否存在
  if (!importBtn || !searchInput || !languageSelector || !folderTreeContainer || !bookmarkListContainer) {
    throw new Error('Critical DOM elements not found');
  }

  closeNotesModal.addEventListener('click', closeTheNotesModal);
  cancelNotesBtn.addEventListener('click', closeTheNotesModal);
  saveNotesBtn.addEventListener('click', handleSaveNotes); // Note this doesn't take params anymore

  // --- Event Listeners ---
  if(restartAiTasksBtn) {
    restartAiTasksBtn.addEventListener('click', handleRestartAiTasks);
  }
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
      qaSection.style.display = 'block';
      // Set the initial content when opening
      showQALoading(false); 
    });
  }
  const closeQABtn = document.getElementById('closeQA');
  if (closeQABtn && qaSection) {
    closeQABtn.addEventListener('click', () => {
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

  if (qaSection) {
      qaSection.addEventListener('click', (e) => {
          const target = e.target;

          // Handle "Add to Bookmarks" clicks
          if (target.classList.contains('add-btn')) {
              const { url, title, category, tags, description } = target.dataset;
              addRecommendedSite(url, title, category, tags.split(','), description);
              return;
          }

          // Handle "Visit Site" clicks
          if (target.classList.contains('visit-btn')) {
              openUrl(target.dataset.url);
              return;
          }

          // Handle "Reset QA" clicks
          if (target.id === 'resetQAButton') {
              showQALoading(false);
              return;
          }
      });
  }

  // --- Init ---
  loadAllItems();
  loadAIConfig();
  loadLanguageSetting();
  chrome.storage.onChanged.addListener(handleStorageChange);

  // 初始化智能分类管理器
  smartCategoryManager = new SmartCategoryManager(i18n);
  smartCategoryManager.init();

  // 添加全局消息监听器，处理来自background的智能分类刷新请求
  chrome.runtime.onMessage.addListener((message) => {
    if (message.action === 'refreshSmartCategories') {
      if (smartCategoryManager) {
        smartCategoryManager.loadSmartCategories().then(() => {
          smartCategoryManager.renderSmartCategories();
        });
      }
    }
  });

  // 暴露函数给智能分类管理器使用
  window.renderBookmarkList = renderBookmarkList;
  window.showToast = showToast;

  // 初始化新标签页切换开关
  function initNewTabToggle() {
    const newtabToggle = document.getElementById('newtabToggle');
    if (!newtabToggle) return;

    // Load the current setting from storage
    chrome.storage.local.get('showStarredInNewtab', (data) => {
        const isEnabled = data.showStarredInNewtab !== false; // default to true if not set
        newtabToggle.checked = isEnabled;
    });

    // Add event listener to save setting when toggled
    newtabToggle.addEventListener('change', (event) => {
        const isEnabled = event.target.checked;
        chrome.storage.local.set({ showStarredInNewtab: isEnabled }, () => {
            if (chrome.runtime.lastError) {
                console.error('Failed to save newtab setting:', chrome.runtime.lastError);
            } else {
                console.log('Newtab setting saved:', isEnabled);
            }
        });
    });
  }

  initNewTabToggle();

  // 绑定文件夹折叠事件
  const foldersHeader = document.getElementById('folders-header');
  if (foldersHeader) {
    foldersHeader.addEventListener('click', () => toggleFolderSection());
  }

  // 定义文件夹折叠功能
  function toggleFolderSection() {
    const header = document.querySelector('.folder-section .section-header');
    const content = document.querySelector('.folder-section .section-content');
    const toggleIcon = header?.querySelector('.toggle-icon');

    if (header && content && toggleIcon) {
      content.classList.toggle('collapsed');

      // 更新切换图标
      if (content.classList.contains('collapsed')) {
        toggleIcon.textContent = '▶';
      } else {
        toggleIcon.textContent = '▼';
      }
    }
  }

  // 文件夹折叠功能已定义为本地函数
  
  // --- Main Functions ---
  function loadAllItems() {
    console.log('Loading all items from storage...');
    chrome.storage.local.get("bookmarkItems", data => {
      console.log('Loaded', (data.bookmarkItems || []).length, 'bookmarks from storage');
      allItems = data.bookmarkItems || [];

      // 如果没有数据，添加测试数据用于问答功能演示
      if (allItems.length === 0) {
        console.log('No bookmarks found, adding test data');
        allItems = [...testBookmarks];
      }

      renderFolderTree();
      renderBookmarkList(activeFolderId);

      // 检查是否有卡住的AI任务，如果有则自动恢复
      const stuckItems = allItems.filter(item => 
        item.type === 'bookmark' && (item.aiStatus === 'pending' || item.aiStatus === 'processing')
      );
      
      if (stuckItems.length > 0) {
        console.log(`检测到 ${stuckItems.length} 个卡住的AI任务，正在自动恢复...`);
        chrome.runtime.sendMessage({ action: "recoverStuckTasks" }, (response) => {
          if (chrome.runtime.lastError) {
            console.error('发送恢复任务请求失败:', chrome.runtime.lastError);
          } else {
            console.log('AI任务恢复已启动');
          }
        });
      }
    });
  }

  function renderFolderTree() {
    // 渲染到新的文件夹内容区域
    let targetContainer = document.getElementById('folders-content');
    if (!targetContainer) {
      // 如果新结构不存在，回退到原有方式
      folderTreeContainer.innerHTML = '';
      targetContainer = folderTreeContainer;
    } else {
      targetContainer.innerHTML = '';
    }

    const tree = document.createElement('div');
    tree.className = 'folder-tree';

    const specialFolders = [
        { id: 'root', titleKey: 'allBookmarks', count: allItems.filter(i => i.type === 'bookmark').length, icon: 'all' },
        { id: 'starred', titleKey: 'starredBookmarks', count: allItems.filter(i => i.isStarred).length, icon: 'star' }
    ];

    specialFolders.forEach(folder => {
        const itemEl = createTreeItem({ id: folder.id, title: i18n.get(folder.titleKey), type: 'special' }, 0, folder.count);
        tree.appendChild(itemEl);
    });

    // --- FIX: Logic to build tree based on serverId as parentId ---
    const buildTree = (parentId, level) => { // parentId is now the serverId (or 'root') of the parent
        const ul = document.createElement('ul');
        
        // Find children by comparing their parentId with the parent's serverId.
        const children = allItems.filter(item => item.parentId === parentId && item.type === 'folder');
        children.sort((a,b) => a.title.localeCompare(b.title));
        
        children.forEach(child => {
            const li = document.createElement('li');
            
            // A child's reference ID is its serverId (if synced) or its clientId (if offline).
            const childReferenceId = child.serverId || child.clientId;

            // Count bookmarks inside this child folder using the child's referenceId.
            const childCount = allItems.filter(i => i.parentId === childReferenceId && i.type === 'bookmark').length;
            
            const itemEl = createTreeItem(child, level, childCount);
            li.appendChild(itemEl);

            const grandChildrenContainer = document.createElement('div');
            grandChildrenContainer.className = 'tree-item-children';
            // Recursion must use the child's referenceId.
            grandChildrenContainer.appendChild(buildTree(childReferenceId, level + 1));
            li.appendChild(grandChildrenContainer);
            
            ul.appendChild(li);
        });
        return ul;
    };
    tree.appendChild(buildTree('root', 0));

    // 添加到目标容器
    targetContainer.appendChild(tree);
    const activeEl = targetContainer.querySelector(`.tree-item[data-id="${activeFolderId}"]`);
    if (activeEl) activeEl.classList.add('active');
  }

  function renderBookmarkList(folderId, searchResults = null, customTitle = null) {
      bookmarkListContainer.innerHTML = '';
      let itemsToShow = [];
      let breadcrumbText = '';

      if (searchResults !== null) {
          itemsToShow = searchResults;
          breadcrumbText = customTitle || i18n.get('searchResults');
      } else {
          activeFolderId = folderId;
          if (folderId === 'starred') {
              itemsToShow = allItems.filter(item => item.isStarred && item.type === 'bookmark');
              breadcrumbText = i18n.get('starredBookmarks');
          } else if (folderId === 'root') {
              itemsToShow = allItems.filter(item => item.type === 'bookmark');
              breadcrumbText = i18n.get('allBookmarks');
          } else {
              // --- FIX: Filter items where parentId matches the folder's referenceId (which is the folderId). ---
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

  function openNotesModal(bookmark) {
    currentEditingBookmarkId = bookmark.clientId; //

    notesEditTitle.textContent = bookmark.title; // Show bookmark title in modal
    notesEditTextarea.value = bookmark.notes || ''; // Populate textarea
    notesEditModal.style.display = 'block'; // Show the modal
    notesEditTextarea.focus();
  }

  function closeTheNotesModal() {
    notesEditModal.style.display = 'none';
    currentEditingBookmarkId = null; // Reset the ID
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

      // 处理文件夹类型的点击
      if (type === 'folder') {
          const isToggleClick = event.target.closest('.icon.toggle');
          // 如果是点击折叠/展开图标
          if (isToggleClick) {
              target.classList.toggle('collapsed');
          } else {
              // 如果是点击文件夹本身
              searchInput.value = '';
              // 核心修复：在渲染列表前，先更新 activeFolderId 这个全局状态
              activeFolderId = id; 
              renderBookmarkList(activeFolderId);
          }
      // 处理特殊文件夹（全部、星标）的点击
      } else if (type === 'special') {
          searchInput.value = '';
          // 核心修复：同样，更新 activeFolderId
          activeFolderId = id; 
          renderBookmarkList(activeFolderId);
      }
  }

  /**
   * Handles all click events within the main bookmark list container.
   * It delegates actions like starring, deleting, opening notes, etc., to their respective functions.
   *
   * @param {Event} event - The click event object.
   */
  function handleListClick(event) {
      const target = event.target;
      const actionBtn = target.closest('.action-btn');

      // Handle clicks on action buttons (star, delete, regenerate, notes, assistant)
      if (actionBtn) {
          const id = actionBtn.dataset.id; // This 'id' is correctly retrieved as the clientId.
          if (actionBtn.classList.contains('star')) {
              handleStarToggle(id, actionBtn);
          }
          if (actionBtn.classList.contains('delete-btn')) {
              handleDelete(id);
          }
          if (actionBtn.classList.contains('regenerate-btn')) {
              handleRegenerateClick(id);
          }
          if (actionBtn.classList.contains('notes-btn')) {
              // --- KEY CHANGE ---
              // Find the bookmark in the `allItems` array using its `clientId`.
              // The original code `find(b => b.id === id)` is now incorrect.
              const bookmark = allItems.find(b => b.clientId === id);
              if (bookmark) {
                  openNotesModal(bookmark); // Call the function to open the notes modal
              }
          }

          // Handle the click for the learning assistant button
          if (actionBtn.classList.contains('assistant-btn')) {
              // Also find the bookmark by its `clientId` here.
              const bookmark = allItems.find(b => b.clientId === id);
              if (bookmark) {
                  showToast(i18n.get('openingLearningAssistant'), 2000);
                  chrome.runtime.sendMessage({ action: "openLearningAssistant", bookmark: bookmark });
              }
          }

          return; // Stop further processing after an action button is handled.
      }

      /*
      The commented-out code for inline notes editing is no longer used, 
      as the logic has been moved to a modal.
      
      const saveBtn = target.closest('.save-notes-btn');
      if (saveBtn) { ... }
      const cancelBtn = target.closest('.cancel-notes-btn');
      if (cancelBtn) { ... }
      */

      // Handle clicks on the main bookmark area to open the link in a new tab.
      const clickable = target.closest('.clickable');
      if (clickable) {
          event.preventDefault();
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
    console.log('Storage change detected:', Object.keys(changes));

    if (changes.bookmarkItems) {
      console.log('Bookmark items changed, updating UI...');
      console.log('Old count:', changes.bookmarkItems.oldValue?.length || 0);
      console.log('New count:', changes.bookmarkItems.newValue?.length || 0);

      allItems = changes.bookmarkItems.newValue || [];

      // --- FIX: Check if active folder exists by its referenceId ---
      if (!allItems.some(item => (item.serverId === activeFolderId || item.clientId === activeFolderId))) {
          if (activeFolderId !== 'root' && activeFolderId !== 'starred') {
             activeFolderId = 'root';
          }
      }

      // 强制重新渲染所有UI组件
      renderFolderTree();
      if (searchInput.value.trim()) {
        handleSearch();
      } else {
        renderBookmarkList(activeFolderId);
      }

      // 书签数据变化时自动刷新智能分类
      if (smartCategoryManager) {
        smartCategoryManager.loadSmartCategories().then(() => {
          smartCategoryManager.renderSmartCategories();
        });
      }

      console.log('UI updated with', allItems.length, 'bookmarks');
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
  
  async function saveAIConfig() {
    const provider = document.getElementById('aiProvider').value;
    let config = {
      provider,
      lastModified: new Date().toISOString() // 添加时间戳
    };

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

    const analysisDepth = document.getElementById('aiAnalysisDepth').value;

    try {
      // 1. 保存到本地
      await new Promise((resolve, reject) => {
        chrome.storage.local.set({
          aiConfig: config,
          aiAnalysisDepth: analysisDepth
        }, () => {
          if (chrome.runtime.lastError) {
            reject(chrome.runtime.lastError);
          } else {
            resolve();
          }
        });
      });

      // 2. 同步到服务器（如果用户已登录）
      await syncAIConfigToServer(config, analysisDepth);

      showToast(i18n.get('configSaved'));
    } catch (error) {
      console.error("Error saving config:", error);
      showToast(i18n.get("operationFailed"), 3000, "#ea4335");
    }
  }

  function loadAIConfig() {
    // 只负责从本地存储加载配置到UI，不进行服务器同步
    // 服务器同步由登录后的 background.js 中的 syncAIConfigAfterLogin() 处理
    chrome.storage.local.get(['aiConfig', 'aiAnalysisDepth'], (data) => {
      const config = data.aiConfig || {};
      if (config.provider) {
        // 将provider值转换为小写以匹配select选项
        aiProvider.value = config.provider.toLowerCase();
      }

      const analysisDepth = data.aiAnalysisDepth || 'standard';
      const depthSelector = document.getElementById('aiAnalysisDepth');
      if (depthSelector) {
        depthSelector.value = analysisDepth;
      }

      // 使用不区分大小写的比较来处理provider匹配
      const providerLower = config.provider ? config.provider.toLowerCase() : '';
      
      document.getElementById('openaiKey').value = providerLower === 'openai' ? config.apiKey || '' : '';
      document.getElementById('openaiModel').value = providerLower === 'openai' ? config.model || 'gpt-4o' : 'gpt-4o';

      document.getElementById('deepseekKey').value = providerLower === 'deepseek' ? config.apiKey || '' : '';
      document.getElementById('deepseekModel').value = providerLower === 'deepseek' ? config.model || 'deepseek-chat' : 'deepseek-chat';

      document.getElementById('openrouterKey').value = providerLower === 'openrouter' ? config.apiKey || '' : '';
      document.getElementById('openrouterModel').value = providerLower === 'openrouter' ? config.model || '' : '';

      handleProviderChange();
    });
  }

  // AI配置同步相关函数



  /**
   * 将本地AI配置同步到服务器
   * 使用新的RESTful API设计：POST创建/替换，PUT部分更新
   */
  async function syncAIConfigToServer(config, analysisDepth) {
    try {
      // 检查用户是否已登录
      const authData = await new Promise(resolve => {
        chrome.storage.local.get('authData', (data) => resolve(data.authData));
      });

      if (!authData || !authData.token) {
        console.log('用户未登录，跳过AI配置同步到服务器');
        return;
      }

      // 准备配置数据（符合新API格式）
      const configPayload = {
        provider: config.provider,
        apiKey: config.apiKey,
        model: config.model
        // 注意：analysisDepth不在标准AI配置中，可能需要单独处理
      };

      // 首先尝试获取现有配置，判断是创建还是更新
      let method = 'POST'; // 默认创建/替换
      let url = 'https://bookmarker-api.aiwetalk.com/api/user/settings/ai-config';

      try {
        const existingResponse = await fetch(url, {
          headers: { 'Authorization': `${authData.token}` }
        });

        if (existingResponse.ok) {
          // 配置已存在，使用PUT进行部分更新
          method = 'PUT';
          console.log('AI配置已存在，使用PUT更新');
        } else if (existingResponse.status === 404) {
          // 配置不存在，使用POST创建
          method = 'POST';
          console.log('AI配置不存在，使用POST创建');
        }
      } catch (checkError) {
        console.warn('检查现有配置失败，默认使用POST:', checkError);
      }

      // 执行同步操作
      const response = await fetch(url, {
        method: method,
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `${authData.token}`
        },
        body: JSON.stringify(configPayload)
      });

      if (!response.ok) {
        const errorBody = await response.json().catch(() => ({}));
        throw new Error(`同步到服务器失败: ${response.status} - ${errorBody.error || response.statusText}`);
      }

      const result = await response.json();
      console.log('AI配置已同步到服务器:', result);

    } catch (error) {
      console.error('同步AI配置到服务器失败:', error);
      // 不抛出错误，允许本地保存成功
    }
  }

  /**
   * AI配置冲突解决：基于时间戳比较
   * @param {Object} localConfig 本地配置
   * @param {Object} serverConfig 服务器配置
   * @returns {boolean} true表示应该使用服务器配置，false表示使用本地配置
   */
  function resolveAIConfigConflict(localConfig, serverConfig) {
    const localTime = new Date(localConfig.lastModified || 0);
    const serverTime = new Date(serverConfig.lastModified || 0);

    console.log('AI配置时间戳比较:', {
      local: localConfig.lastModified,
      server: serverConfig.lastModified,
      localTime: localTime.getTime(),
      serverTime: serverTime.getTime(),
      useServer: serverTime > localTime
    });

    // 返回true表示服务器配置更新，应该使用服务器配置
    return serverTime > localTime;
  }

  /**
   * 删除服务器上的AI配置
   */
  async function deleteAIConfigFromServer() {
    try {
      // 检查用户是否已登录
      const authData = await new Promise(resolve => {
        chrome.storage.local.get('authData', (data) => resolve(data.authData));
      });

      if (!authData || !authData.token) {
        console.log('用户未登录，无法删除服务器AI配置');
        return false;
      }

      const response = await fetch('https://bookmarker-api.aiwetalk.com/api/user/settings/ai-config', {
        method: 'DELETE',
        headers: {
          'Authorization': `${authData.token}`
        }
      });

      if (response.status === 404) {
        console.log('服务器上无AI配置可删除');
        return true; // 视为成功，因为目标已达成
      }

      if (!response.ok) {
        const errorBody = await response.json().catch(() => ({}));
        throw new Error(`删除服务器配置失败: ${response.status} - ${errorBody.error || response.statusText}`);
      }

      const result = await response.json();
      console.log('服务器AI配置已删除:', result);
      return true;

    } catch (error) {
      console.error('删除服务器AI配置失败:', error);
      return false;
    }
  }

  /**
   * 清除所有AI配置（本地和服务器）
   */
  async function clearAllAIConfig() {
    if (!confirm(i18n.get('confirmClearAIConfig'))) {
      return;
    }

    try {
      // 1. 删除服务器配置
      const serverDeleted = await deleteAIConfigFromServer();

      // 2. 删除本地配置
      await new Promise((resolve, reject) => {
        chrome.storage.local.remove(['aiConfig', 'aiAnalysisDepth'], () => {
          if (chrome.runtime.lastError) {
            reject(chrome.runtime.lastError);
          } else {
            resolve();
          }
        });
      });

      // 3. 清空UI
      document.getElementById('aiProvider').value = '';
      document.getElementById('openaiKey').value = '';
      document.getElementById('openaiModel').value = 'gpt-4o';
      document.getElementById('deepseekKey').value = '';
      document.getElementById('deepseekModel').value = 'deepseek-chat';
      document.getElementById('openrouterKey').value = '';
      document.getElementById('openrouterModel').value = '';
      document.getElementById('aiAnalysisDepth').value = 'standard';

      handleProviderChange();

      if (serverDeleted) {
        showToast(i18n.get('aiConfigCleared'));
      } else {
        showToast(i18n.get('aiConfigClearedLocalOnly'), 3000, '#ff9800');
      }

    } catch (error) {
      console.error('清除AI配置失败:', error);
      showToast(i18n.get('aiConfigClearFailed', { error: error.message }), 3000, '#f44336');
    }
  }





/**
   * Handles the click event for the "Restart AI Analysis" button.
   * Sends a message to the background script to force restart the AI task queue.
   */
  function handleRestartAiTasks() {
    if (confirm(i18n.get('confirmRestartAiTasks'))) {
      showToast(i18n.get('restartingAiTasks'), 2000, "#1976d2");
      
      chrome.runtime.sendMessage({ action: "forceRestartAiQueue" }, (response) => {
        if (response && response.status === 'success') {
          showToast(i18n.get('restartAiTasksSuccess', { count: response.restartedCount }), 4000, '#4CAF50');
          
          // 监听存储变化来刷新智能分类
          const refreshHandler = (changes) => {
            if (changes.bookmarkItems) {
              // 刷新智能分类列表
              if (smartCategoryManager) {
                smartCategoryManager.loadSmartCategories().then(() => {
                  smartCategoryManager.renderSmartCategories();
                });
              }
              // 移除监听器，避免重复刷新
              chrome.storage.onChanged.removeListener(refreshHandler);
            }
          };
          
          // 添加存储变化监听器
          chrome.storage.onChanged.addListener(refreshHandler);
          
          // 设置超时自动移除监听器（10秒后）
          setTimeout(() => {
            chrome.storage.onChanged.removeListener(refreshHandler);
          }, 10000);
        } else {
          showToast(i18n.get('restartAiTasksFailed', { message: response?.message || 'Unknown error' }), 3000, "#ea4335");
        }
      });
    }
  }

  function handleImportBookmarks() {
    // 立即反馈：禁用按钮，改变文本
    importBtn.disabled = true;
    importBtn.textContent = i18n.get('importing');

    // 初始toast
    showToast(i18n.get('importStarted'), 2000, '#4285f4');

    // 显示加载遮罩的定时器（如果>2秒未完成）
    let loadingTimeout = setTimeout(() => {
      if (loadingOverlay) {
        loadingOverlay.classList.remove('hidden');
        if (loadingMessage) loadingMessage.textContent = i18n.get('importingBookmarks');
        if (progressMessage) progressMessage.textContent = ''; // 由于进度在background.js，无法实时更新，这里可选显示“处理中...”
      }
    }, 1000);

    chrome.runtime.sendMessage({ action: "importBrowserBookmarks" }, response => {
      // 完成：隐藏加载，恢复按钮
      clearTimeout(loadingTimeout);
      if (loadingOverlay) loadingOverlay.classList.add('hidden');
      importBtn.disabled = false;
      importBtn.textContent = i18n.get('importBookmarks') || 'Import Bookmarks';

      if (chrome.runtime.lastError || response?.status !== "success") {
        showToast(i18n.get("importFailed"), 2000, "#ff4444");
      } else if (response.count > 0) {
        showToast(i18n.get('importSuccess', {count: response.count}));
      } else {
        showToast(i18n.get("importNoNew"));
      }

      // 刷新UI（假设导入成功后需要）
      loadAllItems(); // 或 renderFolderTree(); renderBookmarkList(activeFolderId);
    });
  }
/*
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
*/
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
            
            // 监听存储变化来刷新智能分类
            const refreshHandler = (changes) => {
              if (changes.bookmarkItems) {
                // 刷新智能分类列表
                if (smartCategoryManager) {
                  smartCategoryManager.loadSmartCategories().then(() => {
                    smartCategoryManager.renderSmartCategories();
                  });
                }
                // 移除监听器，避免重复刷新
                chrome.storage.onChanged.removeListener(refreshHandler);
              }
            };
            
            // 添加存储变化监听器
            chrome.storage.onChanged.addListener(refreshHandler);
            
            // 设置超时自动移除监听器（10秒后）
            setTimeout(() => {
              chrome.storage.onChanged.removeListener(refreshHandler);
            }, 10000);
        }
    });
  }

  // --- Context Menu Handlers ---
  function handleTreeContextMenu(event) {
    const target = event.target.closest('.tree-item');
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

    // --- FIX: Find folder by referenceId and send its stable clientId for deletion ---
    const folderToDelete = allItems.find(item => item.serverId === contextMenuFolderId || item.clientId === contextMenuFolderId);
    if (!folderToDelete) return;
    
    const confirmationMessage = i18n.get('confirmDeleteFolder', { folderName: folderToDelete.title });
    
    if (confirm(confirmationMessage)) {
      // Always send the stable clientId to the background script for deletion logic.
      chrome.runtime.sendMessage({ action: "deleteBookmark", id: folderToDelete.clientId }, response => {
        if (chrome.runtime.lastError || response?.status !== "success") {
          showToast(i18n.get("operationFailed"), 2000, "#ff4444");
        } else {
          showToast(i18n.get('folderDeleted'));
        }
      });
    }
    contextMenuFolderId = null; 
  }

  // --- 更新：保存备注的函数 ---
  // options.js

// --- 更新：保存备注的函数 ---
  function handleSaveNotes() {
    if (!currentEditingBookmarkId) return;

    const notes = notesEditTextarea.value;
    
    // 核心修改：不直接操作本地存储，而是发送消息给 background.js
    // 让 background.js 作为唯一的数据修改和同步发起者
    chrome.runtime.sendMessage({
        action: 'updateBookmarkNotes', // 这是发送给 background.js 的指令
        id: currentEditingBookmarkId,
        notes: notes
    }, (response) => {
        // 处理 background.js 返回的结果
        if (response?.status === 'success') {
            showToast(i18n.get('notesSaved'));
            closeTheNotesModal();
            // 注意：UI的更新会由 background.js 修改存储后，通过 storage.onChanged 监听器自动触发，无需手动刷新
        } else {
            showToast(i18n.get("operationFailed"), 2000, "#ff4444");
        }
    });
  }
  /*
  function handleSaveNotes() {
    if (!currentEditingBookmarkId) return;

    const notes = notesEditTextarea.value;
    const index = allItems.findIndex(item => item.id === currentEditingBookmarkId);

    if (index !== -1) {
      allItems[index].notes = notes;

      chrome.storage.local.set({ bookmarkItems: allItems }, () => {
        if (chrome.runtime.lastError) {
          showToast(i18n.get("operationFailed"), 2000, "#ff4444");
        } else {
          showToast(i18n.get('notesSaved'));
          closeTheNotesModal(); // Close modal on success

          // Re-render the specific bookmark item to update the button state
          const oldBookmarkElement = document.querySelector(`.bookmark-item[data-id="${currentEditingBookmarkId}"]`);
          if (oldBookmarkElement) {
            const newBookmarkElement = createBookmarkElement(allItems[index]);
            newBookmarkElement.dataset.id = currentEditingBookmarkId; // Ensure it has the data-id for future queries
            oldBookmarkElement.parentNode.replaceChild(newBookmarkElement, oldBookmarkElement);
          }
        }
      });
    }
  }
    */

  // --- Helper Functions ---
  function createTreeItem(item, level, count) {
    const div = document.createElement('div');
    div.className = 'tree-item';
    
    // --- FIX: The data-id is now the referenceId (serverId or clientId for offline items) ---
    // This is the ID used for clicking and identifying the active folder.
    const referenceId = item.serverId || item.clientId;
    div.dataset.id = referenceId || item.id; // Fallback to item.id for special folders like 'root', 'starred'

    div.dataset.type = item.type;
    div.style.paddingLeft = `${8 + level * 20}px`;

    let iconHtml = '';
    if (item.type === 'folder') {
        const hasChildren = allItems.some(i => i.parentId === referenceId);
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

  // --- 更新：创建书签元素的函数 ---
  /**
 * Creates and returns the HTML element for a single bookmark item for the main options page.
 * This function displays comprehensive details including AI analysis and all action buttons.
 *
 * @param {object} bookmark - The bookmark object containing all its data.
 * @returns {HTMLElement} A div element representing the bookmark.
 */
  function createBookmarkElement(bookmark) {
      const div = document.createElement('div');
      div.className = 'bookmark-item';
      // --- KEY CHANGE ---
      // The element's primary identifier is set to the stable `clientId`.
      // All actions will now reference this ID.
      div.dataset.id = bookmark.clientId;

      const faviconUrl = getFaviconUrl(bookmark.url); // Dependency
      const statusHTML = getStatusHTML(bookmark);   // Dependency
      
      // Check if the bookmark has any notes to apply a special style to the button.
      const hasNotes = bookmark.notes && bookmark.notes.trim() !== '';

      // SVG icon for the "Learning Assistant" button.
      const assistantIconSVG = `<svg xmlns="http://www.w3.org/2000/svg" height="20px" viewBox="0 0 24 24" width="20px" fill="#6a1b9a"><path d="M0 0h24v24H0V0z" fill="none"/><path d="M5 13.18v4L12 21l7-3.82v-4L12 17l-7-3.82zM12 3L1 9l11 6 9-4.91V17h2V9L12 3z"/></svg>`;

      // The main HTML structure for the bookmark item.
      div.innerHTML = `
        <div class="bookmark-header">
          <img class="favicon" src="${faviconUrl}" width="16" height="16" loading="lazy" alt="">
          <div class="bookmark-title clickable" data-url="${bookmark.url}">${bookmark.title}</div>
          <div class="action-buttons">
            <button class="action-btn star ${bookmark.isStarred ? 'starred' : ''}" data-id="${bookmark.clientId}" title="${i18n.get('toggleStar')}">★</button>
            <button class="action-btn assistant-btn" data-id="${bookmark.clientId}" title="${i18n.get('learningAssistant')}">${assistantIconSVG}</button>          
            <button class="action-btn notes-btn ${hasNotes ? 'has-notes' : ''}" data-id="${bookmark.clientId}" title="${i18n.get('editNotes')}">
              <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="20" height="20">
                <path d="M3 17.25V21h3.75L17.81 9.94l-3.75-3.75L3 17.25zM20.71 7.04c.39-.39.39-1.02 0-1.41l-2.34-2.34c-.39-.39-1.02-.39-1.41 0l-1.83 1.83 3.75 3.75 1.83-1.83z"/>
                <path d="M0 0h24v24H0z" fill="none"/>
              </svg>
            </button>
            <button class="action-btn regenerate-btn" data-id="${bookmark.clientId}" title="${i18n.get('regenerateAI')}">🔄</button>
            <button class="action-btn delete-btn" data-id="${bookmark.clientId}" title="${i18n.get('delete')}">🗑</button>
          </div>
        </div>
        
        <div class="bookmark-url clickable" data-url="${bookmark.url}">${bookmark.url}</div>
        
        ${bookmark.aiStatus === 'completed' ? `
          ${bookmark.category ? `<div class="bookmark-category">${bookmark.category}</div>` : ''}

          ${bookmark.smartCategories && bookmark.smartCategories.length > 0 ? `
            <div class="bookmark-smart-categories">
              <span class="smart-categories-label">✨ ${i18n.get('smartCategoriesLabel')}:</span>
              ${bookmark.smartCategories.map(category => `<span class="smart-category" data-category="${category}">${category}</span>`).join('')}
              ${bookmark.smartCategoriesConfidence ? `<span class="confidence-badge" title="${i18n.get('confidenceTooltip')}">${Math.round(bookmark.smartCategoriesConfidence * 100)}%</span>` : ''}
            </div>
          ` : ''}

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
      
      // Add event listeners to the tag elements to enable searching by tag.
      const tagElements = div.querySelectorAll('.tag[data-tag]');
      tagElements.forEach(tagEl => {
        tagEl.addEventListener('click', (e) => {
          e.stopPropagation(); // Prevent the click from bubbling up to the main item.
          searchByTag(tagEl.dataset.tag); // Dependency
        });
      });

      // Add event listeners to the smart category elements to enable filtering by smart category.
      const smartCategoryElements = div.querySelectorAll('.smart-category[data-category]');
      smartCategoryElements.forEach(categoryEl => {
        categoryEl.addEventListener('click', (e) => {
          e.stopPropagation(); // Prevent the click from bubbling up to the main item.
          searchBySmartCategory(categoryEl.dataset.category);
        });
      });
      
      return div;
  }

  function getBreadcrumb(folderId) { // folderId is a referenceId (serverId or clientId)
      if (folderId === 'root') return i18n.get('allBookmarks');
      let path = [];
      let currentId = folderId;
      while (currentId && currentId !== 'root') {
          // --- FIX: Find the folder by checking if the currentId matches either serverId or clientId. ---
          const folder = allItems.find(item => item.serverId === currentId || item.clientId === currentId);
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

  // 添加按智能分类筛选功能
  function searchBySmartCategory(category) {
    const results = allItems.filter(item => {
      if (item.type !== 'bookmark') return false;
      return item.smartCategories && item.smartCategories.includes(category);
    });
    renderBookmarkList(null, results, i18n.get('smartCategoryFilter', { category }));
  }

  // --- QA System Functions ---
  async function handleAskQuestion() {
    try {
      const questionInput = document.getElementById('questionInput');
      if (!questionInput) {
        return;
      }

      const question = questionInput.value.trim();
      if (!question) {
        alert(i18n.get('qaMustEnterQuestion'));
        return;
      }

      showQALoading(true);
      const results = await searchInBookmarks(question);
      displaySearchResults(results, question);

    } catch (error) {
      console.error('QA function error:', error);
      alert(i18n.get('qaSearchError'));
      showQALoading(false);
    }
  }

  function showQALoading(show) {
    const qaInfo = document.querySelector('.qa-info');
    if (qaInfo) {
      if (show) {
        qaInfo.innerHTML = `<p>🔍 ${i18n.get('qaSearchingBookmarks')}</p>`;
      } else {
        qaInfo.innerHTML = `
          <p>📚 ${i18n.get('qaSystemTitle')}</p>
          <p>${i18n.get('qaSystemDescription')}:</p>
          <ul>
            <li>✅ ${i18n.get('qaFeature1')}</li>
            <li>✅ ${i18n.get('qaFeature2')}</li>
            <li>✅ ${i18n.get('qaFeature3')}</li>
            <li>✅ ${i18n.get('qaFeature4')}</li>
          </ul>
          <p style="color: #666; font-size: 12px; margin-top: 10px;">
            💡 ${i18n.get('qaTip')}
          </p>
        `;
      }
    }
  }

  function getQAPrompt(question, bookmarks, categories, tags, relatedBookmarks, lang) {
      return `${i18n.get('qaPromptSystem')}

    ${i18n.get('qaPromptQuestion')}：${question}

    ${i18n.get('qaPromptOverview')}：
    - ${i18n.get('qaPromptTotal')}：${bookmarks.length}${i18n.get('qaPromptSites')}
    - ${i18n.get('qaPromptMainCat')}：${categories.slice(0, 5).join(', ')}
    - ${i18n.get('qaPromptCommonTags')}：${tags.slice(0, 10).join(', ')}

    ${i18n.get('qaPromptRelated')}：
    ${relatedBookmarks.map(b => `- ${b.title} (${b.category || i18n.get('qaPromptUnclassified')})`).join('\n')}

    ${i18n.get('qaPromptFormatInstructions')}
    ${i18n.get('qaPromptFormatJson')}

    ${i18n.get('qaPromptStrictReq')}：
    ${i18n.get('qaPromptReq1')}
    ${i18n.get('qaPromptReq2')}
    ${i18n.get('qaPromptReq3')}
    ${i18n.get('qaPromptReq4')}
    ${i18n.get('qaPromptReq5')}`;
  }


  async function searchInBookmarks(question) {
    const { aiConfig } = await chrome.storage.local.get("aiConfig");
    const useAISearch = aiConfig && aiConfig.apiKey && aiConfig.enableSmartSearch !== false;

    if (useAISearch) {
      return await aiSmartSearch(question, aiConfig);
    } else {
      return await keywordSearch(question);
    }
  }

  async function keywordSearch(question) {
    const keywords = extractKeywords(question);
    const matchedBookmarks = allItems.filter(item => {
      if (item.type !== 'bookmark') return false;

      const searchText = [
        item.title || '',
        item.summary || '',
        item.category || '',
        ...(item.tags || []),
        ...(item.keyPoints || [])
      ].join(' ').toLowerCase();

      return keywords.some(keyword => searchText.includes(keyword.toLowerCase()));
    });

    return matchedBookmarks.map(bookmark => {
      const score = calculateBookmarkRelevanceScore(bookmark, keywords);
      return { bookmark, score };
    }).filter(result => result.score > 0.1)
      .sort((a, b) => b.score - a.score)
      .slice(0, 5);
  }

  async function aiSmartSearch(question, aiConfig) {
    try {
      const bookmarks = allItems.filter(item => item.type === 'bookmark');
      const categories = [...new Set(bookmarks.map(b => b.category).filter(c => c))];
      const tags = [...new Set(bookmarks.flatMap(b => b.tags || []))];

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

      const prompt = getQAPrompt(question, bookmarks, categories, tags, relatedBookmarks, currentLang);
      
      const response = await chrome.runtime.sendMessage({ action: "callAI", prompt: prompt });

      if (response && response.result) {
        try {
          let cleanedResponse = response.result.trim();
          if (cleanedResponse.includes('```json')) {
            const jsonStart = cleanedResponse.indexOf('```json') + 7;
            const jsonEnd = cleanedResponse.indexOf('```', jsonStart);
            if (jsonEnd > jsonStart) cleanedResponse = cleanedResponse.substring(jsonStart, jsonEnd).trim();
          } else if (cleanedResponse.includes('```')) {
            const jsonStart = cleanedResponse.indexOf('```') + 3;
            const jsonEnd = cleanedResponse.lastIndexOf('```');
            if (jsonEnd > jsonStart) cleanedResponse = cleanedResponse.substring(jsonStart, jsonEnd).trim();
          }

          const jsonStart = cleanedResponse.indexOf('{');
          const jsonEnd = cleanedResponse.lastIndexOf('}');
          if (jsonStart >= 0 && jsonEnd > jsonStart) cleanedResponse = cleanedResponse.substring(jsonStart, jsonEnd + 1);

          cleanedResponse = fixCommonJSONErrors(cleanedResponse);
          const aiResult = JSON.parse(cleanedResponse);

          if (!aiResult.answer) throw new Error('AI response missing answer field');

          const validatedRecommendations = await validateAndOptimizeRecommendations(
            aiResult.recommendations || [], bookmarks, relatedBookmarks, question
          );

          const existingBookmarkResults = relatedBookmarks.map(bookmark => ({
            bookmark: bookmark,
            score: 0.9,
            aiReason: i18n.get('qaReasonRelated'),
            matchedContent: bookmark.summary || bookmark.title
          }));

          return {
            type: 'qa_result',
            answer: aiResult.answer,
            recommendations: validatedRecommendations,
            existingBookmarks: existingBookmarkResults,
            tips: aiResult.tips || []
          };

        } catch (parseError) {
          console.error('AI response parse failed:', parseError, 'Raw response:', response.result);
          const fallbackAnswer = extractAnswerFromRawResponse(response.result) || i18n.get('qaJsonParseError');
          const fallbackRecommendations = extractRecommendationsFromRawResponse(response.result);

          return {
            type: 'qa_result',
            answer: fallbackAnswer,
            recommendations: fallbackRecommendations,
            existingBookmarks: [],
            tips: [i18n.get('qaTipRetry'), i18n.get('qaTipCheckConfig')]
          };
        }
      } else {
        throw new Error(i18n.get('operationFailed'));
      }

    } catch (error) {
      console.error('AI QA error:', error);
      return {
        type: 'qa_result',
        answer: i18n.get('qaAiSearchError', { message: error.message }),
        recommendations: [
          { title: "Google", url: "https://www.google.com/search?q=" + encodeURIComponent(question), description: i18n.get('qaSearchGoogle'), category: "Search", tags: ["search", "general"], why: "General search engine" },
          { title: "Baidu", url: "https://www.baidu.com/s?wd=" + encodeURIComponent(question), description: i18n.get('qaSearchBaidu'), category: "Search", tags: ["search", "chinese"], why: "Chinese search engine" }
        ],
        existingBookmarks: [],
        tips: [i18n.get('qaTipCheckConfig'), i18n.get('qaTipCheckNetwork'), i18n.get('qaTipRetry')]
      };
    }
  }

  function fixCommonJSONErrors(jsonStr) {
    try {
      jsonStr = jsonStr.replace(/^\uFEFF/, '').replace(/[\u0000-\u001F\u007F-\u009F]/g, '');
      jsonStr = jsonStr.replace(/}\s*\n\s*{/g, '},\n{').replace(/}\s*{/g, '}, {');
      jsonStr = jsonStr.replace(/"\s*\n\s*"/g, '",\n"').replace(/]\s*\n\s*"/g, '],\n"').replace(/}\s*\n\s*"/g, '},\n"');
      jsonStr = jsonStr.replace(/,(\s*])/g, '$1').replace(/,(\s*})/g, '$1');
      jsonStr = jsonStr.replace(/([^\\])"/g, '$1\\"').replace(/^"/g, '\\"');
      jsonStr = jsonStr.replace(/\\"/g, '"');
      if (!jsonStr.trim().endsWith('}')) {
        jsonStr = fixTruncatedJSON(jsonStr);
      }
      return jsonStr;
    } catch (error) {
      return jsonStr;
    }
  }

  function fixTruncatedJSON(jsonStr) {
    try {
      let fixedJson = jsonStr.trim();
      if (fixedJson.includes('"recommendations": [') && !fixedJson.includes(']')) {
        const lastCompleteObject = findLastCompleteObject(fixedJson);
        if (lastCompleteObject) fixedJson = lastCompleteObject;
        if (!fixedJson.includes(']')) fixedJson += ']';
        if (!fixedJson.endsWith('}')) fixedJson += '}';
      } else if (fixedJson.includes('"description":') && !fixedJson.includes('",')) {
        const descStart = fixedJson.lastIndexOf('"description":');
        if (descStart > 0) {
          const beforeDesc = fixedJson.substring(0, descStart);
          const lastObjStart = beforeDesc.lastIndexOf('{');
          if (lastObjStart > 0) {
            fixedJson = beforeDesc.substring(0, lastObjStart).replace(/,\s*$/, '');
            if (fixedJson.includes('"recommendations": [') && !fixedJson.includes(']')) fixedJson += ']';
            if (!fixedJson.endsWith('}')) fixedJson += '}';
          }
        }
      }
      return fixedJson;
    } catch (error) {
      return `{
        "answer": "${i18n.get('qaTruncatedError')}",
        "recommendations": [], "existingBookmarks": [], "tips": ["${i18n.get('qaTipRetryComplete')}"]
      }`;
    }
  }

  function findLastCompleteObject(jsonStr) {
    const objects = []; let braceCount = 0; let currentObj = ''; let inString = false; let escapeNext = false;
    for (let i = 0; i < jsonStr.length; i++) {
      const char = jsonStr[i];
      if (escapeNext) { escapeNext = false; currentObj += char; continue; }
      if (char === '\\') { escapeNext = true; currentObj += char; continue; }
      if (char === '"') inString = !inString;
      if (!inString) {
        if (char === '{') { if (braceCount === 0) currentObj = char; else currentObj += char; braceCount++;
        } else if (char === '}') { currentObj += char; braceCount--; if (braceCount === 0) { objects.push(currentObj); currentObj = ''; }
        } else { currentObj += char; }
      } else { currentObj += char; }
    }
    if (objects.length > 0) {
      const beforeLastObj = jsonStr.substring(0, jsonStr.lastIndexOf(objects[objects.length - 1]));
      return beforeLastObj + objects[objects.length - 1];
    }
    return null;
  }

  async function validateAndOptimizeRecommendations(recommendations, allBookmarks, relatedBookmarks, question) {
    if (!recommendations || recommendations.length === 0) return [];
    const optimizedRecs = [];
    for (const rec of recommendations) {
      try {
        let matchedBookmark = relatedBookmarks.find(b => b.url === rec.url || calculateSimilarity(b.title, rec.title) > 0.6);
        if (!matchedBookmark) matchedBookmark = allBookmarks.find(b => b.url === rec.url || calculateSimilarity(b.title, rec.title) > 0.7);
        if (matchedBookmark) {
          optimizedRecs.push({ ...rec, isBookmarked: true, bookmarkId: matchedBookmark.id, bookmarkTitle: matchedBookmark.title, bookmarkSummary: matchedBookmark.summary, relevanceScore: 1.0, verified: true, source: 'existing' });
        } else {
          if (!isValidUrl(rec.url)) continue;
          const relevanceScore = calculateRelevanceScore(rec, question, allBookmarks);
          optimizedRecs.push({ ...rec, isBookmarked: false, relevanceScore, verified: false, source: 'ai' });
        }
      } catch (error) { console.warn(`Error processing recommendation: ${rec.title}`, error); }
    }
    optimizedRecs.sort((a, b) => (a.isBookmarked && !b.isBookmarked) ? -1 : (!a.isBookmarked && b.isBookmarked) ? 1 : b.relevanceScore - a.relevanceScore);
    const newRecommendations = optimizedRecs.filter(rec => !rec.isBookmarked);
    if (newRecommendations.length > 0) setTimeout(() => validateUrlsInBackground(newRecommendations), 100);
    return optimizedRecs;
  }

  function calculateSimilarity(text1, text2) { const words1 = text1.toLowerCase().split(/\s+/); const words2 = text2.toLowerCase().split(/\s+/); const intersection = words1.filter(word => words2.includes(word)); const union = [...new Set([...words1, ...words2])]; return intersection.length / union.length; }
  function isValidUrl(string) { try { const url = new URL(string); return url.protocol === 'http:' || url.protocol === 'https:'; } catch (_) { return false; } }
  function calculateRelevanceScore(recommendation, question, existingBookmarks) { let score = 0.3; const titleWords = recommendation.title.toLowerCase().split(/\s+/); const questionWords = question.toLowerCase().split(/\s+/); const titleMatch = titleWords.filter(word => questionWords.includes(word)).length; score += (titleMatch / questionWords.length) * 0.3; const userCategories = [...new Set(existingBookmarks.map(b => b.category).filter(c => c))]; if (userCategories.includes(recommendation.category)) score += 0.2; const userTags = [...new Set(existingBookmarks.flatMap(b => b.tags || []))]; const tagMatches = (recommendation.tags || []).filter(tag => userTags.includes(tag)).length; score += (tagMatches / Math.max(recommendation.tags?.length || 1, 1)) * 0.2; return Math.min(score, 1.0); }
  async function validateUrlsInBackground(recommendations) { for (const rec of recommendations) { try { const controller = new AbortController(); const timeoutId = setTimeout(() => controller.abort(), 5000); await fetch(rec.url, { method: 'HEAD', signal: controller.signal, mode: 'no-cors' }); clearTimeout(timeoutId); rec.verified = true; } catch (error) { rec.verified = false; } } }
  function extractAnswerFromRawResponse(rawResponse) { try { const answerMatch = rawResponse.match(/"answer"\s*:\s*"([^"]*(?:\\.[^"]*)*)"/); return answerMatch ? answerMatch[1].replace(/\\"/g, '"') : i18n.get('qaJsonParseError'); } catch (error) { return i18n.get('qaJsonParseError'); } }
  function extractRecommendationsFromRawResponse(rawResponse) { const recs = []; if (rawResponse.includes('smallpdf.com')) recs.push({ title: "SmallPDF", url: "https://smallpdf.com/pdf-to-ppt", description: "Online PDF to PPT tool", category: "Tool", tags: ["PDF", "PPT", "Convert"], why: "Simple and supports Chinese" }); if (rawResponse.includes('ilovepdf.com')) recs.push({ title: "iLovePDF", url: "https://www.ilovepdf.com/pdf_to_powerpoint", description: "Free online PDF to editable PPT", category: "Tool", tags: ["File Conversion", "Office Tool"], why: "No registration, free to use" }); return recs; }

  function extractKeywords(question) {
    const stopWords = langData[langKey].stopWords;
    const synonyms = langData[langKey].synonyms;

    let keywords = question.toLowerCase().replace(/[^\w\s\u4e00-\u9fff]/g, ' ').split(/\s+/).filter(word => word.length > 1 && !stopWords.includes(word));
    const expandedKeywords = [...keywords];
    keywords.forEach(keyword => {
      if (synonyms[keyword]) expandedKeywords.push(...synonyms[keyword]);
    });
    return [...new Set(expandedKeywords)];
  }

  function calculateBookmarkRelevanceScore(bookmark, keywords) { let score = 0; const weights = { title: 0.4, summary: 0.3, category: 0.2, tags: 0.2, keyPoints: 0.1 }; if (!Array.isArray(keywords)) return 0; keywords.forEach(keyword => { const lk = keyword.toLowerCase(); if ((bookmark.title || '').toLowerCase().includes(lk)) score += weights.title; if ((bookmark.summary || '').toLowerCase().includes(lk)) score += weights.summary; if ((bookmark.category || '').toLowerCase().includes(lk)) score += weights.category; if ((bookmark.tags || []).some(t => t.toLowerCase().includes(lk))) score += weights.tags; if ((bookmark.keyPoints || []).some(p => p.toLowerCase().includes(lk))) score += weights.keyPoints; }); return Math.min(score, 1.0); }
  
  function displaySearchResults(results, question) {
    const qaInfo = document.querySelector('.qa-info');
    if (!qaInfo) return;

    if (results.type === 'qa_result') {
      displayQAResult(results, question);
      return;
    }
    
    if (results.length === 0) {
      let html = `
        <div style="text-align: center; padding: 20px;">
          <p>🤔 ${i18n.get('qaNoResults', { question: `"${question}"` })}</p>
          <p>${i18n.get('qaSuggestions')}:</p>
          <ul style="text-align: left; display: inline-block;">
            <li>${i18n.get('qaSuggestion1')}</li>
            <li>${i18n.get('qaSuggestion2')}</li>
            <li>${i18n.get('qaSuggestion3')}</li>
          </ul>
        </div>`;
       qaInfo.innerHTML = html;
       return;
    }

    let html = `
      <div style="max-height: 400px; overflow-y: auto;">
        <h4>🔍 ${i18n.get('qaResultsFound', { count: results.length })}</h4>`;
    results.forEach(result => {
      const { bookmark, score } = result;
      html += `
        <div style="border: 1px solid #ddd; border-radius: 8px; padding: 12px; margin: 10px 0; background: white;">
          <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 8px;">
            <h5 style="margin: 0; color: #333; cursor: pointer;" onclick="chrome.tabs.create({url: '${bookmark.url}'})">${bookmark.title}</h5>
            <span style="background: #e3f2fd; color: #1976d2; padding: 2px 8px; border-radius: 12px; font-size: 12px;">
              ${i18n.get('relevance')}: ${Math.round(score * 100)}%
            </span>
          </div>
          ${bookmark.summary ? `<p style="color: #666; font-size: 14px; margin: 5px 0;">${bookmark.summary}</p>` : ''}
          <div style="margin-top: 8px;">
            <button onclick="chrome.tabs.create({url: '${bookmark.url}'})" style="background: #1976d2; color: white; border: none; padding: 6px 12px; border-radius: 4px; cursor: pointer; font-size: 12px;">
              ${i18n.get('viewDetails')}
            </button>
          </div>
        </div>`;
    });
    html += '</div>';
    qaInfo.innerHTML = html;
  }

  function displayQAResult(qaResult, question) {
    const qaInfo = document.querySelector('.qa-info');
    if (!qaInfo) return;

    const { answer, recommendations, existingBookmarks, tips } = qaResult;
    let html = `<div style="max-height: 500px; overflow-y: auto;">
        <div style="background: #f8f9fa; padding: 15px; border-radius: 8px; margin-bottom: 15px;">
          <h4 style="color: #333; margin-top: 0;">🤖 ${i18n.get('aiAnswer')}:</h4>
          <p style="line-height: 1.6; color: #555;">${answer}</p>
        </div>`;
    
    const allBookmarked = [...(existingBookmarks || []), ...(recommendations.filter(r => r.isBookmarked) || [])];
    const uniqueBookmarked = [...new Map(allBookmarked.map(item => [item.bookmark?.id || item.bookmarkId, item])).values()];
    
    if (uniqueBookmarked.length > 0) {
      html += `<div style="background: #e8f5e8; padding: 15px; border-radius: 8px; margin-bottom: 15px;">
          <h4 style="color: #2e7d32; margin-top: 0;">📚 ${i18n.get('relatedInBookmarks')}:</h4>
          ${uniqueBookmarked.map(item => {
            const b = item.bookmark || item;
            return `<div style="margin: 8px 0; padding: 12px; background: white; border-radius: 4px; border-left: 4px solid #4caf50;">
                <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 8px;">
                  <strong style="color: #333;">${b.title || b.bookmarkTitle}</strong>
                  <span style="background: #4caf50; color: white; padding: 2px 6px; border-radius: 10px; font-size: 10px;">✅ ${i18n.get('alreadyBookmarked')}</span>
                </div>
                <p style="margin: 8px 0; color: #666; font-size: 13px;">${b.summary || b.description}</p>
                <div style="margin-top: 10px; display: flex; gap: 8px;">
                  <button class="visit-btn" data-url="${b.url}" style="background: #2e7d32; color: white; border: none; padding: 6px 12px; border-radius: 4px; cursor: pointer; font-size: 12px;">${i18n.get('visitSite')}</button>
                </div>
              </div>`;
          }).join('')}
        </div>`;
    }
    
    const newRecommendations = recommendations.filter(rec => !rec.isBookmarked);
    if (newRecommendations.length > 0) {
      html += `<div style="background: #fff3cd; padding: 15px; border-radius: 8px; margin-bottom: 15px;">
          <h4 style="color: #856404; margin-top: 0;">🌟 ${i18n.get('newRecommendations')}:</h4>
          ${newRecommendations.map(rec => `
            <div style="border: 1px solid #ffeaa7; border-radius: 6px; padding: 12px; margin: 10px 0; background: white;">
              <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 8px;">
                <h5 style="margin: 0; color: #333;">${rec.title}</h5>
                ${rec.verified === false ? `<span style="background: #ff9800; color: white; padding: 2px 6px; border-radius: 10px; font-size: 10px;">⚠️ ${i18n.get('verifying')}</span>` : ''}
              </div>
              <p style="color: #666; font-size: 14px; margin: 8px 0;">${rec.description}</p>
              <div style="background: #f0f8ff; padding: 8px; border-radius: 4px; margin: 8px 0; font-size: 13px;">
                <strong>💡 ${i18n.get('recommendationReason')}:</strong> ${rec.why}
              </div>
              <div style="margin-top: 10px; display: flex; gap: 8px;">
                <button class="visit-btn" data-url="${rec.url}" style="background: #1976d2; color: white; border: none; padding: 6px 12px; border-radius: 4px; cursor: pointer; font-size: 12px;">${i18n.get('visitSite')}</button>
                <button class="add-btn" data-url="${rec.url}" data-title="${rec.title}" data-category="${rec.category}" data-tags="${rec.tags.join(',')}" data-description="${rec.description}" style="background: #4caf50; color: white; border: none; padding: 6px 12px; border-radius: 4px; cursor: pointer; font-size: 12px;">${i18n.get('addToBookmarks')}</button>
              </div>
            </div>`).join('')}
        </div>`;
    }

    if (tips && tips.length > 0) {
      html += `<div style="background: #e3f2fd; padding: 15px; border-radius: 8px; margin-bottom: 15px;">
          <h4 style="color: #1976d2; margin-top: 0;">💡 ${i18n.get('practicalTips')}:</h4>
          <ul style="margin: 0; padding-left: 20px;">
            ${tips.map(tip => `<li style="margin: 5px 0; color: #555;">${tip}</li>`).join('')}
          </ul>
        </div>`;
    }
    html += `<div style="text-align: center; margin-top: 20px;">
          <button id="resetQAButton" style="background: #6c757d; color: white; border: none; padding: 8px 16px; border-radius: 4px; cursor: pointer;">${i18n.get('resetQA')}</button>
        </div></div>`;

    qaInfo.innerHTML = html;
    /*
    setTimeout(() => {
      qaInfo.addEventListener('click', (e) => {
        if (e.target.classList.contains('visit-btn')) openUrl(e.target.dataset.url);
        if (e.target.classList.contains('add-btn')) {
          const { url, title, category, tags, description } = e.target.dataset;
          addRecommendedSite(url, title, category, tags.split(','), description);
        }
      });
      const resetBtn = document.getElementById('resetQAButton');
      if (resetBtn) resetBtn.addEventListener('click', () => showQALoading(false));
    }, 100);
    */
  }

  function openUrl(url) { try { chrome.tabs.create({ url }); } catch (error) { window.open(url, '_blank'); } }
  window.openUrl = openUrl;

  async function addRecommendedSite(url, title, category, tags, description) {
    try {
      if (!chrome || !chrome.runtime) throw new Error('Chrome extension API not available');
      const response = await chrome.runtime.sendMessage({ action: "addBookmarkByUrl", url, title, category, tags: Array.isArray(tags) ? tags : [], summary: description });
      if (response && response.status === "success") {
        showToast(i18n.get('addedToBookmarksToast', { title }), 3000, "#28a745");
        if (typeof loadAllItems === 'function') loadAllItems();
      } else if (response && response.status === "exists") {
        showToast(i18n.get('alreadyExistsToast'), 2000, "#ffc107");
      } else {
        showToast(i18n.get('addFailedToast', { message: response?.message || i18n.get('operationFailed') }), 3000, "#dc3545");
      }
    } catch (error) {
      showToast(i18n.get('addFailedToast', { message: error.message }), 3000, "#dc3545");
    }
  }
  window.addRecommendedSite = addRecommendedSite;

  window.showBookmarkDetails = function(bookmarkId) {
    const bookmark = allItems.find(item => item.id === bookmarkId);
    if (!bookmark) return;
    const qaSection = document.getElementById('qaSection');
    if (qaSection) qaSection.style.display = 'none';
    renderBookmarkList('root');
    setTimeout(() => {
      const bookmarkElement = document.querySelector(`[data-bookmark-id="${bookmarkId}"]`);
      if (bookmarkElement) {
        bookmarkElement.scrollIntoView({ behavior: 'smooth', block: 'center' });
        bookmarkElement.style.backgroundColor = '#fff3cd';
        setTimeout(() => { bookmarkElement.style.backgroundColor = ''; }, 3000);
      }
    }, 100);
  };

  function extractRelevantContent(bookmark, question) { const keywords = extractKeywords(question); if (bookmark.summary) { const sentences = bookmark.summary.split(/[。！？.!?]/).filter(s => s.trim()); const relevantSentence = sentences.find(sentence => keywords.some(keyword => sentence.toLowerCase().includes(keyword.toLowerCase()))); if (relevantSentence) return relevantSentence.trim().substring(0, 100) + (relevantSentence.length > 100 ? '...' : ''); } if (bookmark.keyPoints && bookmark.keyPoints.length > 0) { const relevantPoint = bookmark.keyPoints.find(point => keywords.some(keyword => point.toLowerCase().includes(keyword.toLowerCase()))); if (relevantPoint) return relevantPoint.substring(0, 100) + (relevantPoint.length > 100 ? '...' : ''); } return null; }
}
