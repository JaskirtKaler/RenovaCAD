import { app, BrowserWindow, dialog, Menu, ipcMain } from 'electron'
import { randomBytes } from 'node:crypto'
import { spawn, type ChildProcess } from 'node:child_process'
import { dirname, join, resolve, basename, extname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createServer } from 'node:net'
import { existsSync, readFileSync } from 'node:fs'
import { readFile, writeFile, rename, unlink } from 'node:fs/promises'

const currentDirectory = dirname(fileURLToPath(import.meta.url))

type GoStatus = { ready: boolean; address: string | null; error: string | null }

let apiToken: string | null = null
let apiAddr: string | null = null
let goProcess: ChildProcess | null = null
let goError: string | null = null
let goReady = false
let isDirty = false

function loadDotEnv(path: string): void {
  if (!existsSync(path)) return
  try {
    const content = readFileSync(path, 'utf8')
    for (const rawLine of content.split('\n')) {
      const line = rawLine.trim()
      if (!line || line.startsWith('#')) continue
      const cleaned = line.startsWith('export ') ? line.slice(7).trim() : line
      const eq = cleaned.indexOf('=')
      if (eq <= 0) continue
      const key = cleaned.slice(0, eq).trim()
      let val = cleaned.slice(eq + 1).trim()
      if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) val = val.slice(1, -1)
      if (!process.env[key]) process.env[key] = val
    }
  } catch { /* ignore */ }
}

function resolveGoEnvFile(): string | null {
  const candidates = [
    resolve(process.cwd(), 'services/api/.env'),
    resolve(currentDirectory, '../../services/api/.env'),
    resolve(currentDirectory, '../services/api/.env'),
  ]
  for (const p of candidates) if (existsSync(p)) return p
  return null
}

function allocatePort(): Promise<number> {
  return new Promise((resolvePort, reject) => {
    const srv = createServer()
    srv.listen(0, '127.0.0.1', () => {
      const addr = srv.address()
      if (addr && typeof addr === 'object') {
        const port = addr.port
        srv.close(() => resolvePort(port))
      } else reject(new Error('failed to allocate port'))
    })
    srv.on('error', reject)
  })
}

function waitForHealth(addr: string, token: string, timeoutMs = 6000): Promise<boolean> {
  const start = Date.now()
  return new Promise((resolveDone) => {
    const attempt = async () => {
      try {
        const headers: Record<string, string> = {}
        if (token) headers['Authorization'] = `Bearer ${token}`
        const res = await fetch(`http://${addr}/health`, { headers, signal: AbortSignal.timeout(1000) } as RequestInit)
        if (res.ok) return resolveDone(true)
      } catch { /* retry */ }
      if (Date.now() - start > timeoutMs) return resolveDone(false)
      setTimeout(attempt, 250)
    }
    attempt()
  })
}

async function startGoService(): Promise<void> {
  // Load .env if present so BASETEN_API_KEY can live in services/api/.env without manual export.
  const envFile = resolveGoEnvFile()
  if (envFile) loadDotEnv(envFile)

  apiToken = randomBytes(32).toString('base64url')
  const port = await allocatePort()
  apiAddr = `127.0.0.1:${port}`

  // Determine how to start Go: prefer built binary beside app, else `go run`.
  const isPackaged = app.isPackaged
  const env: NodeJS.ProcessEnv = {
    ...process.env,
    RENOVACAD_API_ADDR: apiAddr,
    RENOVACAD_API_TOKEN: apiToken,
  }

  const trySpawn = (cmd: string, args: string[], cwd?: string) => {
    const child = spawn(cmd, args, { env, cwd, stdio: ['ignore', 'pipe', 'pipe'] })
    goProcess = child
    child.stdout?.on('data', (d: Buffer) => console.log(`[go] ${d.toString().trim()}`))
    child.stderr?.on('data', (d: Buffer) => console.error(`[go] ${d.toString().trim()}`))
    child.on('error', (err) => { goError = err.message; console.error('[go] spawn error', err) })
    child.on('exit', (code, signal) => {
      if (!goReady) goError = `Go service exited (${code ?? signal}) before ready`
      console.log(`[go] exit code=${code} signal=${signal}`)
    })
    return child
  }

  let child: ChildProcess | null = null
  if (isPackaged) {
    // In packaged app, expect a bundled binary at resourcesPath/renovacad-api
    const bundled = join(process.resourcesPath, 'renovacad-api')
    if (existsSync(bundled)) {
      child = trySpawn(bundled, [])
    } else {
      goError = `Bundled Go binary not found at ${bundled}. Build it with: go build -o ${bundled} ./services/api/cmd/server`
      console.error(goError)
      return
    }
  } else {
    // Dev: use `go run`. Resolve cwd to repo root.
    const repoRoot = resolve(currentDirectory, '..')
    // Check if go is available
    child = trySpawn('go', ['run', './services/api/cmd/server'], repoRoot)
    // If spawn fails synchronously with ENOENT, fallback handled via error event.
  }

  if (!child) return

  const healthy = await waitForHealth(apiAddr!, apiToken!, 8000)
  if (healthy) {
    goReady = true
    goError = null
    console.log(`[go] ready at ${apiAddr}`)
  } else {
    goError = `Go service did not become healthy at ${apiAddr} (check BASETEN_API_KEY and port availability)`
    console.error(goError)
    // Keep process running; health may recover, but mark error.
  }
}

