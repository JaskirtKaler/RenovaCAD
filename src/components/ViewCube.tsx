import { ChevronDown, Home, RotateCcw } from 'lucide-react'
import { viewLabel, type Camera, type CameraView } from '../viewport'

interface ViewCubeProps {
  camera: Camera
  onView: (view: CameraView) => void
  onReset: () => void
}

const cameraViews = [
  { id: 'isometric', label: 'Isometric' },
  { id: 'front', label: 'Front' },
  { id: 'back', label: 'Back' },
  { id: 'left', label: 'Left' },
  { id: 'right', label: 'Right' },
  { id: 'top', label: 'Top' },
] satisfies { id: CameraView; label: string }[]

const cubeFaces = [
  { view: 'top', label: 'TOP', points: '51,6 91,27 51,48 11,27', x: 51, y: 29 },
  { view: 'front', label: 'FRONT', points: '11,27 51,48 51,89 11,67', x: 31, y: 61 },
  { view: 'right', label: 'RIGHT', points: '51,48 91,27 91,67 51,89', x: 71, y: 61 },
] satisfies { view: CameraView; label: string; points: string; x: number; y: number }[]

export function ViewCube({ camera, onView, onReset }: ViewCubeProps) {
  const selectedView = cameraViews.find(({ label }) => viewLabel(camera) === label)?.id ?? 'custom'
  return <div className="orientation-control" role="group" aria-label="View orientation">
    <div className="orientation-heading"><button type="button" className="icon-button" aria-label="Isometric view" title="Isometric view" onClick={() => onView('isometric')}><Home size={13} /></button><span aria-live="polite">{viewLabel(camera)}</span><button type="button" className="icon-button" aria-label="Reset camera" title="Reset camera and zoom" onClick={onReset}><RotateCcw size={13} /></button></div>
    <svg className="view-cube" width="102" height="94" viewBox="0 0 102 94" role="group" aria-label="Clickable camera cube">
      {cubeFaces.map(({ view, label, points, x, y }) => <g key={view} role="button" tabIndex={0} aria-label={`${label[0]}${label.slice(1).toLowerCase()} view`} aria-pressed={selectedView === view} className={`cube-face ${selectedView === view ? 'selected' : ''}`} onClick={() => onView(view)} onKeyDown={(event) => {
        if (event.key !== 'Enter' && event.key !== ' ') return
        event.preventDefault()
        onView(view)
      }}><polygon points={points} /><text x={x} y={y} textAnchor="middle" dominantBaseline="middle">{label}</text></g>)}
    </svg>
    <div className="view-select"><select aria-label="Camera view" value={selectedView} onChange={(event) => { const preset = cameraViews.find(({ id }) => id === event.target.value); if (preset) onView(preset.id) }}>{selectedView === 'custom' && <option value="custom" disabled>Custom view</option>}{cameraViews.map(({ id, label }) => <option key={id} value={id}>{label}</option>)}</select><ChevronDown size={11} /></div>
  </div>
}
