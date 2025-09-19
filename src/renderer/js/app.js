const { ipcRenderer } = require('electron');

document.getElementById('mainButton').addEventListener('click', () => {
  document.getElementById('message').textContent = 'Hello, World!';
});

document.getElementById('settingsButton').addEventListener('click', () => {
  // Send message to main process to open settings window
  ipcRenderer.send('open-settings');
});