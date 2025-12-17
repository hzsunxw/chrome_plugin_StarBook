// 国际化支持
document.addEventListener('DOMContentLoaded', async function() {
  await loadI18nMessages();
  applyI18nMessages();
  
  loadStarredBookmarks();
});

// 加载标星书签
async function loadStarredBookmarks() {
  const container = document.getElementById('bookmarks-container');
  
  try {
    // 首先检查是否在新标签页显示标星书签
    const settings = await chrome.storage.local.get('showStarredInNewtab');
    const showStarredInNewtab = settings.showStarredInNewtab !== false; // 默认为 true
    
    if (!showStarredInNewtab) {
      container.innerHTML = `
        <div class="empty-state">
          <h3 data-i18n="starredBookmarksHidden">标星书签已隐藏</h3>
          <p data-i18n="starredBookmarksHiddenDesc">您已在设置中关闭了"在新标签页显示标星书签"选项</p>
        </div>
      `;
      applyI18nMessages();
      return;
    }
    
    // 尝试从本地存储获取书签数据
    const result = await chrome.storage.local.get('bookmarkItems');
    const bookmarks = result.bookmarkItems || [];
    
    // 过滤出标星书签
    const starredBookmarks = bookmarks.filter(bookmark =>
      bookmark.type === 'bookmark' && bookmark.isStarred === true
    );

    // 按点击次数降序排序
    const sortedBookmarks = starredBookmarks.sort((a, b) => {
      const aCount = a.clickCount || 0;
      const bCount = b.clickCount || 0;
      return bCount - aCount;
    });
    
    if (starredBookmarks.length === 0) {
      container.innerHTML = `
        <div class="empty-state">
          <h3 data-i18n="noStarredBookmarks">暂无标星书签</h3>
          <p data-i18n="noStarredBookmarksDesc">您还没有将任何书签标记为星标</p>
        </div>
      `;
      applyI18nMessages();
      return;
    }
    
    // 渲染书签列表
    container.innerHTML = `
      <div class="bookmarks-grid">
        ${sortedBookmarks.map(bookmark => `
          <div class="bookmark-card" data-url="${escapeHtml(bookmark.url)}">
            <div class="bookmark-header">
              <img class="favicon" src="https://www.google.com/s2/favicons?domain=${new URL(bookmark.url).hostname}&sz=16" alt="Favicon">
              <h3 class="bookmark-title">${escapeHtml(bookmark.title || '无标题')}</h3>
              ${bookmark.clickCount ? `<span class="click-count">${bookmark.clickCount} 次点击</span>` : ''}
            </div>
            <div class="bookmark-url">${escapeHtml(bookmark.url)}</div>
            ${bookmark.summary ? `<div class="bookmark-summary">${escapeHtml(bookmark.summary)}</div>` : ''}
            <div class="bookmark-meta">
              ${bookmark.dateAdded ? `<span>${formatDate(bookmark.dateAdded)}</span>` : ''}
            </div>
          </div>
        `).join('')}
      </div>
    `;
    
    // 添加点击事件监听器
    addBookmarkClickListeners();
    
  } catch (error) {
    console.error('加载标星书签失败:', error);
    container.innerHTML = `
      <div class="error-state">
        <h3 data-i18n="loadError">加载失败</h3>
        <p data-i18n="loadErrorDesc">无法加载书签数据，请检查扩展设置</p>
      </div>
    `;
    applyI18nMessages();
  }
}

// HTML转义函数
function escapeHtml(text) {
  const div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
}

// 日期格式化函数
function formatDate(dateString) {
  const date = new Date(dateString);
  return date.toLocaleDateString();
}

// 国际化函数
async function loadI18nMessages() {
  const lang = navigator.language.startsWith('zh') ? 'zh_CN' : 'en';
  const url = chrome.runtime.getURL(`_locales/${lang}/messages.json`);
  
  try {
    const response = await fetch(url);
    window.i18nMessages = await response.json();
  } catch (error) {
    console.error('加载国际化消息失败:', error);
    window.i18nMessages = {};
  }
}

function applyI18nMessages() {
  document.querySelectorAll('[data-i18n]').forEach(element => {
    const key = element.getAttribute('data-i18n');
    const message = window.i18nMessages[key]?.message || key;
    element.textContent = message;
  });
  
  document.querySelectorAll('[data-i18n-placeholder]').forEach(element => {
    const key = element.getAttribute('data-i18n-placeholder');
    const message = window.i18nMessages[key]?.message || key;
    element.setAttribute('placeholder', message);
  });
  
  document.querySelectorAll('[data-i18n-title]').forEach(element => {
    const key = element.getAttribute('data-i18n-title');
    const message = window.i18nMessages[key]?.message || key;
    element.setAttribute('title', message);
  });
}

// 添加书签点击事件监听器
function addBookmarkClickListeners() {
  const bookmarkCards = document.querySelectorAll('.bookmark-card');

  bookmarkCards.forEach(card => {
    card.addEventListener('click', function(event) {
      // 防止事件冒泡到其他可能的事件处理程序
      event.stopPropagation();

      const url = card.getAttribute('data-url');
      if (url) {
        // 使用setTimeout延迟消息发送，确保页面跳转优先执行
        setTimeout(() => {
          chrome.runtime.sendMessage({
            action: 'updateBookmarkClickCount',
            url: url
          }).catch(error => {
            console.warn('更新点击计数失败:', error);
          });
        }, 0);

        // 立即在当前标签页中打开URL
        window.location.href = url;
      }
    });

    // 添加键盘支持（可选的辅助功能改进）
    card.addEventListener('keydown', function(event) {
      if (event.key === 'Enter' || event.key === ' ') {
        event.preventDefault();
        const url = card.getAttribute('data-url');
        if (url) {
          // 使用setTimeout延迟消息发送，确保页面跳转优先执行
          setTimeout(() => {
            chrome.runtime.sendMessage({
              action: 'updateBookmarkClickCount',
              url: url
            }).catch(error => {
              console.warn('更新点击计数失败:', error);
            });
          }, 0);

          // 立即跳转页面
          window.location.href = url;
        }
      }
    });

    // 添加适当的ARIA角色和tabindex以支持键盘导航
    card.setAttribute('role', 'button');
    card.setAttribute('tabindex', '0');
  });
}