function stopGoService(): void {
  if (goProcess && !goProcess.killed) {
    try { goProcess.kill('SIGTERM') } catch { /* ignore */ }
    // Force kill if still alive after grace period
    setTimeout(() => { try { if (goProcess && !goProcess.killed) goProcess.kill('SIGKILL') } catch {} }, 2000)
  }
  goProcess = null
}

function createWindow(): void {
  const preloadPath = join(currentDirectory, '../preload/preload.js')
  // Fallback for dev when built to out/main: preload may be at ./preload or ../preload
  const candidates = [preloadPath, join(currentDirectory, 'preload.js'), join(currentDirectory, '../preload/index.js')]
  let resolvedPreload: string | undefined
  for (const c of candidates) if (existsSync(c)) { resolvedPreload = c; break }
  if (!resolvedPreload && existsSync(preloadPath)) resolvedPreload = preloadPath
  // In dev with electron-vite, preload is built to out/preload; try that.
  if (!resolvedPreload) {
    const devPreload = resolve(currentDirectory, '../preload/preload.js')
    if (existsSync(devPreload)) resolvedPreload = devPreload
  }

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
      preload: resolvedPreload,
    },
  })

  window.once('ready-to-show', () => window.show())
  window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }))
  window.webContents.on('will-navigate', (event) => event.preventDefault())

  // Warn before closing window with unsaved changes — renderer also handles beforeunload, this is a second native guard for quit via menu/close button.
  window.on('close', async (event) => {
    if (!isDirty) return
    // We must prevent default and ask renderer + native dialog; but we need async flow.
    // Use a synchronous flag to avoid infinite recursion.
    const win = window
    if ((win as unknown as { _confirmedClose?: boolean })._confirmedClose) return
    event.preventDefault()
    const choice = await dialog.showMessageBox(win, {
      type: 'warning',
      buttons: ['Cancel', 'Discard Changes', 'Save'],
      defaultId: 0,
      cancelId: 0,
      message: 'You have unsaved changes. Save before quitting?',
      detail: 'Your changes will be lost if you close without saving.',
    })
    if (choice.response === 0) return // Cancel
    if (choice.response === 2) {
      // Save — ask renderer to save (it will call project:save)
      win.webContents.send('project:request-save-before-quit')
      // Give renderer 30s to save and then close; renderer will signal via project:confirm-close
      return
    }
    // Discard
    ;(win as unknown as { _confirmedClose: boolean })._confirmedClose = true
    win.close()
  })

  const rendererUrl = process.env.ELECTRON_RENDERER_URL
  if (rendererUrl && !app.isPackaged) {
    void window.loadURL(rendererUrl)
  } else {
    void window.loadFile(join(currentDirectory, '../renderer/index.html'))
  }
}

app.setName('RenovaCAD')

