import { ChevronDown, Home } from 'lucide-react'
import { CAMERA_VIEWS, createProjector, cubeRegions, selectedCameraView, viewLabel, type Camera, type CameraView } from '../viewport'

interface ViewCubeProps {
  camera: Camera
  onView: (view: CameraView) => void
  onHome: () => void
}

const regions = cubeRegions()
const cubeCorners = [{ x: -1, y: -1, z: -1 }, { x: 1, y: 1, z: 1 }, { x: 1, y: -1, z: -1 }, { x: -1, y: 1, z: 1 }, { x: -1, y: -1, z: 1 }, { x: 1, y: 1, z: -1 }, { x: 1, y: -1, z: 1 }, { x: -1, y: 1, z: -1 }]

export function ViewCube({ camera, onView, onHome }: ViewCubeProps) {
  const selectedView = selectedCameraView(camera)?.id ?? 'custom'
  const { project, isVisible } = createProjector(cubeCorners, { ...camera, projection: 'orthographic' }, 1)
  const cubePoint = (p: ReturnType<typeof project>) => ({ x: 80 + (p.x - 500) * 0.145, y: 80 + (p.y - 400) * 0.145 })
  const visible = regions.filter(isVisible).sort((a, b) => project(a.center).depth - project(b.center).depth)
  return <div className="orientation-control" role="group" aria-label="View orientation" data-camera-control="true">
    <div className="orientation-heading"><button type="button" className="icon-button" aria-label="Home view" title="Home view and fit scene" onClick={onHome}><Home size={15} /></button><span aria-live="polite">{viewLabel(camera)}</span></div>
    <svg className="view-cube" width="144" height="144" viewBox="0 0 160 160" role="group" aria-label="Camera cube with face, edge, and corner views">
      {visible.map((region) => {
        const center = cubePoint(project(region.center))
        return <g key={region.id} role="button" tabIndex={0} aria-label={`${region.label} view`} aria-pressed={selectedView === region.id} className={`cube-region cube-${region.kind} ${selectedView === region.id ? 'selected' : ''}`} onClick={() => onView(region.id)} onKeyDown={(event) => {
          if (event.key !== 'Enter' && event.key !== ' ') return
          event.preventDefault(); event.stopPropagation(); onView(region.id)
        }}><title>{region.label} view</title><polygon points={region.points.map((point) => { const p = cubePoint(project(point)); return `${p.x},${p.y}` }).join(' ')} />{region.kind === 'face' && <text x={center.x} y={center.y} textAnchor="middle" dominantBaseline="middle">{region.label.toUpperCase()}</text>}</g>
      })}
    </svg>
    <div className="view-select"><select aria-label="All views" value={selectedView} onChange={(event) => { const preset = CAMERA_VIEWS.find(({ id }) => id === event.target.value); if (preset) onView(preset.id) }}>{selectedView === 'custom' && <option value="custom" disabled>Custom view</option>}{(['face', 'edge', 'corner'] satisfies typeof CAMERA_VIEWS[number]['kind'][]).map((kind) => <optgroup key={kind} label={`${kind[0].toUpperCase()}${kind.slice(1)} views`}>{CAMERA_VIEWS.filter((view) => view.kind === kind).map(({ id, label }) => <option key={id} value={id}>{label}</option>)}</optgroup>)}</select><ChevronDown size={11} /></div>
    <span className="cube-hint">Faces · Edges · Corners</span>
  </div>
}
