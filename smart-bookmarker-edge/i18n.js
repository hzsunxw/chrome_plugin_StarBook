class I18nManager {
  constructor() {
    this.messages = {};
  }

  async loadMessages(lang) {
    try {
      const response = await fetch(chrome.runtime.getURL(`_locales/${lang}/messages.json`));
      if (!response.ok) {
        throw new Error(`Could not load messages for lang: ${lang}`);
      }
      this.messages = await response.json();
    } catch (error) {
      console.warn(error);
      // Fallback to English if the desired language file fails to load for any reason
      if (lang !== 'en') {
        console.warn('Falling back to English.');
        await this.loadMessages('en');
      }
    }
  }

  get(key, substitutions) {
    let message = this.messages[key]?.message || key;
    if (substitutions) {
      for (const [subKey, subValue] of Object.entries(substitutions)) {
        message = message.replace(`\${${subKey}}`, subValue);
      }
    }
    return message;
  }

  applyToDOM() {
    document.querySelectorAll('[data-i18n]').forEach(el => {
      el.textContent = this.get(el.dataset.i18n);
    });
    document.querySelectorAll('[data-i18n-placeholder]').forEach(el => {
      el.placeholder = this.get(el.dataset.i18nPlaceholder);
    });
    document.querySelectorAll('[data-i18n-title]').forEach(el => {
      el.title = this.get(el.dataset.i18nTitle);
    });
    
    // Set main page title if a data-i18n-title attribute exists on the <html> tag
    const pageTitleKey = document.documentElement.dataset.i18nTitle;
    if (pageTitleKey) {
        document.title = this.get(pageTitleKey);
    }
  }
}