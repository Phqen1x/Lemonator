import { app, BrowserWindow, ipcMain, globalShortcut } from 'electron'
import path from 'node:path'
import fs from 'node:fs'

let mainWindow: BrowserWindow | null = null

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1280,
    height: 1024,
    minWidth: 900,
    minHeight: 600,
    webPreferences: {
      preload: path.join(__dirname, '../preload/preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      webSecurity: false, // Allow localhost API calls
    },
    title: "Lemonator's",
    backgroundColor: '#0a0a0f',
    frame: false,
    titleBarStyle: 'hidden',
  })

  if (process.env.VITE_DEV_SERVER_URL) {
    mainWindow.loadURL(process.env.VITE_DEV_SERVER_URL)
    mainWindow.webContents.openDevTools()
  } else {
    mainWindow.loadFile(path.join(__dirname, '../../dist/index.html'))
  }

  mainWindow.on('closed', () => {
    mainWindow = null
  })

  // Forward renderer console messages to the terminal so tool-call debug output is visible
  mainWindow.webContents.on('console-message', (_event, level, message, line, sourceId) => {
    const src = sourceId ? `${sourceId.split('/').pop()}:${line}` : ''
    const prefix = src ? `[renderer ${src}]` : '[renderer]'
    switch (level) {
      case 0: console.debug(prefix, message); break   // verbose
      case 1: console.log(prefix, message);   break   // info
      case 2: console.warn(prefix, message);  break   // warning
      case 3: console.error(prefix, message); break   // error
      default: console.log(prefix, message)
    }
  })
}

function toggleDevTools() {
  if (mainWindow?.webContents.isDevToolsOpened()) {
    mainWindow.webContents.closeDevTools()
  } else {
    mainWindow?.webContents.openDevTools()
  }
}

// Window control IPC handlers
ipcMain.on('window-minimize', () => {
  mainWindow?.minimize()
})

ipcMain.on('window-maximize', () => {
  if (mainWindow?.isMaximized()) {
    mainWindow.unmaximize()
  } else {
    mainWindow?.maximize()
  }
})

ipcMain.on('window-close', () => {
  mainWindow?.close()
})

// Character knowledge file handler
ipcMain.handle('load-character-knowledge', async () => {
  try {
    const filePath = path.join(__dirname, '../../dist/character-knowledge.json')
    const data = fs.readFileSync(filePath, 'utf-8')
    return JSON.parse(data)
  } catch (error) {
    console.error('Failed to load character knowledge:', error)
    throw error
  }
})

app.whenReady().then(() => {
  createWindow()

  // globalShortcut works reliably with frameless windows; before-input-event does not
  globalShortcut.register('CommandOrControl+Shift+I', toggleDevTools)
  globalShortcut.register('F12', toggleDevTools)
})

app.on('will-quit', () => {
  globalShortcut.unregisterAll()
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})

app.on('activate', () => {
  if (mainWindow === null) createWindow()
})
