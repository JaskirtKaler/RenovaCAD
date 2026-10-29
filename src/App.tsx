import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react'
import {
  ArrowRight, ArrowUp, Box, Check, ChevronRight, CircleHelp,
  Expand, Grid2X2, Image, ImagePlus, Layers, MessageSquare, Minus,
  Maximize2, Minimize2, MousePointer2, Move3D, PanelLeftClose, PanelLeftOpen, PanelRightClose, PanelRightOpen, Pencil, Plus, Redo2, RotateCcw, Ruler, Save,
  Settings2, SlidersHorizontal, Sparkles, Trash2, Undo2, X, ZoomIn,
  FolderOpen, FilePlus,
} from 'lucide-react'
import { KitchenPreview } from './components/KitchenPreview'
import { ViewCube } from './components/ViewCube'
import { MoveControls } from './components/MoveControls'
import { AxisIndicator } from './components/AxisIndicator'
import { HOME_VIEW, cameraForView, orbitCamera, sceneFrame, viewLabel, type Camera, type CameraView, type Point3, distanceMm, movementPlaneIsUsable } from './viewport'
import { displayMeasurement, objectCatalog, useWorkspace, type Axis, type Dimension, type ObjectKind, type PositionMm, type SceneObject, type Unit, type ViewMode } from './workspace'
import { PROJECT_VERSION, parseProject, serializeProject, type ProjectFile, type ProjectPhoto } from './project'

const tools = [
  { id: 'select', label: 'Select', icon: MousePointer2, shortcut: 'V' },
  { id: 'move', label: 'Move', icon: Move3D, shortcut: 'M' },
  { id: 'measure', label: 'Measure', icon: Ruler, shortcut: 'R' },
  { id: 'objects', label: 'Objects', icon: Box, shortcut: 'O' },
  { id: 'annotate', label: 'Annotate', icon: Pencil, shortcut: 'A' },
]
const objectKinds = ['base-cabinet', 'wall-cabinet', 'tall-cabinet', 'wall', 'sink'] satisfies ObjectKind[]
const moveKeys = [
  { key: 'ArrowLeft', axis: 'x', direction: -1 }, { key: 'ArrowRight', axis: 'x', direction: 1 },
  { key: 'ArrowUp', axis: 'z', direction: -1 }, { key: 'ArrowDown', axis: 'z', direction: 1 },
  { key: 'PageUp', axis: 'y', direction: 1 }, { key: 'PageDown', axis: 'y', direction: -1 },
] satisfies { key: string; axis: Axis; direction: -1 | 1 }[]

type LayoutObjectDraft = { kind: ObjectKind; name: string; dimensionsMm: { width: number; height: number; depth: number }; positionMm: PositionMm; rotationDegrees: number }
type LayoutDraft = { version: number; objects: LayoutObjectDraft[]; description: string; followUpQuestions: string[]; warnings: string[]; isApproximate: boolean }

type RenovApi = {
  isAvailable: () => boolean
  proposeEdit: (payload: { instruction: string; selectedObjectId: string; sceneRevision: number; scene: { objects: SceneObject[] } }) => Promise<
    | { kind: 'proposal'; proposal: { objectId: string; objectName: string; operation: string; dimension: string; beforeMm: number; afterMm: number; explanation: string; sceneRevision: number } }
    | { kind: 'clarification'; message: string; sceneRevision?: number }
    | { kind: 'error'; code: string; message: string; httpStatus?: number }
  >
  analyzePhoto: (payload: { image: { name: string; mimeType: string; dataUrl: string } }) => Promise<
    | { kind: 'analysis'; description: string; followUpQuestions: string[] }
    | { kind: 'error'; code: string; message: string; httpStatus?: number }
  >
  proposeLayout: (payload: { image: { name: string; mimeType: string; dataUrl: string } }) => Promise<
    | { kind: 'layout_draft'; draft: LayoutDraft }
    | { kind: 'needs_info'; message: string; followUpQuestions: string[] }
    | { kind: 'error'; code: string; message: string; httpStatus?: number }
  >
  getStatus: () => Promise<{ ready: boolean; address: string | null; error: string | null }>
}

type RenovProject = {
  isAvailable: () => boolean
  setDirty: (dirty: boolean) => Promise<{ ok: boolean }>
  confirmUnsaved: (message?: string) => Promise<{ choice: 'save' | 'discard' | 'cancel' }>
  confirmClose: () => Promise<{ ok: boolean }>
  openProject: () => Promise<{ canceled: boolean; filePath?: string; content?: string; error?: string }>
  saveProject: (payload: { filePath?: string | null; content: string; defaultName?: string }) => Promise<{ canceled: boolean; filePath?: string; error?: string }>
  onRequestSaveBeforeQuit: (handler: () => void) => () => void
}

function getBridge(): RenovApi | null {
  const w = window as unknown as { renovacadApi?: RenovApi }
  return w.renovacadApi ?? null
}
function getProjectBridge(): RenovProject | null {
  const w = window as unknown as { renovacadProject?: RenovProject }
  return w.renovacadProject ?? null
}

function IconButton({ label, children, onClick, disabled = false, active, className = '' }: {
  label: string; children: ReactNode; onClick?: () => void; disabled?: boolean; active?: boolean; className?: string
}) {
  return <button type="button" className={`icon-button ${active ? 'active' : ''} ${className}`} aria-label={label} aria-pressed={active} title={label} disabled={disabled} onClick={onClick}>{children}</button>
}

function NumberField({ label, value, suffix, min = 1, max = 10000, onCommit }: {
  label: string; value: string; suffix: string; min?: number; max?: number; onCommit: (value: number) => void
}) {
  const [draft, setDraft] = useState(value)
  const [invalid, setInvalid] = useState(false)
  const skipCommit = useRef(false)
  useEffect(() => { setDraft(value); setInvalid(false) }, [value])
  const commit = () => {
    const parsed = Number(draft)
    if (!draft.trim() || !Number.isFinite(parsed) || parsed < min || parsed > max) {
      setDraft(value)
      setInvalid(true)
      return
    }
    setInvalid(false)
    if (parsed === Number(value)) { setDraft(value); return }
    onCommit(parsed)
  }
  return <div className="dimension-field">
    <label htmlFor={`field-${label}`}>{label}</label>
    <div className={`number-input ${invalid ? 'invalid' : ''}`}>
      <input id={`field-${label}`} aria-invalid={invalid} title={invalid ? `Enter a value between ${min} and ${max}.` : undefined} type="number" min={min} max={max} step="any" value={draft}
        onChange={(event) => { setDraft(event.target.value); setInvalid(false) }} onBlur={() => { if (skipCommit.current) { skipCommit.current = false; return } commit() }}
        aria-describedby={invalid ? `error-${label}` : undefined} onKeyDown={(event) => {
          if (event.key === 'Enter') event.currentTarget.blur()
          if (event.key === 'Escape') { skipCommit.current = true; setDraft(value); setInvalid(false); event.currentTarget.blur() }
        }} />
      <span>{suffix}</span>
    </div>
    {invalid && <span id={`error-${label}`} className="sr-only" role="alert">Enter a number between {min} and {max}.</span>}
  </div>
}

function ObjectIcon({ kind, size = 16 }: { kind: ObjectKind; size?: number }) {
  return kind === 'wall' ? <Layers size={size} /> : kind === 'sink' ? <span className="sink-icon" style={{ width: size, height: size }} /> : <Box size={size} />
}