// IPC: narrow bridge — renderer sends only instruction/scene or photo, main attaches token and forwards to loopback Go service.
ipcMain.handle('ai:propose-edit', async (_event, payload: unknown): Promise<unknown> => {
  if (!apiAddr) {
    return { kind: 'error', code: 'service_unavailable', message: goError ?? 'AI service is not running. Start the Go backend or check services/api/.env for BASETEN_API_KEY.' , httpStatus: 503 }
  }
  // Validate payload shape minimally; Go service is authoritative validator.
  if (!payload || typeof payload !== 'object') {
    return { kind: 'error', code: 'invalid_request', message: 'Invalid request shape.', httpStatus: 400 }
  }
  try {
    const headers: Record<string, string> = { 'Content-Type': 'application/json' }
    if (apiToken) headers['Authorization'] = `Bearer ${apiToken}`
    // Origin check: forward narrowly defined POST only.
    const res = await fetch(`http://${apiAddr}/api/ai/propose-edit`, {
      method: 'POST',
      headers,
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(16000),
    } as RequestInit)
    const text = await res.text()
    let body: unknown
    try { body = JSON.parse(text) } catch { body = { error: { code: res.ok ? 'invalid_provider_response' : 'provider_error', message: text.slice(0, 600) } } }
    if (!res.ok) {
      const err = body as { error?: { code?: string; message?: string } }
      const code = err?.error?.code ?? (res.status === 401 ? 'unauthorized' : res.status === 504 ? 'provider_timeout' : 'provider_error')
      const msg = err?.error?.message ?? `Request failed (${res.status})`
      // Never leak token or Baseten key; message already sanitized by Go service.
      return { kind: 'error', code, message: msg, httpStatus: res.status }
    }
    // Success: either proposal or clarification — pass through without exposing secrets.
    const ok = body as { kind?: string }
    if (ok.kind === 'proposal' || ok.kind === 'clarification') return body
    return { kind: 'error', code: 'invalid_provider_response', message: 'Unexpected response from AI service.', httpStatus: 502 }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    if (msg.includes('timeout') || msg.includes('Abort')) {
      return { kind: 'error', code: 'provider_timeout', message: 'AI request timed out. Try again.', httpStatus: 504 }
    }
    if (msg.includes('ECONNREFUSED') || msg.includes('fetch failed')) {
      return { kind: 'error', code: 'service_unavailable', message: goError ?? 'AI service is unreachable. Check that the Go backend is running on ' + apiAddr, httpStatus: 503 }
    }
    return { kind: 'error', code: 'provider_error', message: 'AI request failed. Try again.', httpStatus: 502 }
  }
})

ipcMain.handle('ai:status', async (): Promise<GoStatus> => {
  return { ready: goReady && !!apiAddr, address: apiAddr, error: goError }
})

ipcMain.handle('ai:analyze-photo', async (_event, payload: unknown): Promise<unknown> => {
  if (!apiAddr) {
    return { kind: 'error', code: 'service_unavailable', message: goError ?? 'AI service is not running. Start the Go backend or check services/api/.env for BASETEN_API_KEY.', httpStatus: 503 }
  }
  if (!payload || typeof payload !== 'object') {
    return { kind: 'error', code: 'invalid_request', message: 'Invalid request shape.', httpStatus: 400 }
  }
  // Basic validation: must contain image with dataUrl
  const p = payload as { image?: { mimeType?: string; dataUrl?: string } }
  if (!p.image || typeof p.image.dataUrl !== 'string' || !p.image.dataUrl.startsWith('data:image')) {
    return { kind: 'error', code: 'invalid_request', message: 'Image is required (JPG, PNG, or WEBP).', httpStatus: 400 }
  }
  if (p.image.dataUrl.length > 8 * 1024 * 1024) {
    return { kind: 'error', code: 'invalid_request', message: 'Image too large (limit 5 MB).', httpStatus: 400 }
  }
  try {
    const headers: Record<string, string> = { 'Content-Type': 'application/json' }
    if (apiToken) headers['Authorization'] = `Bearer ${apiToken}`
    const res = await fetch(`http://${apiAddr}/api/ai/analyze-photo`, {
      method: 'POST',
      headers,
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(22000),
    } as RequestInit)
    const text = await res.text()
    let body: unknown
    try { body = JSON.parse(text) } catch { body = { error: { code: res.ok ? 'invalid_provider_response' : 'provider_error', message: text.slice(0, 600) } } }
    if (!res.ok) {
      const err = body as { error?: { code?: string; message?: string } }
      const code = err?.error?.code ?? (res.status === 401 ? 'unauthorized' : res.status === 504 ? 'provider_timeout' : 'provider_error')
      const msg = err?.error?.message ?? `Request failed (${res.status})`
      return { kind: 'error', code, message: msg, httpStatus: res.status }
    }
    const ok = body as { kind?: string }
    if (ok.kind === 'analysis') return body
    return { kind: 'error', code: 'invalid_provider_response', message: 'Unexpected response from AI service.', httpStatus: 502 }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    if (msg.includes('timeout') || msg.includes('Abort')) {
      return { kind: 'error', code: 'provider_timeout', message: 'AI request timed out. Try again.', httpStatus: 504 }
    }
    if (msg.includes('ECONNREFUSED') || msg.includes('fetch failed')) {
      return { kind: 'error', code: 'service_unavailable', message: goError ?? 'AI service is unreachable. Check that the Go backend is running on ' + apiAddr, httpStatus: 503 }
    }
    return { kind: 'error', code: 'provider_error', message: 'AI request failed. Try again.', httpStatus: 502 }
  }
})

