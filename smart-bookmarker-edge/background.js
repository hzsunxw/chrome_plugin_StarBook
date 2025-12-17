// Edge Service Worker - Background Script
// This file handles Edge-specific Service Worker initialization and message routing

// Import browser adapter for Edge compatibility
importScripts('browser-adapter.js');

// Edge Service Worker entry point
try {
  // Check if this is running in Edge Service Worker context
  if (typeof chrome !== 'undefined' && chrome.runtime.getManifest) {
    console.log('Edge Service Worker initialized successfully');

    // Import main background script functionality
    importScripts('background-main.js');
  }
} catch (error) {
  console.error('Failed to initialize Edge Service Worker:', error);
}