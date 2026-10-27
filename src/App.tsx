import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react'
import {
  ArrowDown, ArrowLeft, ArrowRight, ArrowUp, Box, Check, ChevronRight, CircleHelp,
  Expand, Grid2X2, Image, ImagePlus, Layers, MessageSquare, Minus,
  Maximize2, Minimize2, MousePointer2, Move3D, PanelLeftClose, PanelLeftOpen, PanelRightClose, PanelRightOpen, Pencil, Plus, Redo2, RotateCcw, Ruler, Save,
  Settings2, SlidersHorizontal, Sparkles, Trash2, Undo2, X, ZoomIn,
} from 'lucide-react'
import { KitchenPreview } from './components/KitchenPreview'
import { ViewCube } from './components/ViewCube'
import { cameraForView, orbitCamera, viewLabel, type Camera, type CameraView } from './viewport'
import { displayMeasurement, objectCatalog, useWorkspace, type Dimension, type ObjectKind, type SceneObject, type Unit, type ViewMode } from './workspace'

const tools = [
  { id: 'select', label: 'Select', icon: MousePointer2, shortcut: 'V' },
  { id: 'move', label: 'Move', icon: Move3D, shortcut: 'M' },
  { id: 'measure', label: 'Measure', icon: Ruler, shortcut: 'R' },
  { id: 'objects', label: 'Objects', icon: Box, shortcut: 'O' },
  { id: 'annotate', label: 'Annotate', icon: Pencil, shortcut: 'A' },
]
const objectKinds = ['base-cabinet', 'wall-cabinet', 'tall-cabinet', 'wall', 'sink'] satisfies ObjectKind[]

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
  const [camera, setCamera] = useState<Camera>(() => cameraForView('isometric', 'perspective'))
  const [focusMode, setFocusMode] = useState(false)
  const [inspectorVisible, setInspectorVisible] = useState(true)
  const [assistantVisible, setAssistantVisible] = useState(true)
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [helpOpen, setHelpOpen] = useState(false)
  const [objectMenu, setObjectMenu] = useState(false)
  const [notice, setNotice] = useState('')
  const [prompt, setPrompt] = useState('')
  const [messages, setMessages] = useState<string[]>([])
  const [photo, setPhoto] = useState<{ url: string; name: string } | null>(null)
  const fileInput = useRef<HTMLInputElement>(null)
  const dialogRef = useRef<HTMLDivElement>(null)
  const objectMenuRef = useRef<HTMLDivElement>(null)
  const assistantEndRef = useRef<HTMLDivElement>(null)
  const isDesktop = navigator.userAgent.includes('Electron')
  const showInspector = inspectorVisible && !focusMode
  const showAssistant = assistantVisible && !focusMode
  const chooseTool = useCallback((id: string, label: string) => {
    setActiveTool(id)
    if (id === 'objects') setObjectMenu((open) => !open)
    else { setObjectMenu(false); if (id !== 'select') setNotice(`${label} controls will be connected with the 3D editor.`) }
  }, [])
  const changeZoom = useCallback((delta: number) => setZoom((value) => Math.round(Math.min(2, Math.max(0.5, value + delta)) * 100) / 100), [])
  const orbit = useCallback((dx: number, dy: number) => setCamera((value) => orbitCamera(value, dx, dy)), [])
  const changeCameraView = (preset: CameraView) => setCamera((value) => cameraForView(preset, value.projection))
  const resetCamera = () => { setCamera(cameraForView('isometric', 'perspective')); setZoom(1) }

  const notify = (message: string) => setNotice(message)
  useEffect(() => {
    if (!notice) return
    const timer = window.setTimeout(() => setNotice(''), 4200)
    return () => window.clearTimeout(timer)
  }, [notice])
  useEffect(() => () => { if (photo) URL.revokeObjectURL(photo.url) }, [photo])
  useEffect(() => { if (messages.length && showAssistant) assistantEndRef.current?.scrollIntoView({ block: 'nearest', behavior: 'auto' }) }, [messages.length, showAssistant])
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
  useEffect(() => {
    const handleKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setSettingsOpen(false); setHelpOpen(false); setObjectMenu(false)
        if (!settingsOpen && !helpOpen && !objectMenu) setFocusMode(false)
        return
      }
      if (settingsOpen || helpOpen) return
      const target = event.target
      if (target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement) return
      if (target instanceof HTMLElement && (target.tagName === 'SELECT' || target.isContentEditable)) return
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'z') {
        event.preventDefault()
        dispatch({ kind: event.shiftKey ? 'redo' : 'undo' })
      } else if (event.key === 'Delete' || event.key === 'Backspace') {
        event.preventDefault()
        dispatch({ kind: 'delete' })
      } else if (!event.metaKey && !event.ctrlKey && !event.altKey) {
        const tool = tools.find((item) => item.shortcut.toLowerCase() === event.key.toLowerCase())
        if (tool) { event.preventDefault(); chooseTool(tool.id, tool.label) }
      }
    }
    window.addEventListener('keydown', handleKey)
    return () => window.removeEventListener('keydown', handleKey)
  }, [dispatch, settingsOpen, helpOpen, objectMenu, chooseTool])

  const addObject = (kind: ObjectKind) => {
    dispatch({ kind: 'add', objectKind: kind, id: crypto.randomUUID() })
    setObjectMenu(false)
    setView('cad')
    notify(`${objectCatalog[kind].name} added to your preview.`)
  }
  const submitPrompt = () => {
    if (!prompt.trim()) return
    setMessages((items) => [...items, prompt.trim()])
    setPrompt('')
  }
  const measurement = (object: SceneObject, dimension: Dimension) => displayMeasurement(object.dimensionsMm[dimension], unit)
  const proposal = state.proposal
  const pending = proposal.kind === 'resize' && proposal.status === 'pending'
  const closeDialog = () => { setSettingsOpen(false); setHelpOpen(false) }

  return <div className={`app ${isDesktop ? 'is-desktop' : ''}`}>
    <header className="app-header">
      <a className="brand" href="#" onClick={(event) => { event.preventDefault(); setView('cad'); resetCamera(); setFocusMode(false) }} aria-label="RenovaCAD home"><span className="brand-mark"><Box size={23} strokeWidth={1.7} /></span><span>Renova<span className="brand-cad">CAD</span></span></a>
      <span className="header-divider" />
      <div className="project-title"><span>Kitchen Remodel Project</span><span className="project-label">Untitled workspace</span></div>
      <div className="header-actions"><span className="prototype-badge"><span />UI preview</span><IconButton label="Save project" onClick={() => notify('Project saving will be added in the next milestone. This preview stays in memory.')}><Save size={19} /></IconButton>
        <button type="button" className="icon-button" title="Workspace settings" aria-label="Workspace settings" onClick={() => setSettingsOpen(true)}><Settings2 size={20} /></button></div>
    </header>

    <nav className="toolbar" aria-label="Design tools">
      <div className="tool-group">{tools.map(({ id, label, icon: ToolIcon, shortcut }) => <IconButton key={id} label={`${label} (${shortcut})`} active={activeTool === id} onClick={() => chooseTool(id, label)}><ToolIcon size={20} strokeWidth={1.7} /></IconButton>)}<span className="tool-divider" /><span className="tool-caption">{tools.find((tool) => tool.id === activeTool)?.label} tool</span></div>
      <div className="workspace-breadcrumb"><Box size={14} /><span>Workspace</span><ChevronRight size={12} /><strong>Kitchen</strong></div>
      <div className="history-tools"><IconButton label="Undo (⌘Z)" disabled={!state.past.length} onClick={() => dispatch({ kind: 'undo' })}><Undo2 size={18} /></IconButton><IconButton label="Redo (⇧⌘Z)" disabled={!state.future.length} onClick={() => dispatch({ kind: 'redo' })}><Redo2 size={18} /></IconButton><span className="tool-divider" /><button className="text-button help-button" onClick={() => setHelpOpen(true)}><CircleHelp size={16} /><span>Help</span></button></div>
      {objectMenu && <div ref={objectMenuRef} className="object-menu" role="group" aria-label="Add objects"><div className="menu-heading">ADD TO YOUR DESIGN</div>{objectKinds.map((kind) => <button key={kind} onClick={() => addObject(kind)}><ObjectIcon kind={kind} />{objectCatalog[kind].name}<Plus size={14} /></button>)}</div>}
    </nav>

    <main className={`workspace ${!showInspector ? 'is-inspector-hidden' : ''} ${!showAssistant ? 'is-assistant-hidden' : ''} ${focusMode ? 'is-focused' : ''}`}>
      <aside hidden={!showInspector} className="inspector" aria-label="Design inspector">
        <div className="panel-heading"><SlidersHorizontal size={18} /><h1>Design inspector</h1><span className="panel-hint">01</span></div>
        <div className="inspector-scroll">
          <div className="section-label">REFERENCE IMAGE</div>
          <button className={`upload-card ${photo ? 'has-photo' : ''}`} onClick={() => fileInput.current?.click()}>
            {photo ? <img src={photo.url} alt="Imported kitchen reference" /> : <span className="upload-icon"><ImagePlus size={22} strokeWidth={1.5} /></span>}
            <span>{photo ? 'Replace kitchen photo' : 'Upload kitchen photo'}<small>{photo ? photo.name : 'JPG, PNG or WEBP'}</small></span><Plus size={15} />
          </button>
          <input ref={fileInput} type="file" accept="image/jpeg,image/png,image/webp" className="sr-only" aria-label="Upload kitchen photo" onChange={(event) => {
            const file = event.target.files?.[0]
            if (!file) return
            event.target.value = ''
            if (!['image/jpeg', 'image/png', 'image/webp'].includes(file.type)) { notify('Choose a JPG, PNG, or WEBP image.'); return }
            setPhoto({ url: URL.createObjectURL(file), name: file.name }); setView('photo')
          }} />
          <section className="add-section"><div className="section-label">ADD OBJECTS</div><div className="add-buttons"><button onClick={() => addObject('base-cabinet')}><Box size={15} />Cabinet</button><button onClick={() => addObject('wall')}><Layers size={15} />Wall</button><button onClick={() => addObject('sink')}><span className="sink-icon" />Sink</button></div></section>

          <section className="selected-section">
            <div className="section-label">PROPERTIES<span className="tiny-dot" />{selectedObject ? '1 SELECTED' : 'NO SELECTION'}</div>
            {selectedObject ? <>
              <div className="selected-object"><span className="selected-object-icon"><ObjectIcon kind={selectedObject.kind} size={21} /></span><div><strong>{selectedObject.name}</strong><span>{selectedObject.kind.includes('cabinet') ? 'Cabinetry' : 'Kitchen object'}<span className="inline-dot">·</span>{selectedObject.id.endsWith('01') ? selectedObject.id.toUpperCase() : 'CUSTOM'}</span></div><IconButton label="Delete selected object" onClick={() => dispatch({ kind: 'delete' })}><Trash2 size={15} /></IconButton></div>
              <div className="property-heading">Dimensions<span>{unit === 'in' ? 'Inches' : 'Millimeters'}</span></div>
              <div className="dimension-fields">{(['width', 'height', 'depth'] satisfies Dimension[]).map((dimension) => <NumberField key={`${selectedObject.id}-${dimension}`} label={dimension[0].toUpperCase() + dimension.slice(1)} value={measurement(selectedObject, dimension)} suffix={unit} min={unit === 'in' ? 1 : 25.4} max={unit === 'in' ? 10000 / 25.4 : 10000} onCommit={(value) => dispatch({ kind: 'resize', dimension, valueMm: unit === 'in' ? value * 25.4 : value })} />)}</div>
              <div className="property-heading transform-heading">Transform<IconButton label="Reset rotation" onClick={() => dispatch({ kind: 'rotate', degrees: 0 })}><RotateCcw size={13} /></IconButton></div>
              <NumberField key={`${selectedObject.id}-rotation`} label="Rotation" value={String(selectedObject.rotationDegrees)} suffix="°" min={-360} max={360} onCommit={(degrees) => dispatch({ kind: 'rotate', degrees })} />
              <div className="property-note"><span className="tiny-dot" />Dimensions are editable in this preview</div>
            </> : <div className="no-selection"><MousePointer2 size={24} /><span>Select an object to see its properties.</span></div>}
          </section>

          <section className="scene-section"><div className="scene-heading"><span className="section-label">SCENE OBJECTS</span><span className="count-badge">{state.present.length}</span><IconButton label="Add object" onClick={() => setObjectMenu((open) => !open)}><Plus size={15} /></IconButton></div>
            <div className="scene-list">{state.present.map((object) => <button key={object.id} aria-pressed={object.id === state.selectedId} className={`scene-row ${object.id === state.selectedId ? 'selected' : ''}`} onClick={() => { dispatch({ kind: 'select', id: object.id }); setView('cad') }}><ObjectIcon kind={object.kind} /><span>{object.name}</span>{object.id === state.selectedId ? <span className="selection-dot" /> : <span className="object-row-dash">—</span>}</button>)}</div>
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
            <ViewCube camera={camera} onView={changeCameraView} onReset={resetCamera} />
            <KitchenPreview objects={state.present} selectedId={state.selectedId} onSelect={(id) => dispatch({ kind: 'select', id })} showGrid={showGrid} zoom={zoom} camera={camera} unit={unit} onOrbit={orbit} onZoom={changeZoom} />
            <div className="canvas-bottom"><div className="viewport-mode"><label className="projection-select"><Box size={14} /><select aria-label="Projection" value={camera.projection} onChange={(event) => { const projection = event.target.value; if (projection === 'perspective' || projection === 'orthographic') setCamera((value) => ({ ...value, projection })) }}><option value="perspective">Perspective</option><option value="orthographic">Orthographic</option></select></label><span className="inline-dot">·</span><span>White shaded</span></div><div className="canvas-controls"><IconButton label="Toggle grid" active={showGrid} onClick={() => setShowGrid((show) => !show)}><Grid2X2 size={16} /></IconButton><span className="tool-divider" /><IconButton label="Zoom out" disabled={zoom <= 0.5} onClick={() => changeZoom(-0.1)}><Minus size={16} /></IconButton><button className="zoom-value" aria-label="Reset zoom" onClick={() => setZoom(1)}>{Math.round(zoom * 100)}%</button><IconButton label="Zoom in" disabled={zoom >= 2} onClick={() => changeZoom(0.1)}><ZoomIn size={17} /></IconButton><IconButton label="Fit preview" onClick={() => setZoom(1)}><Expand size={16} /></IconButton></div></div>
            <div className="orbit-controls" role="group" aria-label="Orbit camera"><IconButton label="Orbit left" onClick={() => orbit(45, 0)}><ArrowLeft size={13} /></IconButton><IconButton label="Orbit up" onClick={() => orbit(0, 35)}><ArrowUp size={13} /></IconButton><IconButton label="Orbit down" onClick={() => orbit(0, -35)}><ArrowDown size={13} /></IconButton><IconButton label="Orbit right" onClick={() => orbit(-45, 0)}><ArrowRight size={13} /></IconButton></div>
            <div className="canvas-help"><MousePointer2 size={12} /><span>Drag to orbit · Scroll to zoom · Click to select</span><span className="inline-dot">·</span><span>{viewLabel(camera)} view</span></div>
          </> : view === 'photo' ? <div className={`photo-view ${photo ? 'with-image' : ''}`}>{photo ? <><img src={photo.url} alt="Your kitchen reference" /><div className="photo-filename"><Image size={14} />{photo.name}</div></> : <div className="empty-state"><span className="empty-state-icon"><ImagePlus size={32} strokeWidth={1.3} /></span><div className="eyebrow">START WITH YOUR SPACE</div><h2>A fresh perspective<br />on your kitchen.</h2><p>Bring in a photo to keep your existing<br />space close while you design.</p><button className="primary-button" onClick={() => fileInput.current?.click()}><Plus size={16} />Upload kitchen photo</button><span className="empty-footnote">JPG, PNG or WEBP · Stays on this device</span></div>}</div> : <div className="empty-state render-state"><span className="empty-state-icon"><Sparkles size={32} strokeWidth={1.3} /></span><div className="eyebrow">IMAGINE WHAT’S NEXT</div><h2>Your design.<br />A new point of view.</h2><p>Visual renovation concepts will live here.<br />AI rendering is coming in a future milestone.</p><span className="coming-soon"><span className="tiny-dot" />COMING SOON</span><button className="text-button" onClick={() => setView('cad')}>Back to your design<ArrowRight size={15} /></button></div>}
        </div>
      </section>

      <aside hidden={!showAssistant} className="assistant" aria-label="AI assistant">
        <div className="panel-heading"><MessageSquare size={19} /><h2>AI assistant</h2><span className="sample-badge">PREVIEW</span></div>
        <div className="assistant-scroll">
          <div className="assistant-intro"><span className="assistant-symbol"><Sparkles size={20} strokeWidth={1.6} /></span><h3>A little help.<br />A lot of possibility.</h3><p>Describe your ideas. Review a change.<br />Make it yours.</p></div>
          <div className="conversation-divider"><span />TRY A DESIGN CHANGE<span /></div>
          {proposal.kind === 'resize' && <div className="sample-conversation">
            <div className="message-meta"><span>YOU</span><span>Sample request</span></div>
            <div className="user-message">Make the {proposal.objectName.toLowerCase()} {displayMeasurement(proposal.afterMm, 'in')} inches wide.</div>
            <div className="assistant-message-meta"><span className="mini-brand"><Sparkles size={12} /></span><strong>Renova</strong><span>Sample proposal</span></div>
            <p className="assistant-response">A little more room to work with. Here’s the proposed change:</p>
            <div className={`proposal-card ${proposal.status}`}><div className="proposal-title"><Box size={15} /><strong>{proposal.objectName}</strong><span className="change-badge">RESIZE</span></div><div className="proposal-property">Width</div><div className="proposal-values"><span>{displayMeasurement(proposal.beforeMm, unit)}<small>{unit}</small></span><ArrowRight size={19} /><strong>{displayMeasurement(proposal.afterMm, unit)}<small>{unit}</small></strong></div><div className="proposal-divider" />
              {pending ? <div className="proposal-actions"><button className="apply-button" onClick={() => { dispatch({ kind: 'apply-proposal' }); notify('Sample change applied. You can undo it anytime.') }}><Check size={15} />Apply change</button><button className="cancel-button" onClick={() => dispatch({ kind: 'cancel-proposal' })}>Cancel</button></div> : <div className={`proposal-result ${proposal.status}`}><Check size={14} />{proposal.status === 'applied' ? 'Change applied to preview' : 'Proposal canceled'}</div>}
            </div>
            <div className="approval-note">{pending ? <><span className="tiny-dot" />Your design only changes when you approve.</> : <button className="text-button" disabled={!selectedObject || selectedObject.dimensionsMm.width >= 10000} onClick={() => dispatch({ kind: 'sample-proposal' })}><Plus size={12} />Try another sample change</button>}</div>
          </div>}
          {proposal.kind === 'none' && <div className="sample-prompt-card"><Box size={21} /><strong>Explore a small change.</strong><p>Select an object and try a sample resize to see the approval flow.</p><button className="secondary-button" disabled={!selectedObject || selectedObject.dimensionsMm.width >= 10000} onClick={() => dispatch({ kind: 'sample-proposal' })}>Try sample resize<ArrowRight size={14} /></button></div>}
          <div role="log" aria-label="Assistant conversation" aria-live="polite">{messages.map((message, index) => <div className="local-message" key={`${index}-${message}`}><div className="user-message">{message}</div><div className="preview-reply"><Sparkles size={14} /><p>This is a local UI preview. Live AI isn’t connected yet. Try the sample resize to explore how changes will work.</p></div></div>)}</div><div ref={assistantEndRef} />
        </div>
        <div className="assistant-composer"><div className="composer-context"><span className="tiny-dot" /><span>{selectedObject ? `${selectedObject.name} selected` : 'No object selected'}</span></div><form onSubmit={(event) => { event.preventDefault(); submitPrompt() }}><textarea aria-label="Ask AI to modify design" placeholder="Ask AI to modify your design…" rows={2} value={prompt} onChange={(event) => setPrompt(event.target.value)} onKeyDown={(event) => { if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing) { event.preventDefault(); submitPrompt() } }} /><div className="composer-bottom"><span><Sparkles size={12} />Design assistant</span><button className="send-button" type="submit" disabled={!prompt.trim()} aria-label="Send message"><ArrowUp size={17} /></button></div></form><p>UI preview<span className="inline-dot">·</span>No AI service connected</p></div>
      </aside>
    </main>

    <footer className="statusbar"><div><span className="status-dot" />Local workspace<span className="status-separator" />{state.present.length} objects</div><span className="status-center">Designed for a space that feels like you.</span><div><span className="unit-status">{unit === 'in' ? 'Inches' : 'Millimeters'}</span><span className="status-separator" /><span>RenovaCAD <span className="version">0.1</span></span></div></footer>
    {notice && <div className="toast" role="status"><span className="toast-icon"><Check size={15} /></span><span>{notice}</span><IconButton label="Dismiss notification" onClick={() => setNotice('')}><X size={14} /></IconButton></div>}
    {(settingsOpen || helpOpen) && <div className="modal-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget) closeDialog() }}><div ref={dialogRef} className="modal" role="dialog" aria-modal="true" aria-labelledby="dialog-title" onKeyDown={(event) => {
      if (event.key !== 'Tab') return
      const buttons = dialogRef.current?.querySelectorAll<HTMLButtonElement>('button')
      const first = buttons?.[0], last = buttons?.[buttons.length - 1]
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus() }
      if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus() }
    }}><div className="modal-heading"><span className="modal-icon">{settingsOpen ? <Settings2 size={21} /> : <CircleHelp size={21} />}</span><IconButton label="Close dialog" onClick={closeDialog}><X size={19} /></IconButton></div><h2 id="dialog-title">{settingsOpen ? 'Make yourself at home.' : 'A few things to try.'}</h2><p>{settingsOpen ? 'A few preferences for your workspace.' : 'Your first look at the RenovaCAD workspace.'}</p>
      {settingsOpen ? <><div className="setting-row"><div><strong>Measurement units</strong><span>Used throughout the inspector.</span></div><div className="unit-toggle"><button className={unit === 'in' ? 'selected' : ''} aria-pressed={unit === 'in'} onClick={() => setUnit('in')}>in</button><button className={unit === 'mm' ? 'selected' : ''} aria-pressed={unit === 'mm'} onClick={() => setUnit('mm')}>mm</button></div></div><div className="setting-row"><div><strong>Viewport grid</strong><span>A little structure for your design.</span></div><button role="switch" aria-checked={showGrid} aria-label="Viewport grid" className={`switch ${showGrid ? 'on' : ''}`} onClick={() => setShowGrid((show) => !show)}><span /></button></div></> : <div className="help-items"><p><MousePointer2 size={17} /><span>Select a cabinet in the scene or object list.</span></p><p><Ruler size={17} /><span>Edit its dimensions in the inspector.</span></p><p><Sparkles size={17} /><span>Apply or cancel the sample assistant proposal.</span></p><p><Undo2 size={17} /><span>Undo with <kbd>⌘ Z</kbd>, redo with <kbd>⇧ ⌘ Z</kbd>.</span></p><p><ImagePlus size={17} /><span>Upload a kitchen photo to try the reference view.</span></p><div className="help-footnote">This milestone is a UI prototype. Project storage, 3D tools, and AI connections come next.</div></div>}
      <button className="primary-button modal-done" onClick={closeDialog}>Back to designing<ArrowRight size={16} /></button>
    </div></div>}
  </div>
}
