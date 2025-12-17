/**
 * Browser Adapter for Smart Bookmarker Edge Extension
 * Provides cross-browser compatibility and Edge-specific optimizations
 */

// 1. 添加 export 关键字
export class EdgeBrowserAdapter {
    constructor() {
        this.browserType = this.detectBrowser();
        this.isEdge = this.browserType === 'edge';
        this.isChrome = this.browserType === 'chrome';
        this.isSidePanelSupported = this.detectSidePanelSupport();
        this.isOffscreenSupported = this.detectOffscreenSupport();
    }

    detectBrowser() {
        if (typeof browser !== 'undefined') {
            return 'edge'; // Edge with browser namespace
        }
        if (typeof chrome !== 'undefined') {
            const userAgent = navigator.userAgent.toLowerCase();
            if (userAgent.includes('edg/')) {
                return 'edge'; // Edge with chrome namespace
            }
            return 'chrome';
        }
        return 'unknown';
    }

    detectSidePanelSupport() {
        try {
            // Check safely for sidePanel
            const target = this.isEdge ? (typeof browser !== 'undefined' ? browser : chrome) : chrome;
            return target && target.sidePanel !== undefined;
        } catch (e) {
            return false;
        }
    }

    detectOffscreenSupport() {
        try {
            const target = this.isEdge ? (typeof browser !== 'undefined' ? browser : chrome) : chrome;
            return target && target.offscreen !== undefined;
        } catch (e) {
            return false;
        }
    }

    // Helper to get correct browser object
    getBrowser() {
        return this.isEdge && typeof browser !== 'undefined' ? browser : chrome;
    }

    // Storage API Adapter
    async storageLocalGet(keys) {
        return new Promise((resolve, reject) => {
            const storage = this.getBrowser().storage;
            storage.local.get(keys, (result) => {
                const runtime = this.getBrowser().runtime;
                if (runtime.lastError) {
                    reject(new Error(runtime.lastError.message));
                } else {
                    resolve(result);
                }
            });
        });
    }

    async storageLocalSet(items) {
        return new Promise((resolve, reject) => {
            const storage = this.getBrowser().storage;
            storage.local.set(items, () => {
                const runtime = this.getBrowser().runtime;
                if (runtime.lastError) {
                    reject(new Error(runtime.lastError.message));
                } else {
                    resolve();
                }
            });
        });
    }

    async storageSessionGet(keys) {
        return new Promise((resolve, reject) => {
            const storage = this.getBrowser().storage;
            if (!storage.session) {
                // Fallback for browsers without session storage support in older versions
                resolve({}); 
                return;
            }
            storage.session.get(keys, (result) => {
                const runtime = this.getBrowser().runtime;
                if (runtime.lastError) {
                    reject(new Error(runtime.lastError.message));
                } else {
                    resolve(result);
                }
            });
        });
    }

    async storageSessionSet(items) {
        return new Promise((resolve, reject) => {
            const storage = this.getBrowser().storage;
            if (!storage.session) {
                resolve();
                return;
            }
            storage.session.set(items, () => {
                const runtime = this.getBrowser().runtime;
                if (runtime.lastError) {
                    reject(new Error(runtime.lastError.message));
                } else {
                    resolve();
                }
            });
        });
    }

    // Side Panel API Adapter
    async sidePanelSetOptions(options) {
        if (!this.isSidePanelSupported) {
            return this.fallbackSidePanel(options);
        }

        try {
            const sidePanel = this.getBrowser().sidePanel;
            return await sidePanel.setOptions(options);
        } catch (error) {
            console.warn('SidePanel API failed, falling back:', error.message);
            return this.fallbackSidePanel(options);
        }
    }

    async sidePanelOpen(options) {
        if (!this.isSidePanelSupported) {
            return this.fallbackSidePanelOpen(options);
        }

        try {
            const sidePanel = this.getBrowser().sidePanel;
            return await sidePanel.open(options);
        } catch (error) {
            console.warn('SidePanel open failed, falling back:', error.message);
            return this.fallbackSidePanelOpen(options);
        }
    }

    fallbackSidePanel(options) {
        if (options.tabId) {
            return this.getBrowser().tabs.create({
                url: `sidepanel.html?tabId=${options.tabId}`,
                active: false
            });
        }
        return Promise.resolve();
    }

    fallbackSidePanelOpen(options) {
        if (options.tabId) {
            return this.getBrowser().tabs.update(options.tabId, { active: true });
        }
        return Promise.resolve();
    }

