const { app, BrowserWindow, ipcMain } = require('electron');
const path = require('path');

let mainWindow;
let settingsWindow;

function createMainWindow() {
  mainWindow = new BrowserWindow({
    width: 1000,
    height: 700,
    webPreferences: {
      nodeIntegration: true,
      contextIsolation: false
    }
  });

  mainWindow.loadFile('index.html');
  
  // Open settings window from menu (optional)
  const mainMenu = Menu.buildFromTemplate(menuTemplate);
  Menu.setApplicationMenu(mainMenu);
}

function createSettingsWindow() {
  settingsWindow = new BrowserWindow({
    width: 600,
    height: 400,
    parent: mainWindow, // Make it modal
    webPreferences: {
      nodeIntegration: true,
      contextIsolation: false
    }
  });

  settingsWindow.loadFile('src/windows/settings.html');
  
  settingsWindow.on('closed', () => {
    settingsWindow = null;
  });
}

// Menu template (optional)
const menuTemplate = [
  {
    label: 'File',
    submenu: [
      {
        label: 'Settings',
        click() {
          createSettingsWindow();
        }
      },
      {
        label: 'Exit',
        click() {
          app.quit();
        }
      }
    ]
  }
];

app.whenReady().then(createMainWindow);

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) {
    createMainWindow();
  }
});

// Listen for IPC messages from renderer
ipcMain.on('open-settings', () => {
  createSettingsWindow();
});