ipcMain.handle('ai:propose-layout', async (_event, payload: unknown): Promise<unknown> => {
  if (!apiAddr) {
    return { kind: 'error', code: 'service_unavailable', message: goError ?? 'AI service is not running. Start the Go backend or check services/api/.env for BASETEN_API_KEY.', httpStatus: 503 }
  }
  if (!payload || typeof payload !== 'object') {
    return { kind: 'error', code: 'invalid_request', message: 'Invalid request shape.', httpStatus: 400 }
  }
  const p = payload as { image?: { mimeType?: string; dataUrl?: string } }
  if (!p.image || typeof p.image.dataUrl !== 'string' || !p.image.dataUrl.startsWith('data:image')) {
    return { kind: 'error', code: 'invalid_request', message: 'Image is required (JPG, PNG, or WEBP).', httpStatus: 400 }
  }
  if (p.image.dataUrl.length > 8 * 1024 * 1024) {
    return { kind: 'error', code: 'invalid_request', message: 'Image too large (limit 5 MB).', httpStatus: 400 }
  }
  try {
    const headers: Record<string, string> = { 'Content-Type': 'application/json' }
    if (apiToken) headers['Authorization'] = `Bearer ${apiToken}`
    const res = await fetch(`http://${apiAddr}/api/ai/propose-layout`, {
      method: 'POST',
      headers,
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(24000),
    } as RequestInit)
    const text = await res.text()
    let body: unknown
    try { body = JSON.parse(text) } catch { body = { error: { code: res.ok ? 'invalid_provider_response' : 'provider_error', message: text.slice(0, 600) } } }
    if (!res.ok) {
      const err = body as { error?: { code?: string; message?: string } }
      const code = err?.error?.code ?? (res.status === 401 ? 'unauthorized' : res.status === 504 ? 'provider_timeout' : 'provider_error')
      const msg = err?.error?.message ?? `Request failed (${res.status})`
      return { kind: 'error', code, message: msg, httpStatus: res.status }
    }
    const ok = body as { kind?: string }
    if (ok.kind === 'layout_draft' || ok.kind === 'needs_info') return body
    return { kind: 'error', code: 'invalid_provider_response', message: 'Unexpected response from AI service.', httpStatus: 502 }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    if (msg.includes('timeout') || msg.includes('Abort')) {
      return { kind: 'error', code: 'provider_timeout', message: 'AI request timed out. Try again.', httpStatus: 504 }
    }
    if (msg.includes('ECONNREFUSED') || msg.includes('fetch failed')) {
      return { kind: 'error', code: 'service_unavailable', message: goError ?? 'AI service is unreachable. Check that the Go backend is running on ' + apiAddr, httpStatus: 503 }
    }
    return { kind: 'error', code: 'provider_error', message: 'AI request failed. Try again.', httpStatus: 502 }
  }
})

// Project persistence: narrow native dialogs + safe file access
const PROJECT_FILTERS = [{ name: 'RenovaCAD Project', extensions: ['renovacad'] }]

ipcMain.handle('project:set-dirty', async (_event, dirty: unknown) => {
  isDirty = !!dirty
  const wins = BrowserWindow.getAllWindows()
  for (const w of wins) {
    w.setDocumentEdited(!!dirty)
  }
  return { ok: true }
})