    // Offscreen Document API Adapter
    async offscreenCreateDocument(options) {
        if (!this.isOffscreenSupported) {
            return this.fallbackOffscreen(options);
        }

        try {
            const offscreen = this.getBrowser().offscreen;
            return await offscreen.createDocument(options);
        } catch (error) {
            console.warn('Offscreen API failed, falling back:', error.message);
            return this.fallbackOffscreen(options);
        }
    }

    async offscreenHasDocument() {
        if (!this.isOffscreenSupported) {
            return this.fallbackOffscreenCheck();
        }

        try {
            const offscreen = this.getBrowser().offscreen;
            return await offscreen.hasDocument();
        } catch (error) {
            console.warn('Offscreen check failed, falling back:', error.message);
            return this.fallbackOffscreenCheck();
        }
    }

    fallbackOffscreen(options) {
        console.log('Using Service Worker for HTML parsing (Edge fallback)');
        return Promise.resolve();
    }

    fallbackOffscreenCheck() {
        return Promise.resolve(false);
    }

    // Tabs API Adapter
    async tabsCreate(options) {
        return new Promise((resolve, reject) => {
            const tabs = this.getBrowser().tabs;
            tabs.create(options, (tab) => {
                const runtime = this.getBrowser().runtime;
                if (runtime.lastError) {
                    reject(new Error(runtime.lastError.message));
                } else {
                    resolve(tab);
                }
            });
        });
    }

    async tabsQuery(query) {
        return new Promise((resolve, reject) => {
            const tabs = this.getBrowser().tabs;
            tabs.query(query, (tabs) => {
                const runtime = this.getBrowser().runtime;
                if (runtime.lastError) {
                    reject(new Error(runtime.lastError.message));
                } else {
                    resolve(tabs);
                }
            });
        });
    }

    async tabsUpdate(tabId, updateProperties) {
        return new Promise((resolve, reject) => {
            const tabs = this.getBrowser().tabs;
            tabs.update(tabId, updateProperties, (tab) => {
                const runtime = this.getBrowser().runtime;
                if (runtime.lastError) {
                    reject(new Error(runtime.lastError.message));
                } else {
                    resolve(tab);
                }
            });
        });
    }

    // Scripting API Adapter
    async scriptingExecuteScript(options) {
        try {
            const scripting = this.getBrowser().scripting;
            return await scripting.executeScript(options);
        } catch (error) {
            console.error('Script execution failed:', error);
            throw error;
        }
    }

    async scriptingInsertCSS(options) {
        try {
            const scripting = this.getBrowser().scripting;
            return await scripting.insertCSS(options);
        } catch (error) {
            console.error('CSS injection failed:', error);
            throw error;
        }
    }

    // Runtime API Adapter
    runtimeGetURL(path) {
        return this.getBrowser().runtime.getURL(path);
    }

    runtimeSendMessage(message) {
        return new Promise((resolve, reject) => {
            const runtime = this.getBrowser().runtime;
            runtime.sendMessage(message, (response) => {
                if (runtime.lastError) {
                    reject(new Error(runtime.lastError.message));
                } else {
                    resolve(response);
                }
            });
        });
    }

    // Edge-specific optimizations
    enableEdgeOptimizations() {
        if (!this.isEdge) return;
        console.log('Enabling Edge-specific optimizations...');
        this.enableEdgePerformanceOptimizations();
        this.enableEdgeUIOptimizations();
        this.enableEdgeIntegration();
    }

    enableEdgePerformanceOptimizations() {
        // Removed 'window' check as it doesn't exist in SW
        if (typeof self !== 'undefined') {
           // SW specific optimizations if needed
        }
    }

    enableEdgeUIOptimizations() {
        console.log('Applying Edge UI optimizations...');
    }

    enableEdgeIntegration() {
        console.log('Enabling Windows/Edge integration features...');
    }

    handleAPIError(error, context = '') {
        // ... (保持不变，省略以节省空间) ...
        // 如果你需要这个函数，请保留原来的逻辑，
        // 但注意不要依赖 window 或 dom
        return {
            error: true,
            message: error.message || 'Unknown error',
            context: context
        };
    }

    getBrowserInfo() {
        return {
            type: this.browserType,
            isEdge: this.isEdge,
            isChrome: this.isChrome,
            supportsSidePanel: this.isSidePanelSupported,
            supportsOffscreen: this.isOffscreenSupported,
            userAgent: navigator.userAgent
        };
    }
}

// 2. 移除原文件末尾所有的 window 赋值和 module.exports
// Service Worker 中没有 window，直接实例化并挂载到 self 或 window 会导致报错。
// 我们将在 background-main.js 中通过 import 来实例化它。