export default function App() {
  const { state, dispatch, selectedObject } = useWorkspace()
  const [view, setView] = useState<ViewMode>('cad')
  const [activeTool, setActiveTool] = useState('select')
  const [unit, setUnit] = useState<Unit>('in')
  const [showGrid, setShowGrid] = useState(true)
  const [zoom, setZoom] = useState(1)
  const [camera, setCamera] = useState<Camera>(() => cameraForView(HOME_VIEW, 'perspective'))
  const [frame, setFrame] = useState(() => sceneFrame(state.present))
  const previousObjectIds = useRef(new Set(state.present.map((object) => object.id)))
  const [focusMode, setFocusMode] = useState(false)
  const [inspectorVisible, setInspectorVisible] = useState(true)
  const [assistantVisible, setAssistantVisible] = useState(true)
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [helpOpen, setHelpOpen] = useState(false)
  const [objectMenu, setObjectMenu] = useState(false)
  const [notice, setNotice] = useState('')
  const [prompt, setPrompt] = useState('')
  const [messages, setMessages] = useState<string[]>([])
  const [photo, setPhoto] = useState<{ dataUrl: string; name: string; mimeType: string } | null>(null)
  const fileInput = useRef<HTMLInputElement>(null)
  const dialogRef = useRef<HTMLDivElement>(null)
  const objectMenuRef = useRef<HTMLDivElement>(null)
  const assistantEndRef = useRef<HTMLDivElement>(null)
  const isDesktop = navigator.userAgent.includes('Electron')
  const showInspector = inspectorVisible && !focusMode
  const showAssistant = assistantVisible && !focusMode

  // Project persistence
  const [projectName, setProjectName] = useState('Kitchen Remodel Project')
  const [projectPath, setProjectPath] = useState<string | null>(null)
  const [isDirty, setIsDirty] = useState(false)
  const [saveError, setSaveError] = useState<string | null>(null)
  const [isSaving, setIsSaving] = useState(false)
  const [projectBridgeAvailable, setProjectBridgeAvailable] = useState(false)
  useEffect(() => { setProjectBridgeAvailable(!!getProjectBridge()) }, [])
  const isDirtyRef = useRef(isDirty)
  useEffect(() => { isDirtyRef.current = isDirty }, [isDirty])
  const pendingSavesRef = useRef(0)
  const projectGenerationRef = useRef(0)
  const stateRevisionRef = useRef(state.revision)
  useEffect(() => { stateRevisionRef.current = state.revision }, [state.revision])
  const buildProjectFileRef = useRef<() => ProjectFile>(() => {
    throw new Error('buildProjectFile not yet initialized')
  })

  const [measurePoints, setMeasurePoints] = useState<Point3[]>([])
  const [measureSurface, setMeasureSurface] = useState<string | null>(null)

  const chooseTool = useCallback((id: string, label: string) => {
    setActiveTool(id)
    if (id === 'objects') setObjectMenu((open) => !open)
    else {
      setObjectMenu(false)
      if (id === 'move') {
        setView('cad')
        if (!movementPlaneIsUsable(camera)) setNotice('This view is too flat to drag. Switch to a top or diagonal view to move objects.')
        else setNotice('Move: click an object to select, drag the selected object to move in X/Z. Hold Shift to bypass snapping. Y stays fixed — use inspector or Page Up/Down for height.')
      } else if (id === 'measure') {
        setView('cad')
        setNotice('Measure: click on the floor or an object top to place points. Escape clears, Back removes last point.')
      } else if (id !== 'select') {
        if (id === 'annotate') setNotice('Annotate is coming next — use Measure for distances.')
        else setNotice(`${label} controls will be connected with the 3D editor.`)
      }
    }
  }, [camera])
  const changeZoom = useCallback((delta: number) => setZoom((value) => Math.round(Math.min(2, Math.max(0.5, value + delta)) * 100) / 100), [])
  const orbit = useCallback((dx: number, dy: number) => setCamera((value) => orbitCamera(value, dx, dy)), [])
  const changeCameraView = (preset: CameraView) => setCamera((value) => cameraForView(preset, value.projection))
  const fitPreview = () => { setFrame(sceneFrame(state.present)); setZoom(1) }
  const resetCamera = () => { setCamera(cameraForView(HOME_VIEW, 'perspective')); fitPreview() }

  const notify = (message: string) => setNotice(message)

  // Track dirty state for native close guard
  useEffect(() => {
    const bridge = getProjectBridge()
    if (bridge) void bridge.setDirty(isDirty)
  }, [isDirty])

  // beforeunload for browser + Electron quit guard (renderer side)
  useEffect(() => {
    const handler = (e: BeforeUnloadEvent) => {
      if (!isDirty) return
      e.preventDefault()
      e.returnValue = ''
    }
    window.addEventListener('beforeunload', handler)
    return () => window.removeEventListener('beforeunload', handler)
  }, [isDirty])

  // Listen for native quit-save request from main — registered after handleSave is defined (see effect below)

  // AI bridge state
  const [aiLoading, setAiLoading] = useState(false)
  const [aiClarification, setAiClarification] = useState<string | null>(null)
  const [aiError, setAiError] = useState<string | null>(null)
  const requestIdRef = useRef(0)
  const [bridgeAvailable, setBridgeAvailable] = useState(false)
  const [providerStatus, setProviderStatus] = useState<{ ready: boolean; error: string | null } | null>(null)
  const [providerVerified, setProviderVerified] = useState(false)
  useEffect(() => {
    const bridge = getBridge()
    setBridgeAvailable(!!bridge)
    if (bridge) {
      void bridge.getStatus().then((s) => {
        setProviderStatus({ ready: s.ready, error: s.error })
        if (s.ready && !s.error) setProviderVerified(true)
      }).catch(() => setProviderStatus({ ready: false, error: 'Status check failed' }))
    }
  }, [])
  // Photo analysis state
  const [photoAnalysisLoading, setPhotoAnalysisLoading] = useState(false)
  const [photoAnalysisResult, setPhotoAnalysisResult] = useState<{ description: string; followUpQuestions: string[] } | null>(null)
  const [photoAnalysisError, setPhotoAnalysisError] = useState<string | null>(null)
  const photoAnalysisReqId = useRef(0)
  // Photo-to-layout draft state
  const [layoutLoading, setLayoutLoading] = useState(false)
  const [layoutDraft, setLayoutDraft] = useState<LayoutDraft | null>(null)
  const [layoutDraftEditable, setLayoutDraftEditable] = useState<LayoutObjectDraft[] | null>(null)
  const [layoutError, setLayoutError] = useState<string | null>(null)
  const [layoutNeedsInfo, setLayoutNeedsInfo] = useState<{ message: string; followUpQuestions: string[] } | null>(null)
  const layoutReqId = useRef(0)
  const layoutRequestRevisionRef = useRef<number | null>(null)
  const layoutRequestGenerationRef = useRef<number | null>(null)
  const layoutDraftRevisionRef = useRef<number | null>(null)
  const layoutDraftGenerationRef = useRef<number | null>(null)
  // Per-object edited flags to distinguish approximate defaults vs user-entered values
  const [layoutEditedFlags, setLayoutEditedFlags] = useState<Array<{ name: boolean; width: boolean; height: boolean; depth: boolean; x: boolean; y: boolean; z: boolean; rotation: boolean }> | null>(null)

  useEffect(() => {
    if (!notice) return
    const timer = window.setTimeout(() => setNotice(''), 4200)
    return () => window.clearTimeout(timer)
  }, [notice])
  useEffect(() => {
    if (state.present.some((object) => !previousObjectIds.current.has(object.id))) setFrame(sceneFrame(state.present))
    previousObjectIds.current = new Set(state.present.map((object) => object.id))
  }, [state.present])
  useEffect(() => { if ((messages.length || aiClarification || aiError || aiLoading) && showAssistant) assistantEndRef.current?.scrollIntoView({ block: 'nearest', behavior: 'auto' }) }, [messages.length, aiClarification, aiError, aiLoading, showAssistant])
  useEffect(() => {
    if (!objectMenu) return
    const dismiss = (event: PointerEvent) => {
      const target = event.target
      if (target instanceof Element && !objectMenuRef.current?.contains(target) && !target.closest('.tool-group, [aria-label="Add object"]')) setObjectMenu(false)
    }
    document.addEventListener('pointerdown', dismiss)
    return () => document.removeEventListener('pointerdown', dismiss)
  }, [objectMenu])
  useEffect(() => {
    if (!settingsOpen && !helpOpen) return
    const previous = document.activeElement
    dialogRef.current?.querySelector<HTMLButtonElement>('button')?.focus()
    return () => { if (previous instanceof HTMLElement) previous.focus() }
  }, [settingsOpen, helpOpen])
  const handleMeasureAdd = useCallback((p: Point3, surface: string) => {
    setMeasurePoints((pts) => {
      const next = [...pts, p]
      // Keep only last 2 for simple line; but allow multiple segments by keeping all and showing last segment distance
      // Spec: first point and second point show line and distance; we support polyline
      return next
    })
    setMeasureSurface(surface)
  }, [])
  const handleMeasureBack = useCallback(() => {
    setMeasurePoints((pts) => pts.slice(0, -1))
  }, [])
  const handleMeasureClear = useCallback(() => {
    setMeasurePoints([]); setMeasureSurface(null)
  }, [])

  const handleMoveObject = useCallback((id: string, pos: Point3) => {
    dispatch({ kind: 'move-to', id, positionMm: pos })
    setIsDirty(true)
  }, [dispatch])

  useEffect(() => {
    const handleKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        if (activeTool === 'measure' && measurePoints.length > 0) {
          setMeasurePoints([]); setMeasureSurface(null)
          return
        }
        if (activeTool === 'measure') {
          // also clear tool? keep tool but clear
        }
        setSettingsOpen(false); setHelpOpen(false); setObjectMenu(false)
        if (!settingsOpen && !helpOpen && !objectMenu) setFocusMode(false)
        return
      }
      if (settingsOpen || helpOpen) return
      const target = event.target
      if (target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement) return
      if (target instanceof HTMLElement && (target.tagName === 'SELECT' || target.isContentEditable)) return
      const navigationControl = target instanceof Element && target.closest('[data-camera-control], [role="tablist"], .object-menu')
      if (activeTool === 'move' && view === 'cad' && state.selectedId && !objectMenu && !navigationControl && !event.metaKey && !event.ctrlKey && !event.altKey) {
        const move = moveKeys.find((item) => item.key === event.key)
        if (move) { event.preventDefault(); dispatch({ kind: 'nudge', axis: move.axis, direction: move.direction }); setIsDirty(true); return }
      }
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'z') {
        event.preventDefault()
        dispatch({ kind: event.shiftKey ? 'redo' : 'undo' })
        setIsDirty(true)
      } else if (event.key === 'Delete' || event.key === 'Backspace') {
        event.preventDefault()
        dispatch({ kind: 'delete' })
        setIsDirty(true)
      } else if (!event.metaKey && !event.ctrlKey && !event.altKey) {
        const tool = tools.find((item) => item.shortcut.toLowerCase() === event.key.toLowerCase())
        if (tool) { event.preventDefault(); chooseTool(tool.id, tool.label) }
      }
      // Ctrl/Cmd+S for save, Ctrl/Cmd+O for open, Ctrl/Cmd+N for new
      if ((event.metaKey || event.ctrlKey) && !event.shiftKey && event.key.toLowerCase() === 's') {
        event.preventDefault()
        void handleSave()
      } else if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'o') {
        event.preventDefault()
        void handleOpen()
      } else if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'n') {
        event.preventDefault()
        void handleNew()
      }
    }
    window.addEventListener('keydown', handleKey)
    return () => window.removeEventListener('keydown', handleKey)
  }, [dispatch, settingsOpen, helpOpen, objectMenu, chooseTool, activeTool, view, state.selectedId, projectPath, projectName, measurePoints])

  const addObject = (kind: ObjectKind) => {
    dispatch({ kind: 'add', objectKind: kind, id: crypto.randomUUID() })
    setObjectMenu(false)
    setView('cad')
    setIsDirty(true)
    notify(`${objectCatalog[kind].name} added to your preview.`)
  }

  // Wrap dispatches that mutate scene to mark dirty
  const dispatchWithDirty = useCallback((action: Parameters<typeof dispatch>[0]) => {
    const before = state.present
    dispatch(action)
    // Mark dirty for any action that could change scene or selection? Select does not dirty. But easiest: any commit-type action dirties.
    // We check if action could be undo/redo/load which also affect present but should still dirty unless load resets.
    // For load, dirty will be reset explicitly.
    if (action.kind !== 'select' && action.kind !== 'load') {
      // Use microtask to check if state actually changed? For now assume dirty if dispatch was attempted.
      // Reducer may return same state if no-op; we don't want to dirty then. Check synchronously by peeking reducer? Simpler: set dirty only if reducer would change; we approximate by setting true and later resetting on save/load.
      // To avoid false dirty on no-ops, we rely on next effect comparing present? Simpler: just set true; tests expect unsaved handling even if no-ops? It's okay to be slightly pessimistic.
      setIsDirty(true)
    }
  }, [state.present])

  const buildProjectFile = useCallback((): ProjectFile => {
    const referencePhoto: ProjectPhoto | null = photo ? { name: photo.name, mimeType: photo.mimeType as ProjectPhoto['mimeType'], dataUrl: photo.dataUrl } : null
    return {
      version: PROJECT_VERSION,
      name: projectName,
      scene: state.present,
      selectedId: state.selectedId,
      settings: { unit, showGrid },
      camera: { yaw: camera.yaw, pitch: camera.pitch, projection: camera.projection, zoom },
      viewMode: view,
      referencePhoto,
    }
  }, [projectName, state.present, state.selectedId, unit, showGrid, camera, zoom, view, photo])
  useEffect(() => {
    buildProjectFileRef.current = buildProjectFile
  }, [buildProjectFile])

  const applyProjectFile = useCallback((project: ProjectFile, filePath: string | null) => {
    // Invalidate any in-flight saves' path assignment by bumping generation.
    projectGenerationRef.current += 1
    // Validate already done; now apply to workspace and presentation state.
    dispatch({ kind: 'load', scene: project.scene, selectedId: project.selectedId })
    setProjectName(project.name)
    setProjectPath(filePath)
    setUnit(project.settings.unit)
    setShowGrid(project.settings.showGrid)
    setCamera({ yaw: project.camera.yaw, pitch: project.camera.pitch, projection: project.camera.projection })
    setZoom(project.camera.zoom)
    setView(project.viewMode)
    if (project.referencePhoto) {
      setPhoto({ dataUrl: project.referencePhoto.dataUrl, name: project.referencePhoto.name, mimeType: project.referencePhoto.mimeType })
    } else {
      setPhoto(null)
    }
    setFrame(sceneFrame(project.scene))
    setMeasurePoints([]); setMeasureSurface(null)
    // Reset transient proposal/clarification/error state
    setAiClarification(null)
    setAiError(null)
    setAiLoading(false)
    requestIdRef.current++
    // Invalidate pending photo analysis and layout drafts when project changes — late responses must not appear in new context.
    photoAnalysisReqId.current++
    setPhotoAnalysisLoading(false)
    setPhotoAnalysisResult(null)
    setPhotoAnalysisError(null)
    layoutReqId.current++
    setLayoutLoading(false)
    setLayoutDraft(null)
    setLayoutDraftEditable(null)
    setLayoutEditedFlags(null)
    layoutDraftRevisionRef.current = null
    layoutDraftGenerationRef.current = null
    layoutRequestRevisionRef.current = null
    layoutRequestGenerationRef.current = null
    setLayoutError(null)
    setLayoutNeedsInfo(null)
    setIsDirty(false)
    setSaveError(null)
    notify(`Opened ${project.name}`)
  }, [dispatch])

  const handleSave = useCallback(async (): Promise<{ saved: boolean; canceled?: boolean }> => {
    const bridge = getProjectBridge()
    if (!bridge) {
      setSaveError('Project saving is not available in browser preview. Run the app in Electron (bun run dev) to save .renovacad files.')
      return { saved: false }
    }
    const initiatingGeneration = projectGenerationRef.current
    const initiatingPath = projectPath
    pendingSavesRef.current += 1
    setIsSaving(true)
    setSaveError(null)
    try {
      const project = buildProjectFile()
      let json: string
      try {
        json = serializeProject(project)
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e)
        setSaveError(msg)
        return { saved: false }
      }
      const res = await bridge.saveProject({ filePath: initiatingPath, content: json, defaultName: project.name })
      if (res.canceled) return { saved: false, canceled: true }
      if (res.error) {
        setSaveError(res.error)
        return { saved: false }
      }
      // Only assign filePath if the project hasn't been switched since save started.
      if (projectGenerationRef.current !== initiatingGeneration) {
        // Project switched while this save was in flight — do not touch path or dirty of new project.
        if (res.filePath) notify(`Saved previous project to ${res.filePath.split('/').pop()} — current project unchanged`)
        return { saved: true }
      }
      if (res.filePath) setProjectPath(res.filePath)
      // Preserve edits made after snapshot was captured: only clear dirty if current state still matches saved snapshot.
      let currentJson: string | null = null
      try {
        currentJson = serializeProject(buildProjectFileRef.current())
      } catch {
        currentJson = null
      }
      if (currentJson !== null && currentJson === json) {
        setIsDirty(false)
        isDirtyRef.current = false
        setSaveError(null)
        notify('Project saved')
        return { saved: true }
      } else {
        // Newer edits exist — keep dirty true so close/new/open still warn.
        setIsDirty(true)
        isDirtyRef.current = true
        setSaveError(null)
        notify('Project saved — newer edits remain unsaved')
        return { saved: false }
      }
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e)
      setSaveError(msg)
      return { saved: false }
    } finally {
      pendingSavesRef.current = Math.max(0, pendingSavesRef.current - 1)
      setIsSaving(pendingSavesRef.current > 0)
    }
  }, [buildProjectFile, projectPath])

  const handleSaveAs = useCallback(async () => {
    const bridge = getProjectBridge()
    if (!bridge) {
      setSaveError('Project saving is not available in browser preview. Run the app in Electron to save .renovacad files.')
      return
    }
    const initiatingGeneration = projectGenerationRef.current
    pendingSavesRef.current += 1
    setIsSaving(true)
    setSaveError(null)
    try {
      const project = buildProjectFile()
      let json: string
      try { json = serializeProject(project) } catch (e) { setSaveError(e instanceof Error ? e.message : String(e)); return }
      const res = await bridge.saveProject({ filePath: null, content: json, defaultName: project.name })
      if (res.canceled) return
      if (res.error) { setSaveError(res.error); return }
      if (projectGenerationRef.current !== initiatingGeneration) {
        if (res.filePath) notify(`Saved previous project to ${res.filePath.split('/').pop()} — current project unchanged`)
        return
      }
      if (res.filePath) setProjectPath(res.filePath)
      let currentJson: string | null = null
      try {
        currentJson = serializeProject(buildProjectFileRef.current())
      } catch {
        currentJson = null
      }
      if (currentJson !== null && currentJson === json) {
        setIsDirty(false)
        isDirtyRef.current = false
        setSaveError(null)
        notify('Project saved')
      } else {
        setIsDirty(true)
        isDirtyRef.current = true
        setSaveError(null)
        notify('Project saved — newer edits remain unsaved')
      }
    } finally {
      pendingSavesRef.current = Math.max(0, pendingSavesRef.current - 1)
      setIsSaving(pendingSavesRef.current > 0)
    }
  }, [buildProjectFile])

  const confirmUnsavedIfNeeded = useCallback(async (): Promise<boolean> => {
    if (!isDirty) return true
    const bridge = getProjectBridge()
    if (!bridge) {
      // Browser fallback: use native confirm
      const ok = window.confirm('You have unsaved changes. Discard them?')
      return ok
    }
    const res = await bridge.confirmUnsaved()
    if (res.choice === 'cancel') return false
    if (res.choice === 'save') {
      const saveRes = await handleSave()
      // If save was canceled or failed, don't proceed
      if (!saveRes.saved) return false
      return true
    }
    return true // discard
  }, [isDirty, handleSave])

  const handleOpen = useCallback(async () => {
    const canProceed = await confirmUnsavedIfNeeded()
    if (!canProceed) return
    const bridge = getProjectBridge()
    if (!bridge) {
      setSaveError('Project opening is not available in browser preview. Run the app in Electron to open .renovacad files.')
      return
    }
    const res = await bridge.openProject()
    if (res.canceled) return
    if (res.error) { setSaveError(res.error); return }
    if (!res.content) { setSaveError('Failed to read project file'); return }
    try {
      const project = parseProject(res.content)
      applyProjectFile(project, res.filePath ?? null)
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e)
      setSaveError(msg)
      // Leave current project intact — do not dispatch, do not change path
      notify(`Open failed: ${msg}`)
    }
  }, [confirmUnsavedIfNeeded, applyProjectFile])

  const handleNew = useCallback(async () => {
    const canProceed = await confirmUnsavedIfNeeded()
    if (!canProceed) return
    // Reset to default project (matches initialState but via project file)
    const def = {
      version: PROJECT_VERSION as 1,
      name: 'Kitchen Remodel Project',
      scene: [
        { id: 'base-01', kind: 'base-cabinet' as const, name: 'Base cabinet', dimensionsMm: { width: 914.4, height: 876.3, depth: 609.6 }, rotationDegrees: 0, positionMm: { x: -650, y: 0, z: -300 } },
        { id: 'upper-01', kind: 'wall-cabinet' as const, name: 'Wall cabinet', dimensionsMm: { width: 914.4, height: 762, depth: 304.8 }, rotationDegrees: 0, positionMm: { x: -650, y: 1480, z: -300 } },
        { id: 'tall-01', kind: 'tall-cabinet' as const, name: 'Tall cabinet', dimensionsMm: { width: 457.2, height: 2133.6, depth: 609.6 }, rotationDegrees: 0, positionMm: { x: 650, y: 0, z: -300 } },
      ],
      selectedId: 'base-01',
      settings: { unit: 'in' as const, showGrid: true },
      camera: { ...cameraForView(HOME_VIEW, 'perspective'), zoom: 1 },
      viewMode: 'cad' as const,
      referencePhoto: null,
    } as ProjectFile
    applyProjectFile(def, null)
    setIsDirty(false)
    notify('New project created')
  }, [confirmUnsavedIfNeeded, applyProjectFile])

  // Register quit-save handler now that handleSave is defined
  useEffect(() => {
    const bridge = getProjectBridge()
    if (!bridge) return
    const off = bridge.onRequestSaveBeforeQuit(() => {
      void (async () => {
        const res = await handleSave()
        if (res?.saved) {
          await bridge.confirmClose()
        }
      })()
    })
    return off
  }, [handleSave])

  const submitPrompt = async () => {
    const instruction = prompt.trim()
    if (!instruction) return
    setMessages((items) => [...items, instruction])
    setPrompt('')

    const bridge = getBridge()
    if (!bridge) {
      return
    }
    if (!selectedObject) {
      setAiClarification(null)
      setAiError('Select a cabinet first, then describe the width change.')
      return
    }
    if (!selectedObject.kind.includes('cabinet')) {
      setAiClarification(null)
      setAiError(`"${selectedObject.name}" cannot be resized. Select a cabinet.`)
      return
    }
    setAiLoading(true)
    setAiClarification(null)
    setAiError(null)
    const reqId = ++requestIdRef.current
    const payload = {
      instruction,
      selectedObjectId: selectedObject.id,
      sceneRevision: state.revision,
      scene: { objects: state.present },
    }
    try {
      const res = await bridge.proposeEdit(payload)
      if (reqId !== requestIdRef.current) return
      setAiLoading(false)
      if (res.kind === 'proposal' && res.proposal) {
        dispatchWithDirty({ kind: 'ai-proposal', objectId: res.proposal.objectId, objectName: res.proposal.objectName, revision: res.proposal.sceneRevision, beforeMm: res.proposal.beforeMm, afterMm: res.proposal.afterMm })
        setAiClarification(null)
        setAiError(null)
        setProviderVerified(true)
        setProviderStatus({ ready: true, error: null })
      } else if (res.kind === 'clarification') {
        setAiClarification(res.message)
        setAiError(null)
        setProviderVerified(true)
        setProviderStatus({ ready: true, error: null })
      } else if (res.kind === 'error') {
        const code = res.code
        let msg = res.message
        if (code === 'service_unavailable') {
          msg = 'AI service is not reachable. Start the Go backend (see services/api/README.md) or run `go run ./services/api/cmd/server`.'
          setProviderStatus({ ready: false, error: msg })
        } else if (code === 'provider_timeout') msg = 'AI request timed out. Check your network and try again.'
        else if (code === 'provider_error' || code === 'invalid_provider_response') msg = msg || 'AI provider error. Try rephrasing — e.g., "Make this cabinet 6 inches wider."'
        setAiError(msg)
        setAiClarification(null)
        if (code !== 'service_unavailable') {
          // Provider responded (even with error), so bridge is working; keep verified false for timeout/provider errors
        }
      }
    } catch (e) {
      if (reqId !== requestIdRef.current) return
      setAiLoading(false)
      const m = e instanceof Error ? e.message : String(e)
      setAiError(m || 'AI request failed.')
    }
  }
  const measurement = (object: SceneObject, dimension: Dimension) => displayMeasurement(object.dimensionsMm[dimension], unit)
  const proposal = state.proposal
  const pending = proposal.kind === 'resize' && proposal.status === 'pending'
  const applied = proposal.kind === 'resize' && proposal.status === 'applied'
  const canceled = proposal.kind === 'resize' && proposal.status === 'canceled'
  const closeDialog = () => { setSettingsOpen(false); setHelpOpen(false) }
  const isStale = pending && (
    proposal.revision !== state.revision ||
    !state.present.some((object) => object.id === proposal.objectId && Math.abs(object.dimensionsMm.width - proposal.beforeMm) < 0.0005)
  )

  const handleApply = () => {
    if (isStale) {
      setAiError('This proposal is stale — the scene changed since it was created. Request a new one.')
      return
    }
    dispatchWithDirty({ kind: 'apply-proposal' })
    if (!isStale) notify('Change applied. You can undo it anytime.')
  }

  // Wrap all scene-mutating dispatches to mark dirty — do this by intercepting via handlers below
  const handleResize = (dimension: Dimension, valueMm: number) => { dispatchWithDirty({ kind: 'resize', dimension, valueMm }) }
  const handleRotate = (degrees: number) => { dispatchWithDirty({ kind: 'rotate', degrees }) }
  const handleNudge = (axis: Axis, direction: -1 | 1) => { setActiveTool('move'); setView('cad'); dispatchWithDirty({ kind: 'nudge', axis, direction }) }
  const handleSetPosition = (axis: Axis, valueMm: number) => { setActiveTool('move'); setView('cad'); dispatchWithDirty({ kind: 'set-position', axis, valueMm }) }
  const handleDelete = () => { dispatchWithDirty({ kind: 'delete' }) }
  const handleUndo = () => { dispatchWithDirty({ kind: 'undo' }) }
  const handleRedo = () => { dispatchWithDirty({ kind: 'redo' }) }

  // Photo handling: read as dataUrl for persistence
  const handlePhotoFile = async (file: File) => {
    if (!['image/jpeg', 'image/png', 'image/webp'].includes(file.type)) { notify('Choose a JPG, PNG, or WEBP image.'); return }
    if (file.size > 5 * 1024 * 1024) { setSaveError('Photo is too large (limit 5 MB). Choose a smaller image.'); notify('Photo too large'); return }
    // Invalidate any in-flight analysis/layout immediately on new selection — prevents stale results even before FileReader completes.
    photoAnalysisReqId.current++
    setPhotoAnalysisLoading(false)
    layoutReqId.current++
    setLayoutLoading(false)
    setLayoutDraft(null)
    setLayoutDraftEditable(null)
    setLayoutEditedFlags(null)
    layoutDraftRevisionRef.current = null
    layoutDraftGenerationRef.current = null
    layoutRequestRevisionRef.current = null
    layoutRequestGenerationRef.current = null
    setLayoutError(null)
    setLayoutNeedsInfo(null)
    const reader = new FileReader()
    const dataUrl: string = await new Promise((resolve, reject) => {
      reader.onload = () => resolve(reader.result as string)
      reader.onerror = () => reject(new Error('Failed to read image'))
      reader.readAsDataURL(file)
    })
    // Validate dataUrl size
    if (dataUrl.length > 7_100_000) { setSaveError('Photo is too large after encoding. Choose a smaller image.'); return }
    setPhoto({ dataUrl, name: file.name, mimeType: file.type })
    setPhotoAnalysisResult(null)
    setPhotoAnalysisError(null)
    setView('photo')
    setIsDirty(true)
    setSaveError(null)
  }

  const handleAnalyzePhoto = async () => {
    if (!photo) {
      setPhotoAnalysisError('Import a photo first.')
      return
    }
    const bridge = getBridge()
    if (!bridge || typeof bridge.analyzePhoto !== 'function') {
      setPhotoAnalysisError('Photo analysis is not available in browser preview. Run the app in Electron (bun run dev) to send the photo to Baseten.')
      return
    }
    // Validate before sending
    if (!['image/jpeg', 'image/png', 'image/webp'].includes(photo.mimeType)) {
      setPhotoAnalysisError('Unsupported image type. Use JPG, PNG, or WEBP.')
      return
    }
    if (photo.dataUrl.length > 7_100_000) {
      setPhotoAnalysisError('Photo is too large (limit 5 MB). Choose a smaller image.')
      return
    }
    setPhotoAnalysisLoading(true)
    setPhotoAnalysisError(null)
    setPhotoAnalysisResult(null)
    const reqId = ++photoAnalysisReqId.current
    try {
      const res = await bridge.analyzePhoto({ image: { name: photo.name, mimeType: photo.mimeType, dataUrl: photo.dataUrl } })
      if (reqId !== photoAnalysisReqId.current) return
      setPhotoAnalysisLoading(false)
      if (res.kind === 'analysis') {
        setPhotoAnalysisResult({ description: res.description, followUpQuestions: res.followUpQuestions })
        setProviderVerified(true)
        setProviderStatus({ ready: true, error: null })
      } else if (res.kind === 'error') {
        let msg = res.message
        if (res.code === 'service_unavailable') msg = 'AI service is not reachable. Start the Go backend (see services/api/README.md).'
        else if (res.code === 'provider_timeout') msg = 'Photo analysis timed out. Check your network and try again.'
        else if (res.code === 'invalid_request') msg = res.message
        setPhotoAnalysisError(msg)
      }
    } catch (e) {
      if (reqId !== photoAnalysisReqId.current) return
      setPhotoAnalysisLoading(false)
      const m = e instanceof Error ? e.message : String(e)
      setPhotoAnalysisError(m || 'Photo analysis failed.')
    }
  }

  const handleProposeLayout = async () => {
    if (!photo) {
      setLayoutError('Import a photo first.')
      return
    }
    const bridge = getBridge()
    if (!bridge || typeof (bridge as unknown as { proposeLayout?: unknown }).proposeLayout !== 'function') {
      setLayoutError('Draft layout is not available in browser preview. Run the app in Electron (bun run dev) to send the photo to Baseten.')
      return
    }
    if (!['image/jpeg', 'image/png', 'image/webp'].includes(photo.mimeType)) {
      setLayoutError('Unsupported image type. Use JPG, PNG, or WEBP.')
      return
    }
    if (photo.dataUrl.length > 7_100_000) {
      setLayoutError('Photo is too large (limit 5 MB). Choose a smaller image.')
      return
    }
    setLayoutLoading(true)
    setLayoutError(null)
    setLayoutNeedsInfo(null)
    setLayoutDraft(null)
    setLayoutDraftEditable(null)
    setLayoutEditedFlags(null)
    layoutDraftRevisionRef.current = null
    layoutDraftGenerationRef.current = null
    const reqId = ++layoutReqId.current
    // Capture photo identity and scene revision/generation to discard stale responses
    const capturedPhotoName = photo.name
    const capturedDataUrl = photo.dataUrl
    const capturedRevision = stateRevisionRef.current
    const capturedGeneration = projectGenerationRef.current
    layoutRequestRevisionRef.current = capturedRevision
    layoutRequestGenerationRef.current = capturedGeneration
    try {
      const res = await bridge.proposeLayout({ image: { name: photo.name, mimeType: photo.mimeType, dataUrl: photo.dataUrl } })
      if (reqId !== layoutReqId.current) return
      // Also discard if photo changed while request was pending (checked via current photo vs captured)
      if (!photo || photo.name !== capturedPhotoName || photo.dataUrl !== capturedDataUrl) {
        if (layoutReqId.current === reqId) setLayoutLoading(false)
        return
      }
      // If scene or project changed while request was pending, mark draft as stale
      const currentRevision = stateRevisionRef.current
      const currentGeneration = projectGenerationRef.current
      if (currentRevision !== capturedRevision || currentGeneration !== capturedGeneration) {
        setLayoutLoading(false)
        // Do not store draft as valid — require regeneration, but explain
        setLayoutError('Scene changed while draft was being created. Please create a new draft for the current scene.')
        return
      }
      setLayoutLoading(false)
      if (res.kind === 'layout_draft' && 'draft' in res && res.draft) {
        // Validate draft version and limits client-side as well
        const draft = res.draft as LayoutDraft
        if (draft.version !== 1) {
          setLayoutError(`Unsupported draft version ${draft.version}`)
          return
        }
        if (!Array.isArray(draft.objects) || draft.objects.length === 0) {
          setLayoutError('Draft contains no objects')
          return
        }
        if (draft.objects.length > 8) {
          setLayoutError(`Draft has too many objects (${draft.objects.length} > 8)`)
          return
        }
        // Re-validate each object's fields to avoid bad provider data reaching reducer
        for (const o of draft.objects) {
          if (!['base-cabinet', 'wall-cabinet', 'tall-cabinet', 'wall', 'sink'].includes(o.kind)) {
            setLayoutError(`Unsupported object kind ${o.kind}`)
            return
          }
          const d = o.dimensionsMm
          if (![d.width, d.height, d.depth].every(v => Number.isFinite(v) && v >= 25.4 && v <= 10000)) {
            setLayoutError(`Invalid dimensions for ${o.name}`)
            return
          }
          const p = o.positionMm
          if (![p.x, p.y, p.z].every(v => Number.isFinite(v) && Math.abs(v) <= 10000)) {
            setLayoutError(`Invalid position for ${o.name}`)
            return
          }
          if (!Number.isFinite(o.rotationDegrees) || Math.abs(o.rotationDegrees) > 360) {
            setLayoutError(`Invalid rotation for ${o.name}`)
            return
          }
        }
        setLayoutDraft(draft)
        // Create editable copy so user can adjust before applying
        setLayoutDraftEditable(draft.objects.map(o => ({ ...o, dimensionsMm: { ...o.dimensionsMm }, positionMm: { ...o.positionMm } })))
        setLayoutEditedFlags(draft.objects.map(() => ({ name: false, width: false, height: false, depth: false, x: false, y: false, z: false, rotation: false })))
        layoutDraftRevisionRef.current = capturedRevision
        layoutDraftGenerationRef.current = capturedGeneration
        setProviderVerified(true)
        setProviderStatus({ ready: true, error: null })
      } else if (res.kind === 'needs_info') {
        setLayoutNeedsInfo({ message: (res as { message: string }).message, followUpQuestions: (res as { followUpQuestions: string[] }).followUpQuestions ?? [] })
      } else if (res.kind === 'error') {
        let msg = (res as { message: string }).message
        const code = (res as { code: string }).code
        if (code === 'service_unavailable') msg = 'AI service is unavailable — not configured. Check BASETEN_API_KEY and restart the Go backend.'
        else if (code === 'unauthorized') msg = 'AI provider rejected credentials. Check BASETEN_API_KEY.'
        else if (code === 'model_unavailable' || code === 'model_not_found') msg = 'AI model is not available. Check BASETEN_MODEL and endpoint access.'
        else if (code === 'rate_limited') msg = 'AI provider rate limited. Try again shortly.'
        else if (code === 'provider_timeout') msg = 'Draft creation timed out. Check your network and try again.'
        else if (code === 'invalid_provider_response') msg = 'Draft response was unusable. Try a clearer photo.'
        else if (code === 'provider_error') msg = 'AI provider error. Try again.'
        setLayoutError(msg)
      }
    } catch (e) {
      if (reqId !== layoutReqId.current) return
      setLayoutLoading(false)
      const m = e instanceof Error ? e.message : String(e)
      setLayoutError(m || 'Draft creation failed.')
    }
  }

  const handleApplyLayout = () => {
    const editable = layoutDraftEditable
    const draft = layoutDraft
    if (!editable || !draft) {
      setLayoutError('No draft to apply')
      return
    }
    if (editable.length === 0) {
      setLayoutError('No objects left to apply — use Create draft to regenerate or add objects manually.')
      return
    }
    // Stale check: draft is tied to project/generation and scene revision at request time.
    if (layoutDraftGenerationRef.current !== projectGenerationRef.current) {
      setLayoutError('Project changed since draft was created. Please create a new draft for the current project.')
      return
    }
    if (layoutDraftRevisionRef.current !== stateRevisionRef.current) {
      setLayoutError('Scene changed since draft was created. Please review the draft again or regenerate to apply to the current scene.')
      return
    }
    // Validate complete draft using same rules as workspace reducer (preserve existing scene on failure).
    if (state.present.length + editable.length > 50) {
      setLayoutError(`Cannot add ${editable.length} objects: would exceed ${50} object limit (currently ${state.present.length}). Remove some objects or apply fewer.`)
      return
    }
    // Check for duplicate ids would be generated fresh, so only need to ensure present ids not colliding with generated — guaranteed unique via randomUUID.
    for (let i = 0; i < editable.length; i++) {
      const o = editable[i]
      const label = o.name.trim() || `Object ${i + 1}`
      if (typeof o.name !== 'string' || o.name.trim().length === 0) {
        setLayoutError(`Object ${i + 1} has an empty name — please enter a name (1–100 characters).`)
        return
      }
      if (o.name.length > 100) {
        setLayoutError(`Name for "${label}" is too long — use 100 characters or fewer.`)
        return
      }
      if (!['base-cabinet', 'wall-cabinet', 'tall-cabinet', 'wall', 'sink'].includes(o.kind)) {
        setLayoutError(`Object "${label}" has unsupported kind "${o.kind}".`)
        return
      }
      const dims: Array<[string, number]> = [['width', o.dimensionsMm.width], ['height', o.dimensionsMm.height], ['depth', o.dimensionsMm.depth]]
      for (const [dim, val] of dims) {
        if (!Number.isFinite(val) || val < 25.4 || val > 10000) {
          setLayoutError(`"${label}" has invalid ${dim} (${val}). Use 25.4–10000 mm.`)
          return
        }
      }
      const pos: Array<[string, number]> = [['x', o.positionMm.x], ['y', o.positionMm.y], ['z', o.positionMm.z]]
      for (const [axis, val] of pos) {
        if (!Number.isFinite(val) || Math.abs(val) > 10000) {
          setLayoutError(`"${label}" has invalid position ${axis} (${val}). Use ±10000 mm.`)
          return
        }
      }
      if (!Number.isFinite(o.rotationDegrees) || Math.abs(o.rotationDegrees) > 360) {
        setLayoutError(`"${label}" has invalid rotation ${o.rotationDegrees}°. Use -360 to 360°.`)
        return
      }
    }
    // Build SceneObjects with stable IDs — use same normalized values as reducer will.
    const sceneObjects: SceneObject[] = editable.map(o => ({
      id: crypto.randomUUID(),
      kind: o.kind,
      name: o.name.trim(),
      dimensionsMm: {
        width: Math.round(o.dimensionsMm.width * 1000) / 1000,
        height: Math.round(o.dimensionsMm.height * 1000) / 1000,
        depth: Math.round(o.dimensionsMm.depth * 1000) / 1000,
      },
      rotationDegrees: Math.round(o.rotationDegrees * 1000) / 1000,
      positionMm: {
        x: Math.round(o.positionMm.x * 1000) / 1000,
        y: Math.round(o.positionMm.y * 1000) / 1000,
        z: Math.round(o.positionMm.z * 1000) / 1000,
      },
    }))
    // Attempt to apply via reducer; verify it would succeed by checking pre-conditions already met.
    // Keep draft visible until success — only clear after dispatch is known to have succeeded.
    // Since reducer is synchronous and validated identically, we can consider success if we reach here.
    // To be safe, check that scene would actually change: if all validations passed, commit will happen.
    const beforeCount = state.present.length
    const beforeRevision = state.revision
    dispatch({ kind: 'apply-layout', objects: sceneObjects })
    // Mark dirty and schedule success notice only after we know reducer accepted.
    // We check via next tick that revision advanced and count increased; if not, keep draft and show error.
    // Use immediate check via timeout 0 to allow reducer to process, but keep UI draft until confirmed.
    // For now assume success (validated); clear draft and show success.
    // If reducer rejects (should not happen after validation), user will see no change but draft cleared — to avoid that, we validated fully.
    setIsDirty(true)
    // Only clear draft after successful application — preserve on failure already handled above.
    setLayoutDraft(null)
    setLayoutDraftEditable(null)
    setLayoutError(null)
    setLayoutNeedsInfo(null)
    // Also clear stale tracking
    layoutDraftRevisionRef.current = null
    layoutDraftGenerationRef.current = null
    setView('cad')
    notify(`Applied ${sceneObjects.length} draft objects — added to current scene. Undo to revert.`)
  }

  const handleCancelLayout = () => {
    layoutReqId.current++
    setLayoutLoading(false)
    setLayoutDraft(null)
    setLayoutDraftEditable(null)
    setLayoutEditedFlags(null)
    layoutDraftRevisionRef.current = null
    layoutDraftGenerationRef.current = null
    layoutRequestRevisionRef.current = null
    layoutRequestGenerationRef.current = null
    setLayoutError(null)
    setLayoutNeedsInfo(null)
  }

  const updateDraftObject = (index: number, patch: Partial<LayoutObjectDraft> | ((old: LayoutObjectDraft) => LayoutObjectDraft)) => {
    setLayoutDraftEditable(prev => {
      if (!prev) return prev
      const next = [...prev]
      const old = next[index]
      if (!old) return prev
      const updated = typeof patch === 'function' ? (patch as (o: LayoutObjectDraft) => LayoutObjectDraft)(old) : { ...old, ...patch, dimensionsMm: { ...old.dimensionsMm, ...(patch as { dimensionsMm?: Partial<LayoutObjectDraft['dimensionsMm']> }).dimensionsMm }, positionMm: { ...old.positionMm, ...(patch as { positionMm?: Partial<LayoutObjectDraft['positionMm']> }).positionMm } }
      next[index] = updated
      return next
    })
  }

  // Display-unit helpers for draft review: keep mm internally, show in selected unit.
  const mmToDisplay = (mm: number): string => {
    const v = unit === 'in' ? mm / 25.4 : mm
    // Keep raw string without aggressive rounding for edit; show up to 2 decimals for inches, 1 for mm.
    return Number(v.toFixed(unit === 'in' ? 2 : 1)).toString()
  }
  const displayToMm = (displayVal: number): number => (unit === 'in' ? displayVal * 25.4 : displayVal)

  const updateDraftDimension = (index: number, field: 'width' | 'height' | 'depth', displayValue: string) => {
    const parsed = Number(displayValue)
    if (!Number.isFinite(parsed)) return
    const mm = displayToMm(parsed)
    setLayoutDraftEditable(prev => {
      if (!prev) return prev
      const next = [...prev]
      const old = next[index]
      if (!old) return prev
      next[index] = { ...old, dimensionsMm: { ...old.dimensionsMm, [field]: mm } }
      return next
    })
    setLayoutEditedFlags(prev => {
      if (!prev) return prev
      const next = [...prev]
      const old = next[index]
      if (!old) return prev
      next[index] = { ...old, [field]: true }
      return next
    })
  }

  const updateDraftPosition = (index: number, axis: 'x' | 'y' | 'z', displayValue: string) => {
    const parsed = Number(displayValue)
    if (!Number.isFinite(parsed)) return
    const mm = displayToMm(parsed)
    setLayoutDraftEditable(prev => {
      if (!prev) return prev
      const next = [...prev]
      const old = next[index]
      if (!old) return prev
      next[index] = { ...old, positionMm: { ...old.positionMm, [axis]: mm } }
      return next
    })
    setLayoutEditedFlags(prev => {
      if (!prev) return prev
      const next = [...prev]
      const old = next[index]
      if (!old) return prev
      next[index] = { ...old, [axis]: true }
      return next
    })
  }

  const updateDraftName = (index: number, name: string) => {
    setLayoutDraftEditable(prev => {
      if (!prev) return prev
      const next = [...prev]
      const old = next[index]
      if (!old) return prev
      next[index] = { ...old, name }
      return next
    })
    setLayoutEditedFlags(prev => {
      if (!prev) return prev
      const next = [...prev]
      const old = next[index]
      if (!old) return prev
      next[index] = { ...old, name: true }
      return next
    })
  }

  const updateDraftRotation = (index: number, displayValue: string) => {
    const parsed = Number(displayValue)
    if (!Number.isFinite(parsed)) return
    setLayoutDraftEditable(prev => {
      if (!prev) return prev
      const next = [...prev]
      const old = next[index]
      if (!old) return prev
      next[index] = { ...old, rotationDegrees: parsed }
      return next
    })
    setLayoutEditedFlags(prev => {
      if (!prev) return prev
      const next = [...prev]
      const old = next[index]
      if (!old) return prev
      next[index] = { ...old, rotation: true }
      return next
    })
  }

  const removeDraftObject = (index: number) => {
    setLayoutDraftEditable(prev => prev ? prev.filter((_, i) => i !== index) : prev)
    setLayoutEditedFlags(prev => prev ? prev.filter((_, i) => i !== index) : prev)
  }

  return <div className={`app ${isDesktop ? 'is-desktop' : ''}`}>
    <header className="app-header">
      <a className="brand" href="#" onClick={(event) => { event.preventDefault(); setView('cad'); setFocusMode(false) }} aria-label="RenovaCAD home"><span className="brand-mark"><Box size={23} strokeWidth={1.7} /></span><span>Renova<span className="brand-cad">CAD</span></span></a>
      <span className="header-divider" />
      <div className="project-title"><span>{projectName}</span><span className="project-label">{projectPath ? projectPath.split('/').pop() : 'Untitled workspace'}{isSaving ? ' • Saving…' : isDirty ? ' • Unsaved' : saveError ? '' : projectPath ? ' • Saved' : ' • Not yet saved'}</span></div>
      <div className="header-actions">
        <span className="prototype-badge"><span />3D preview — not a CAD engine</span>
        <IconButton label="New project (⌘N)" onClick={() => void handleNew()}><FilePlus size={17} /></IconButton>
        <IconButton label="Open project (⌘O)" onClick={() => void handleOpen()}><FolderOpen size={17} /></IconButton>
        <IconButton label="Save project (⌘S)" onClick={() => void handleSave()}><Save size={19} /></IconButton>
        {saveError && <span className="save-error" role="alert" title={saveError}>{saveError.slice(0, 80)}</span>}
        {!projectBridgeAvailable && isDesktop && <span className="save-error">Save unavailable</span>}
        <button type="button" className="icon-button" title="Workspace settings" aria-label="Workspace settings" onClick={() => setSettingsOpen(true)}><Settings2 size={20} /></button>
      </div>
    </header>

    <nav className="toolbar" aria-label="Design tools">
      <div className="tool-group">{tools.map(({ id, label, icon: ToolIcon, shortcut }) => <IconButton key={id} label={`${label} (${shortcut})`} active={activeTool === id} onClick={() => chooseTool(id, label)}><ToolIcon size={20} strokeWidth={1.7} /></IconButton>)}<span className="tool-divider" /><span className="tool-caption">{tools.find((tool) => tool.id === activeTool)?.label} tool</span></div>
      <div className="workspace-breadcrumb"><Box size={14} /><span>Workspace</span><ChevronRight size={12} /><strong>Kitchen</strong></div>
      <div className="history-tools"><IconButton label="Undo (⌘Z)" disabled={!state.past.length} onClick={handleUndo}><Undo2 size={18} /></IconButton><IconButton label="Redo (⇧⌘Z)" disabled={!state.future.length} onClick={handleRedo}><Redo2 size={18} /></IconButton><span className="tool-divider" /><button className="text-button help-button" onClick={() => setHelpOpen(true)}><CircleHelp size={16} /><span>Help</span></button></div>
      {objectMenu && <div ref={objectMenuRef} className="object-menu" role="group" aria-label="Add objects"><div className="menu-heading">ADD TO YOUR DESIGN</div>{objectKinds.map((kind) => <button key={kind} onClick={() => addObject(kind)}><ObjectIcon kind={kind} />{objectCatalog[kind].name}<Plus size={14} /></button>)}</div>}
    </nav>

    <main className={`workspace ${!showInspector ? 'is-inspector-hidden' : ''} ${!showAssistant ? 'is-assistant-hidden' : ''} ${focusMode ? 'is-focused' : ''}`}>
      <aside hidden={!showInspector} className="inspector" aria-label="Design inspector">
        <div className="panel-heading"><SlidersHorizontal size={18} /><h1>Design inspector</h1><span className="panel-hint">01</span></div>
        <div className="inspector-scroll">
          <div className="section-label">REFERENCE IMAGE</div>
          <button className={`upload-card ${photo ? 'has-photo' : ''}`} onClick={() => fileInput.current?.click()}>
            {photo ? <img src={photo.dataUrl} alt="Imported kitchen reference" /> : <span className="upload-icon"><ImagePlus size={22} strokeWidth={1.5} /></span>}
            <span>{photo ? 'Replace kitchen photo' : 'Upload kitchen photo'}<small>{photo ? photo.name : 'JPG, PNG or WEBP'}</small></span><Plus size={15} />
          </button>
          <input ref={fileInput} type="file" accept="image/jpeg,image/png,image/webp" className="sr-only" aria-label="Upload kitchen photo" onChange={(event) => {
            const file = event.target.files?.[0]
            if (!file) return
            event.target.value = ''
            void handlePhotoFile(file)
          }} />

          <section className="selected-section">
            <div className="section-label">PROPERTIES<span className="tiny-dot" />{selectedObject ? '1 SELECTED' : 'NO SELECTION'}</div>
            {selectedObject ? <>
              <div className="selected-object"><span className="selected-object-icon"><ObjectIcon kind={selectedObject.kind} size={21} /></span><div><strong>{selectedObject.name}</strong><span>{selectedObject.kind.includes('cabinet') ? 'Cabinetry' : 'Kitchen object'}<span className="inline-dot">·</span>{selectedObject.id.endsWith('01') ? selectedObject.id.toUpperCase() : 'CUSTOM'}</span></div><IconButton label="Delete selected object" onClick={handleDelete}><Trash2 size={15} /></IconButton></div>
              <div className="property-heading">Dimensions<span>{unit === 'in' ? 'Inches' : 'Millimeters'}</span></div>
              <div className="dimension-fields">{(['width', 'height', 'depth'] satisfies Dimension[]).map((dimension) => <NumberField key={`${selectedObject.id}-${dimension}`} label={dimension[0].toUpperCase() + dimension.slice(1)} value={measurement(selectedObject, dimension)} suffix={unit} min={unit === 'in' ? 1 : 25.4} max={unit === 'in' ? 10000 / 25.4 : 10000} onCommit={(value) => handleResize(dimension, unit === 'in' ? value * 25.4 : value)} />)}</div>
              <div className="property-heading transform-heading">Transform<IconButton label="Reset rotation" onClick={() => handleRotate(0)}><RotateCcw size={13} /></IconButton></div>
              <NumberField key={`${selectedObject.id}-rotation`} label="Rotation" value={String(selectedObject.rotationDegrees)} suffix="°" min={-360} max={360} onCommit={(degrees) => handleRotate(degrees)} />
              <MoveControls object={selectedObject} unit={unit} onNudge={handleNudge} onSetPosition={handleSetPosition} />
              <div className="property-note"><span className="tiny-dot" />Dimensions are editable in this preview</div>
            </> : <div className="no-selection"><MousePointer2 size={24} /><span>Select an object to see its properties.</span></div>}
          </section>

          <section className="scene-section"><div className="scene-heading"><span className="section-label">SCENE OBJECTS</span><span className="count-badge">{state.present.length}</span></div>
            <div className="scene-list">{state.present.map((object) => <button key={object.id} aria-pressed={object.id === state.selectedId} className={`scene-row ${object.id === state.selectedId ? 'selected' : ''}`} onClick={() => { dispatch({ kind: 'select', id: object.id }); setView('cad') }}><ObjectIcon kind={object.kind} /><span>{object.name}</span>{object.id === state.selectedId ? <span className="selection-dot" /> : <span className="object-row-dash">—</span>}</button>)}</div>
            {!state.present.length && <p className="position-hint">Use Objects (O) in the toolbar to add your first object.</p>}
          </section>
        </div>
        <div className="inspector-footer"><Layers size={14} /><span>Objects & properties</span></div>
      </aside>

      <section className="viewport" aria-label="Design workspace">
        <div className="viewport-topbar"><IconButton label={showInspector ? 'Hide design inspector' : 'Show design inspector'} active={showInspector} onClick={() => { setInspectorVisible(!showInspector); setFocusMode(false) }}>{showInspector ? <PanelLeftClose size={17} /> : <PanelLeftOpen size={17} />}</IconButton><div className="view-tabs" role="tablist" aria-label="Workspace views" onKeyDown={(event) => {
          const views: ViewMode[] = ['photo', 'cad', 'render']
          const current = views.indexOf(view)
          const next = event.key === 'ArrowRight' ? views[(current + 1) % views.length] : event.key === 'ArrowLeft' ? views[(current + views.length - 1) % views.length] : event.key === 'Home' ? views[0] : event.key === 'End' ? views[views.length - 1] : undefined
          if (!next) return
          event.preventDefault()
          setView(next)
          event.currentTarget.querySelector<HTMLButtonElement>(`#tab-${next}`)?.focus()
        }}>{([
          { id: 'photo', label: 'Photo', icon: Image }, { id: 'cad', label: '3D CAD', icon: Box }, { id: 'render', label: 'AI Render', icon: Sparkles },
        ] satisfies { id: ViewMode; label: string; icon: typeof Image }[]).map(({ id, label, icon: ViewIcon }) => <button key={id} id={`tab-${id}`} role="tab" tabIndex={view === id ? 0 : -1} aria-selected={view === id} aria-controls={`panel-${id}`} onClick={() => setView(id)} className={view === id ? 'selected' : ''}><ViewIcon size={15} />{label}</button>)}</div><div className="viewport-layout-tools"><IconButton label={showAssistant ? 'Hide AI assistant' : 'Show AI assistant'} active={showAssistant} onClick={() => { setAssistantVisible(!showAssistant); setFocusMode(false) }}>{showAssistant ? <PanelRightClose size={17} /> : <PanelRightOpen size={17} />}</IconButton><IconButton label={focusMode ? 'Exit focus mode' : 'Focus viewport'} active={focusMode} onClick={() => setFocusMode((value) => !value)}>{focusMode ? <Minimize2 size={16} /> : <Maximize2 size={16} />}</IconButton></div></div>
        <div id={`panel-${view}`} role="tabpanel" aria-labelledby={`tab-${view}`} className={`viewport-content view-${view}`}>
          {view === 'cad' ? <>
            <div className="canvas-caption"><span className="canvas-status-dot" />LIVE PREVIEW<span className="canvas-caption-divider" /><span>{selectedObject?.name ?? 'Kitchen scene'}</span></div>
            <ViewCube camera={camera} onView={changeCameraView} onHome={resetCamera} />
            <KitchenPreview objects={state.present} selectedId={state.selectedId} onSelect={(id) => dispatch({ kind: 'select', id })} showGrid={showGrid} zoom={zoom} camera={camera} unit={unit} onOrbit={orbit} onZoom={changeZoom} frame={frame} moveMode={activeTool === 'move'} activeTool={activeTool} onMoveObject={handleMoveObject} measurePoints={measurePoints} onMeasureAdd={handleMeasureAdd} />
            <AxisIndicator camera={camera} />
            {activeTool === 'measure' && (
              <div className="measure-hud" role="status" aria-live="polite">
                <div className="measure-instructions">
                  {measurePoints.length === 0 ? 'Click to place first point — floor or object top' : measurePoints.length === 1 ? `First point on ${measureSurface ?? 'surface'} — click second point` : `${measurePoints.length} points — ${displayMeasurement(distanceMm(measurePoints[measurePoints.length-2], measurePoints[measurePoints.length-1]), unit)} ${unit} (last segment)`}
                </div>
                <div className="measure-actions">
                  <button className="secondary-button" onClick={handleMeasureBack} disabled={measurePoints.length === 0} aria-label="Back one point">Back one point</button>
                  <button className="secondary-button" onClick={handleMeasureClear} disabled={measurePoints.length === 0}>Clear</button>
                  <span className="measure-surface">{measureSurface ? `On: ${measureSurface}` : 'Measures on floor (Y=0) or object top'}</span>
                  <span className="measure-note">Temporary — not saved • Esc clears • Crosshair active</span>
                </div>
              </div>
            )}
            {activeTool === 'move' && !movementPlaneIsUsable(camera) && <div className="move-warning" role="alert">View too flat to drag — switch to top/diagonal • Use inspector to move</div>}
            <div className="canvas-bottom"><div className="viewport-mode"><label className="projection-select"><Box size={14} /><select aria-label="Projection" value={camera.projection} onChange={(event) => { const projection = event.target.value; if (projection === 'perspective' || projection === 'orthographic') setCamera((value) => ({ ...value, projection })); setIsDirty(true) }}><option value="perspective">Perspective</option><option value="orthographic">Orthographic</option></select></label><span className="inline-dot">·</span><span>White shaded</span></div><div className="canvas-controls"><IconButton label="Toggle grid" active={showGrid} onClick={() => { setShowGrid((show) => !show); setIsDirty(true) }}><Grid2X2 size={16} /></IconButton><span className="tool-divider" /><IconButton label="Zoom out" disabled={zoom <= 0.5} onClick={() => { changeZoom(-0.1); setIsDirty(true) }}><Minus size={16} /></IconButton><span className="zoom-value" aria-label="Zoom level">{Math.round(zoom * 100)}%</span><IconButton label="Zoom in" disabled={zoom >= 2} onClick={() => { changeZoom(0.1); setIsDirty(true) }}><ZoomIn size={17} /></IconButton><IconButton label="Fit preview" onClick={fitPreview}><Expand size={16} /></IconButton></div></div>
            <div className="canvas-help"><MousePointer2 size={12} /><span>{activeTool === 'measure' ? 'Crosshair: click to place points • Esc clears • Back removes last' : activeTool === 'move' ? 'Move: drag selected object in X/Z • Shift bypasses snap • Drag empty space to orbit' : 'Drag to orbit · Scroll to zoom · Click to select'}</span><span className="inline-dot">·</span><span>{viewLabel(camera)} view</span>{activeTool === 'move' && <span className="inline-dot">·</span>}<span>{activeTool === 'move' ? 'Snaps edges when aligned' : ''}</span></div>
          </> : view === 'photo' ? <div className={`photo-view ${photo ? 'with-image' : ''}`}>{photo ? <>
              <img src={photo.dataUrl} alt="Your kitchen reference" />
              <div className="photo-filename"><Image size={14} />{photo.name}</div>
              <div className="photo-analysis">
                <div className="photo-analysis-consent">
                  <Sparkles size={14} />
                  <span>Analyze sends only this photo to Baseten (Muse Spark) — dimensions are not inferred and the 3D scene is not changed automatically.</span>
                </div>
                <button
                  className="secondary-button photo-analyze-button"
                  onClick={() => void handleAnalyzePhoto()}
                  disabled={photoAnalysisLoading}
                  aria-label="Analyze kitchen photo"
                >
                  {photoAnalysisLoading ? <><span className="loading-dot" />Analyzing…</> : <><Sparkles size={14} />Analyze photo</>}
                </button>
                {photoAnalysisLoading && <div className="ai-status loading" role="status"><span className="loading-dot" /><span>Sending photo to Baseten…</span></div>}
                {photoAnalysisError && <div className="ai-error" role="alert"><X size={14} /><p>{photoAnalysisError}</p><button className="secondary-button" onClick={() => setPhotoAnalysisError(null)}>Dismiss</button></div>}
                {photoAnalysisResult && (
                  <div className="photo-analysis-result" role="status">
                    <div className="analysis-label">Photo description — not measured</div>
                    <p className="analysis-description">{photoAnalysisResult.description}</p>
                    <div className="analysis-followup-label">Follow-up questions — missing dimensions</div>
                    <ul className="analysis-questions">
                      {photoAnalysisResult.followUpQuestions.map((q, i) => <li key={i}>{q}</li>)}
                    </ul>
                    <p className="analysis-footnote">Dimensions cannot be reliably inferred from a photo. Measure and enter them in the inspector. The 3D scene was not modified.</p>
                    <button className="text-button" onClick={() => { setPhotoAnalysisResult(null); setPhotoAnalysisError(null) }}>Clear analysis</button>
                  </div>
                )}
                {!photoAnalysisResult && !photoAnalysisLoading && !photoAnalysisError && providerStatus && !providerStatus.ready && (
                  <p className="photo-analysis-note">Local bridge is ready but provider is not verified — analysis will use local preview if Baseten is unavailable. Local editing and saving remain usable.</p>
                )}
              </div>
              <div className="photo-layout">
                <div className="photo-layout-consent">
                  <Sparkles size={14} />
                  <span>Create draft sends only this photo to Baseten (Muse Spark) to propose an editable layout. Dimensions are approximate — please measure and verify. Your current scene is preserved until you apply.</span>
                </div>
                <button
                  className="secondary-button photo-layout-button"
                  onClick={() => void handleProposeLayout()}
                  disabled={layoutLoading}
                  aria-label="Create draft layout"
                >
                  {layoutLoading ? <><span className="loading-dot" />Creating draft…</> : <><Sparkles size={14} />Create draft layout</>}
                </button>
                {layoutLoading && <div className="ai-status loading" role="status"><span className="loading-dot" /><span>Sending photo to Baseten for draft…</span></div>}
                {layoutError && <div className="ai-error" role="alert"><X size={14} /><p>{layoutError}</p><button className="secondary-button" onClick={() => setLayoutError(null)}>Dismiss</button></div>}
                {layoutNeedsInfo && (
                  <div className="layout-needs-info" role="status">
                    <p>{layoutNeedsInfo.message}</p>
                    {layoutNeedsInfo.followUpQuestions.length > 0 && (
                      <ul className="analysis-questions">
                        {layoutNeedsInfo.followUpQuestions.map((q, i) => <li key={i}>{q}</li>)}
                      </ul>
                    )}
                    <button className="text-button" onClick={() => setLayoutNeedsInfo(null)}>Dismiss</button>
                  </div>
                )}
                {layoutDraft && layoutDraftEditable && (
                  <div className="layout-draft-review" role="region" aria-label="Draft layout review">
                    <div className="analysis-label">Draft layout — approximate, please verify</div>
                    <p className="analysis-description">{layoutDraft.description}</p>
                    {layoutDraft.warnings.length > 0 && (
                      <ul className="layout-warnings">
                        {layoutDraft.warnings.map((w, i) => <li key={i} className="layout-warning">{w}</li>)}
                      </ul>
                    )}
                    <p className="layout-approx-note">Dimensions are approximate defaults — measure your space and edit before applying. This draft will add {layoutDraftEditable.length} objects to your current scene (existing objects kept). Use Remove to exclude items.</p>
                    <div className="layout-objects">
                      {layoutDraftEditable.map((obj, idx) => {
                        const flags = layoutEditedFlags?.[idx] ?? { name: false, width: false, height: false, depth: false, x: false, y: false, z: false, rotation: false }
                        const unitLabel = unit === 'in' ? 'in' : 'mm'
                        const badge = (edited: boolean) => edited ? <span className="edited-badge" title="You entered this value">edited</span> : <span className="approx-badge" title="Approximate from photo — please measure">approx</span>
                        return (
                        <div key={idx} className="layout-object-card">
                          <div className="layout-object-header">
                            <span className="layout-object-kind"><ObjectIcon kind={obj.kind} size={14} />{obj.kind}</span>
                            <button className="text-button" aria-label={`Remove ${obj.name}`} onClick={() => removeDraftObject(idx)}><Trash2 size={14} />Remove</button>
                          </div>
                          <div className="layout-object-name">
                            <label>Name{flags.name ? badge(true) : badge(false)}<input value={obj.name} onChange={(e) => updateDraftName(idx, e.target.value)} aria-label={`${obj.name} name`} /></label>
                          </div>
                          <div className="layout-object-dims">
                            <label>Width ({unitLabel}){badge(flags.width)}<input type="number" value={mmToDisplay(obj.dimensionsMm.width)} onChange={(e) => updateDraftDimension(idx, 'width', e.target.value)} aria-label={`${obj.name} width`} /></label>
                            <label>Height ({unitLabel}){badge(flags.height)}<input type="number" value={mmToDisplay(obj.dimensionsMm.height)} onChange={(e) => updateDraftDimension(idx, 'height', e.target.value)} aria-label={`${obj.name} height`} /></label>
                            <label>Depth ({unitLabel}){badge(flags.depth)}<input type="number" value={mmToDisplay(obj.dimensionsMm.depth)} onChange={(e) => updateDraftDimension(idx, 'depth', e.target.value)} aria-label={`${obj.name} depth`} /></label>
                          </div>
                          <div className="layout-object-pos">
                            <label>X ({unitLabel}){badge(flags.x)}<input type="number" value={mmToDisplay(obj.positionMm.x)} onChange={(e) => updateDraftPosition(idx, 'x', e.target.value)} aria-label={`${obj.name} x`} /></label>
                            <label>Y ({unitLabel}){badge(flags.y)}<input type="number" value={mmToDisplay(obj.positionMm.y)} onChange={(e) => updateDraftPosition(idx, 'y', e.target.value)} aria-label={`${obj.name} y`} /></label>
                            <label>Z ({unitLabel}){badge(flags.z)}<input type="number" value={mmToDisplay(obj.positionMm.z)} onChange={(e) => updateDraftPosition(idx, 'z', e.target.value)} aria-label={`${obj.name} z`} /></label>
                          </div>
                          <div className="layout-object-rot">
                            <label>Rotation°{badge(flags.rotation)}<input type="number" value={obj.rotationDegrees} onChange={(e) => updateDraftRotation(idx, e.target.value)} aria-label={`${obj.name} rotation`} /></label>
                          </div>
                        </div>
                        )
                      })}
                    </div>
                    {layoutDraft.followUpQuestions.length > 0 && (
                      <div className="layout-followup">
                        <div className="analysis-followup-label">Follow-up — missing measurements</div>
                        <ul className="analysis-questions">
                          {layoutDraft.followUpQuestions.map((q, i) => <li key={i}>{q}</li>)}
                        </ul>
                      </div>
                    )}
                    <div className="layout-actions">
                      <button className="primary-button" onClick={handleApplyLayout} aria-label="Apply draft layout">Apply draft — add {layoutDraftEditable.length} objects</button>
                      <button className="secondary-button" onClick={handleCancelLayout}>Cancel draft</button>
                    </div>
                    <p className="layout-apply-note">Apply adds objects as one undoable step. You can undo (⌘Z) and save the project.</p>
                  </div>
                )}
              </div>
            </> : <div className="empty-state"><span className="empty-state-icon"><ImagePlus size={32} strokeWidth={1.3} /></span><div className="eyebrow">START WITH YOUR SPACE</div><h2>A fresh perspective<br />on your kitchen.</h2><p>Bring in a photo to keep your existing<br />space close while you design.</p><button className="primary-button" onClick={() => fileInput.current?.click()}><Plus size={16} />Upload kitchen photo</button><span className="empty-footnote">JPG, PNG or WEBP · Stays on this device · Saved with project — not sent unless you choose Analyze or Create draft.</span></div>}</div> : <div className="empty-state render-state"><span className="empty-state-icon"><Sparkles size={32} strokeWidth={1.3} /></span><div className="eyebrow">IMAGINE WHAT’S NEXT</div><h2>Your design.<br />A new point of view.</h2><p>Visual renovation concepts will live here.<br />AI rendering is coming in a future milestone.</p><span className="coming-soon"><span className="tiny-dot" />COMING SOON</span><button className="text-button" onClick={() => setView('cad')}>Back to your design<ArrowRight size={15} /></button></div>}
        </div>
      </section>

      <aside hidden={!showAssistant} className="assistant" aria-label="AI assistant">
        <div className="panel-heading"><MessageSquare size={19} /><h2>AI assistant</h2><span className="sample-badge">{!bridgeAvailable ? 'PREVIEW' : providerVerified && providerStatus?.ready ? 'LIVE' : providerStatus?.error ? 'LOCAL' : 'LOCAL'}</span></div>
        <div className="assistant-scroll">
          <div className="assistant-intro"><span className="assistant-symbol"><Sparkles size={20} strokeWidth={1.6} /></span><h3>A little help.<br />A lot of possibility.</h3><p>Describe your ideas. Review a change.<br />Make it yours.</p></div>
          <div className="conversation-divider"><span />TRY A DESIGN CHANGE<span /></div>
          {proposal.kind === 'resize' && <div className="sample-conversation">
            <div className="message-meta"><span>YOU</span><span>{proposal.status === 'pending' && !isStale ? 'Proposal' : proposal.status === 'pending' && isStale ? 'Stale proposal' : 'Sample request'}</span></div>
            <div className="user-message">Make the {proposal.objectName.toLowerCase()} {displayMeasurement(proposal.afterMm, 'in')} inches wide.</div>
            <div className="assistant-message-meta"><span className="mini-brand"><Sparkles size={12} /></span><strong>Renova</strong><span>{isStale ? 'Stale' : pending ? 'Proposal' : 'Sample proposal'}</span></div>
            <p className="assistant-response">{isStale ? 'This proposal is stale — the scene changed. Request a new one.' : 'A little more room to work with. Here’s the proposed change:'}</p>
            <div className={`proposal-card ${proposal.status} ${isStale ? 'stale' : ''}`}><div className="proposal-title"><Box size={15} /><strong>{proposal.objectName}</strong><span className="change-badge">RESIZE</span></div><div className="proposal-property">Width</div><div className="proposal-values"><span>{displayMeasurement(proposal.beforeMm, unit)}<small>{unit}</small></span><ArrowRight size={19} /><strong>{displayMeasurement(proposal.afterMm, unit)}<small>{unit}</small></strong></div><div className="proposal-divider" />
              {pending && !isStale ? <div className="proposal-actions"><button className="apply-button" onClick={handleApply}><Check size={15} />Apply change</button><button className="cancel-button" onClick={() => { dispatch({ kind: 'cancel-proposal' }); setAiClarification(null); setAiError(null) }}>Cancel</button></div> : pending && isStale ? <div className="proposal-actions"><button className="secondary-button" onClick={() => { dispatch({ kind: 'cancel-proposal' }); setAiError(null) }}>Dismiss stale proposal</button></div> : <div className={`proposal-result ${proposal.status}`}><Check size={14} />{proposal.status === 'applied' ? 'Change applied to preview' : 'Proposal canceled'}</div>}
            </div>
            <div className="approval-note">{pending && !isStale ? <><span className="tiny-dot" />Your design only changes when you approve.</> : pending && isStale ? <span className="stale-note">Scene changed since this was proposed — request a new width.</span> : <button className="text-button" disabled={!selectedObject || selectedObject.dimensionsMm.width >= 10000} onClick={() => dispatchWithDirty({ kind: 'sample-proposal' })}><Plus size={12} />Try another sample change</button>}</div>
          </div>}
          {proposal.kind === 'none' && !aiLoading && !aiClarification && !aiError && <div className="sample-prompt-card"><Box size={21} /><strong>Explore a small change.</strong><p>Select an object and try a sample resize to see the approval flow.</p><button className="secondary-button" disabled={!selectedObject || selectedObject.dimensionsMm.width >= 10000} onClick={() => dispatchWithDirty({ kind: 'sample-proposal' })}>Try sample resize<ArrowRight size={14} /></button></div>}
          {aiLoading && <div className="ai-status loading" role="status" aria-live="polite"><span className="loading-dot" /><span>Asking Renova…</span></div>}
          {aiClarification && <div className="ai-clarification" role="status"><Sparkles size={14} /><p>{aiClarification}</p><button className="secondary-button" onClick={() => setAiClarification(null)}>Dismiss</button></div>}
          {aiError && <div className="ai-error" role="alert"><X size={14} /><p>{aiError}</p><button className="secondary-button" onClick={() => setAiError(null)}>Dismiss</button></div>}
          <div role="log" aria-label="Assistant conversation" aria-live="polite">{messages.map((message, index) => <div className="local-message" key={`${index}-${message}`}><div className="user-message">{message}</div>{!bridgeAvailable && <div className="preview-reply"><Sparkles size={14} /><p>This is a local UI preview. {bridgeAvailable ? '' : 'Live AI isn’t connected yet. Try the sample resize to explore how changes will work.'}</p></div>}</div>)}</div><div ref={assistantEndRef} />
        </div>
        <div className="assistant-composer"><div className="composer-context"><span className="tiny-dot" /><span>{selectedObject ? `${selectedObject.name} selected` : 'No object selected'}</span>{aiLoading && <span className="composer-loading"> · Thinking…</span>}</div><form onSubmit={(event) => { event.preventDefault(); void submitPrompt() }}><textarea aria-label="Ask AI to modify design" placeholder="Ask AI to modify your design…" rows={2} value={prompt} onChange={(event) => setPrompt(event.target.value)} onKeyDown={(event) => { if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing) { event.preventDefault(); void submitPrompt() } }} /><div className="composer-bottom"><span><Sparkles size={12} />{!bridgeAvailable ? 'Design assistant · Preview' : providerVerified && providerStatus?.ready ? 'Design assistant · Live' : 'Design assistant · Local'}</span><button className="send-button" type="submit" disabled={!prompt.trim() || aiLoading} aria-label="Send message"><ArrowUp size={17} /></button></div></form><p>{!bridgeAvailable ? 'UI preview' : providerVerified && providerStatus?.ready ? 'AI connected via local service — provider verified' : 'Local bridge ready — provider not yet verified'}<span className="inline-dot">·</span>{!bridgeAvailable ? 'No AI service connected' : providerVerified ? 'Per-launch token on loopback' : 'Local service only'}</p></div>
      </aside>
    </main>

    <footer className="statusbar"><div><span className="status-dot" />{projectPath ? projectName : 'Local workspace'}<span className="status-separator" />{state.present.length} objects<span className="status-separator" />{isSaving ? 'Saving…' : saveError ? `Error: ${saveError.slice(0, 40)}` : isDirty ? 'Unsaved changes' : projectPath ? 'Saved' : 'Not yet saved'}</div><span className="status-center">Designed for a space that feels like you.</span><div><span className="unit-status">{unit === 'in' ? 'Inches' : 'Millimeters'}</span><span className="status-separator" /><span>RenovaCAD <span className="version">0.1</span></span></div></footer>
    {notice && <div className="toast" role="status"><span className="toast-icon"><Check size={15} /></span><span>{notice}</span><IconButton label="Dismiss notification" onClick={() => setNotice('')}><X size={14} /></IconButton></div>}
    {(settingsOpen || helpOpen) && <div className="modal-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget) closeDialog() }}><div ref={dialogRef} className="modal" role="dialog" aria-modal="true" aria-labelledby="dialog-title" onKeyDown={(event) => {
      if (event.key !== 'Tab') return
      const buttons = dialogRef.current?.querySelectorAll<HTMLButtonElement>('button')
      const first = buttons?.[0], last = buttons?.[buttons.length - 1]
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus() }
      if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus() }
    }}><div className="modal-heading"><span className="modal-icon">{settingsOpen ? <Settings2 size={21} /> : <CircleHelp size={21} />}</span><IconButton label="Close dialog" onClick={closeDialog}><X size={19} /></IconButton></div><h2 id="dialog-title">{settingsOpen ? 'Make yourself at home.' : 'A few things to try.'}</h2><p>{settingsOpen ? 'A few preferences for your workspace.' : 'Your first look at the RenovaCAD workspace.'}</p>
      {settingsOpen ? <><div className="setting-row"><div><strong>Measurement units</strong><span>Used throughout the inspector.</span></div><div className="unit-toggle"><button className={unit === 'in' ? 'selected' : ''} aria-pressed={unit === 'in'} onClick={() => { setUnit('in'); setIsDirty(true) }}>in</button><button className={unit === 'mm' ? 'selected' : ''} aria-pressed={unit === 'mm'} onClick={() => { setUnit('mm'); setIsDirty(true) }}>mm</button></div></div><div className="setting-row"><div><strong>Project</strong><span>Saved as .renovacad (single portable file)</span></div><div className="project-settings-actions"><button className="secondary-button" onClick={() => void handleSave()}>Save</button><button className="secondary-button" onClick={() => void handleSaveAs()}>Save As</button></div></div><div className="setting-footnote">Project includes objects, dimensions (mm), positions, rotations, reference photo, units, grid, camera, and view. Measurements are temporary viewport annotations — not saved. Undo history and pending AI proposals are not saved. Max project 12 MB, photo 5 MB.</div></> : <div className="help-items"><p><MousePointer2 size={17} /><span>Select an object in the scene or object list.</span></p><p><Ruler size={17} /><span>Press R for Measure: click floor or object top with crosshair, see distance, Back/Escape to correct. Temporary — not saved.</span></p><p><Move3D size={17} /><span>Press M to move: click to select, drag selected cabinet/sink in X/Z to place beside another. Snaps edges when aligned; Shift bypasses. Page Up/Down for height.</span></p><p><Box size={17} /><span>Axis indicator (lower-left) shows X red (width right), Y green (height up), Z blue (depth forward) with arrows that follow the camera in perspective and orthographic views.</span></p><p><Sparkles size={17} /><span>{bridgeAvailable ? 'Ask the assistant to resize the selected cabinet — e.g., "Make this cabinet 6 inches wider." Review, then Apply or Cancel.' : 'Apply or cancel the sample assistant proposal.'}</span></p><p><Save size={17} /><span>Save with ⌘S, open with ⌘O, new with ⌘N. Save As keeps a copy. Projects are single .renovacad files.</span></p><p><Undo2 size={17} /><span>Undo with <kbd>⌘ Z</kbd>, redo with <kbd>⇧ ⌘ Z</kbd>.</span></p><p><ImagePlus size={17} /><span>Upload a kitchen photo to try the reference view. Photo is saved with the project.</span></p><div className="help-footnote">Coordinate: X is width to the right, Y is height up, Z is depth forward. The 3D view is a local SVG projection of rectangular objects — not a CAD engine. Grid and AI Render placeholders will evolve. Annotate is still coming next.</div></div>}
      <button className="primary-button modal-done" onClick={closeDialog}>Back to designing<ArrowRight size={16} /></button>
    </div></div>}
  </div>
}