ipcMain.handle('project:confirm-close', async () => {
  const wins = BrowserWindow.getAllWindows()
  for (const w of wins) {
    ;(w as unknown as { _confirmedClose: boolean })._confirmedClose = true
    w.close()
  }
  return { ok: true }
})

ipcMain.handle('project:confirm-unsaved', async (_event, message?: string): Promise<{ choice: 'save' | 'discard' | 'cancel' }> => {
  const win = BrowserWindow.getFocusedWindow() ?? BrowserWindow.getAllWindows()[0]
  const res = await dialog.showMessageBox(win ?? undefined as unknown as BrowserWindow, {
    type: 'warning',
    buttons: ['Cancel', 'Discard Changes', 'Save'],
    defaultId: 0,
    cancelId: 0,
    message: message ?? 'You have unsaved changes. Save before continuing?',
    detail: 'Your changes will be lost if you continue without saving.',
  })
  if (res.response === 1) return { choice: 'discard' }
  if (res.response === 2) return { choice: 'save' }
  return { choice: 'cancel' }
})

ipcMain.handle('project:open', async (): Promise<{ canceled: boolean; filePath?: string; content?: string; error?: string }> => {
  const win = BrowserWindow.getFocusedWindow() ?? BrowserWindow.getAllWindows()[0]
  const res = await dialog.showOpenDialog(win ?? undefined as unknown as BrowserWindow, {
    title: 'Open RenovaCAD Project',
    filters: PROJECT_FILTERS,
    properties: ['openFile'],
  })
  if (res.canceled || !res.filePaths[0]) return { canceled: true }
  const filePath = res.filePaths[0]
  try {
    // Basic size check before reading
    const content = await readFile(filePath, 'utf8')
    if (content.length > 12 * 1024 * 1024) return { canceled: false, error: 'Project file too large (limit 12 MB)' }
    return { canceled: false, filePath, content }
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    return { canceled: false, error: `Failed to read project: ${msg}` }
  }
})

ipcMain.handle('project:save', async (_event, payload: unknown): Promise<{ canceled: boolean; filePath?: string; error?: string }> => {
  const data = payload as { filePath?: string | null; content: string; defaultName?: string }
  if (!data || typeof data.content !== 'string') return { canceled: false, error: 'Invalid save payload' }
  if (data.content.length > 12 * 1024 * 1024) return { canceled: false, error: 'Project is too large to save (limit 12 MB). Try a smaller reference photo.' }
  let filePath = data.filePath ?? null
  if (!filePath) {
    const win = BrowserWindow.getFocusedWindow() ?? BrowserWindow.getAllWindows()[0]
    const res = await dialog.showSaveDialog(win ?? undefined as unknown as BrowserWindow, {
      title: 'Save RenovaCAD Project',
      filters: PROJECT_FILTERS,
      defaultPath: (data.defaultName ?? 'Kitchen Remodel') + '.renovacad',
    })
    if (res.canceled || !res.filePath) return { canceled: true }
    filePath = res.filePath
    if (!filePath.endsWith('.renovacad')) filePath += '.renovacad'
  }
  // Safe atomic write: temp file then rename
  const dir = filePath.slice(0, filePath.lastIndexOf('/')) || '.'
  const base = basename(filePath)
  const tempPath = join(dirname(filePath), `.${base}.tmp-${randomBytes(4).toString('hex')}`)
  try {
    await writeFile(tempPath, data.content, 'utf8')
    await rename(tempPath, filePath)
    // On non-POSIX, rename is atomic if same directory; we already ensured same dir.
    return { canceled: false, filePath }
  } catch (e) {
    try { await unlink(tempPath) } catch {}
    const msg = e instanceof Error ? e.message : String(e)
    // Explain any platform limitations: atomic rename may not be atomic on all filesystems, but preserves original on failure.
    return { canceled: false, error: `Failed to save project: ${msg}. Your previous file (if any) was not overwritten.` }
  }
})

void app.whenReady().then(async () => {
  Menu.setApplicationMenu(
    Menu.buildFromTemplate([
      { role: 'appMenu' },
      { role: 'editMenu' },
      { role: 'viewMenu' },
      { role: 'windowMenu' },
    ]),
  )
  // Start Go service in background; don't block window creation.
  void startGoService().catch((e) => { goError = String(e) })
  createWindow()
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})

app.on('before-quit', () => stopGoService())
app.on('will-quit', () => stopGoService())
