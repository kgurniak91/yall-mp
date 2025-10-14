const {contextBridge, ipcRenderer} = require('electron');

contextBridge.exposeInMainWorld('lookupAPI', {});

// Right-Click Context Menu
document.addEventListener('contextmenu', (e) => {
  e.preventDefault();
  const selectedText = window.getSelection().toString().trim();
  if (selectedText) {
    ipcRenderer.send('lookup:show-context-menu', selectedText);
  }
});

// Keyboard Shortcut listener for events within the loaded website
document.addEventListener('keydown', (e) => {
  // Handle Ctrl+Shift+S for adding notes
  if (e.ctrlKey && e.shiftKey && e.key === 'S') {
    e.preventDefault();
    const selectedText = window.getSelection().toString().trim();
    if (selectedText) {
      ipcRenderer.send('lookup:add-note', {text: selectedText});
    }
  }

  // Handle Escape key to close the lookup window
  if (e.key === 'Escape') {
    e.preventDefault();
    ipcRenderer.send('lookup:close-window');
  }
});
