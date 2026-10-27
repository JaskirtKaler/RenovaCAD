import { app, BrowserWindow, Menu } from 'electron'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const currentDirectory = dirname(fileURLToPath(import.meta.url))

function createWindow(): void {
  const window = new BrowserWindow({
    title: 'RenovaCAD',
    width: 1530,
    height: 960,
    minWidth: 1080,
    minHeight: 720,
    backgroundColor: '#0e1112',
    titleBarStyle: 'hiddenInset',
    trafficLightPosition: { x: 18, y: 26 },
    show: false,
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  })

  window.once('ready-to-show', () => window.show())
  window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }))
  window.webContents.on('will-navigate', (event) => event.preventDefault())

  const rendererUrl = process.env.ELECTRON_RENDERER_URL
  if (rendererUrl && !app.isPackaged) {
    void window.loadURL(rendererUrl)
  } else {
    void window.loadFile(join(currentDirectory, '../renderer/index.html'))
  }
}

app.setName('RenovaCAD')

void app.whenReady().then(() => {
  Menu.setApplicationMenu(
    Menu.buildFromTemplate([
      { role: 'appMenu' },
      { role: 'editMenu' },
      { role: 'viewMenu' },
      { role: 'windowMenu' },
    ]),
  )
  createWindow()
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})
