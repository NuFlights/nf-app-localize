'use strict';

// Open side panel when the extension icon is clicked
chrome.sidePanel
  .setPanelBehavior({ openPanelOnActionClick: true })
  .catch(console.error);

chrome.runtime.onInstalled.addListener(() => {
  chrome.sidePanel
    .setPanelBehavior({ openPanelOnActionClick: true })
    .catch(console.error);

  // Default settings
  chrome.storage.local.get(['highlightEnabled'], (data) => {
    if (data.highlightEnabled === undefined) {
      chrome.storage.local.set({ highlightEnabled: true });
    }
  });
});

// Forward highlight toggle from side panel to the active tab's content script
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.type === 'SET_HIGHLIGHT_ACTIVE_TAB') {
    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
      if (tabs[0]) {
        chrome.tabs.sendMessage(tabs[0].id, {
          type: 'SET_HIGHLIGHT',
          enabled: message.enabled,
        }).catch(() => {});
      }
    });
  }
  return false;
});
