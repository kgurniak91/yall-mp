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

// Keyboard Shortcut (Ctrl+Shift+S)
document.addEventListener('keydown', (e) => {
  if (e.ctrlKey && e.shiftKey && e.key === 'S') {
    e.preventDefault();
    const selectedText = window.getSelection().toString().trim();
    if (selectedText) {
      ipcRenderer.send('lookup:add-note', {text: selectedText});
    }
  }
});
