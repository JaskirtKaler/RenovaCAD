import { useEffect, useRef, useState } from 'react'
import { TILE_MM, displayMeasurement, type SceneObject, type Unit } from '../workspace'
import { FLOOR_GRID, boxFaces, boxPoint, cameraDirection, createProjector, distanceMm, movementPlaneIsUsable, sceneBoxes, snapDelta, worldDeltaFromScreenDelta, worldPointOnPlane, type Camera, type Point3, type SceneBox } from '../viewport'

interface KitchenPreviewProps {
  objects: SceneObject[]
  selectedId: string | null
  onSelect: (id: string) => void
  showGrid: boolean
  zoom: number
  camera: Camera
  unit: Unit
  onOrbit: (dx: number, dy: number) => void
  onZoom: (delta: number) => void
  frame: Point3[]
  moveMode: boolean
  activeTool: string
  onMoveObject: (id: string, pos: { x: number; y: number; z: number }) => void
  measurePoints: Point3[]
  onMeasureAdd: (p: Point3, surface: string) => void
}

interface Drag {
  pointerId: number; startX: number; startY: number; x: number; y: number
  moved: boolean; objectId: string | null
}

interface MoveDrag {
  objectId: string
  startPos: Point3
  planeY: number
  startX: number
  startY: number
  didMove: boolean
  preview: Point3
  didSnap: boolean
  guides: { x?: number; z?: number }[]
}

export function KitchenPreview({ objects, selectedId, onSelect, showGrid, zoom, camera, unit, onOrbit, onZoom, frame, moveMode, activeTool, onMoveObject, measurePoints, onMeasureAdd }: KitchenPreviewProps) {
  const svgRef = useRef<SVGSVGElement>(null)
  const drag = useRef<Drag | null>(null)
  const moveDrag = useRef<MoveDrag | null>(null)
  const [movePreview, setMovePreview] = useState<{ pos: Point3; didSnap: boolean; guides: { x?: number; z?: number }[] } | null>(null)
  const boxes = sceneBoxes(objects)
  const { project, isVisible, isInFront, projectSegment, projectPolygon } = createProjector(frame, camera, zoom)
  const points = (vertices: Point3[]) => projectPolygon(vertices).map((p) => `${p.x},${p.y}`).join(' ')
  const line = (from: Point3, to: Point3) => {
    const segment = projectSegment(from, to)
    if (!segment) return null
    const [a, b] = segment
    return <line x1={a.x} y1={a.y} x2={b.x} y2={b.y} />
  }
  const sortedBoxes = [...boxes].sort((a, b) => project(boxPoint(a, 0.5, 0.5, 0.5)).depth - project(boxPoint(b, 0.5, 0.5, 0.5)).depth)
  const selectedBox = boxes.find((box) => box.object.id === selectedId)
  // For preview during move, use preview position
  const displayBoxes = (() => {
    if (!movePreview || !selectedId) return boxes
    return boxes.map(b => b.object.id === selectedId ? { ...b, object: { ...b.object, positionMm: { x: movePreview.pos.x, y: movePreview.pos.y, z: movePreview.pos.z } } } : b)
  })()
  const sortedDisplay = [...displayBoxes].sort((a, b) => project(boxPoint(a, 0.5, 0.5, 0.5)).depth - project(boxPoint(b, 0.5, 0.5, 0.5)).depth)
  const previewSelectedBox = displayBoxes.find(b => b.object.id === selectedId)

  const verticalGuide = () => {
    if (!moveMode || !selectedBox) return null
    const origin = boxPoint(selectedBox, 0.5, 0, 0.5)
    const horizontalAxis = Math.abs(cameraDirection(camera).z) >= Math.abs(cameraDirection(camera).x) ? 'x' : 'z'
    const planePoint = (horizontal: number, y: number): Point3 => ({ ...origin, [horizontalAxis]: horizontal, y })
    const anchor = project(origin)
    return <g data-position-guide="height" pointerEvents="none">
      {showGrid && <g data-grid-plane="vertical" stroke="#6a9f7a" strokeWidth="0.7" strokeOpacity="0.16">{Array.from({ length: 65 }, (_, index) => {
        const coordinate = (index - 32) * TILE_MM
        return <g key={index}>{line(planePoint(coordinate, -10000), planePoint(coordinate, 10000))}{line(planePoint(-10000, coordinate), planePoint(10000, coordinate))}</g>
      })}</g>}
      <g stroke="#9cdbaf" strokeWidth="1.5" strokeDasharray="5 5">{line(origin, { ...origin, y: 0 })}</g>
      {isInFront(origin) && <text x={anchor.x + 16} y={anchor.y - 10} fontSize="13" fill="#a1d6af">Floor {origin.y >= 0 ? '+' : ''}{displayMeasurement(origin.y, unit)} {unit}</text>}
    </g>
  }

  useEffect(() => {
    const svg = svgRef.current
    if (!svg) return
    const wheel = (event: WheelEvent) => {
      event.preventDefault()
      onZoom(Math.max(-0.15, Math.min(0.15, -event.deltaY * 0.0015)))
    }
    svg.addEventListener('wheel', wheel, { passive: false })
    return () => svg.removeEventListener('wheel', wheel)
  }, [onZoom])

  // Clear preview when selection changes or camera changes
  useEffect(() => { setMovePreview(null); moveDrag.current = null }, [selectedId, camera, zoom, frame])

  const cabinetDetails = (box: SceneBox, side: string) => {
    const kind = box.object.kind
    if (kind === 'wall') return null
    if (kind === 'sink') {
      return side === 'top' ? <polygon points={points([boxPoint(box, 0.12, 1.005, 0.18), boxPoint(box, 0.88, 1.005, 0.18), boxPoint(box, 0.88, 1.005, 0.82), boxPoint(box, 0.12, 1.005, 0.82)])} fill="#78877a" stroke="#c7d1c5" /> : null
    }
    if (side !== 'front') return null
    return (
      <g fill="none" stroke="#858f7f" strokeWidth="1.3" pointerEvents="none">
        {kind !== 'tall-cabinet' && line(boxPoint(box, 0.5, 0.02, 1.001), boxPoint(box, 0.5, 0.98, 1.001))}
        {kind !== 'wall-cabinet' && line(boxPoint(box, 0.02, 0.64, 1.001), boxPoint(box, 0.98, 0.64, 1.001))}
        {kind === 'tall-cabinet' && line(boxPoint(box, 0.12, 0.04, 1.001), boxPoint(box, 0.12, 0.96, 1.001))}
      </g>
    )
  }

  const dimension = (box: SceneBox) => {
    if (!isInFront(boxPoint(box, 0, 0, 1)) || !isInFront(boxPoint(box, 1, 0, 1))) return null
    const a = project(boxPoint(box, 0, 0, 1)), b = project(boxPoint(box, 1, 0, 1))
    const length = Math.hypot(b.x - a.x, b.y - a.y)
    let nx = -(b.y - a.y) / Math.max(1, length), ny = (b.x - a.x) / Math.max(1, length)
    if (ny < 0) { nx = -nx; ny = -ny }
    const label = `${displayMeasurement(box.object.dimensionsMm.width, unit)} ${unit}`
    if (length < 24) return <text x={a.x + 30} y={a.y + 28} fill="#a3e2b9" fontSize="15" textAnchor="middle">{label}</text>
    const ax = a.x + nx * 24, ay = a.y + ny * 24, bx = b.x + nx * 24, by = b.y + ny * 24
    return (
      <g pointerEvents="none" stroke="#76cf9b" strokeWidth="1.2">
        <line x1={ax} y1={ay} x2={bx} y2={by} />
        <line x1={ax - nx * 5} y1={ay - ny * 5} x2={ax + nx * 5} y2={ay + ny * 5} />
        <line x1={bx - nx * 5} y1={by - ny * 5} x2={bx + nx * 5} y2={by + ny * 5} />
        <text x={(ax + bx) / 2 + nx * 18} y={(ay + by) / 2 + ny * 18 + 5} fill="#a3e2b9" stroke="none" fontSize="15" textAnchor="middle" fontFamily="ui-monospace, SFMono-Regular, monospace">{label}</text>
      </g>
    )
  }

  // Snap guides rendering
  const snapGuides = () => {
    if (!movePreview?.didSnap || !movePreview.guides.length) return null
    // Draw infinite lines at snapped edges extended
    return <g pointerEvents="none" stroke="#ffd166" strokeWidth="1.2" strokeDasharray="6 4" opacity={0.9}>
      {movePreview.guides.map((g, i) => {
        if (g.x !== undefined) {
          // vertical line at x
          const y = movePreview!.pos.y
          return <g key={`x-${i}`}>{line({ x: g.x, y, z: -10000 }, { x: g.x, y, z: 10000 })}</g>
        } else if (g.z !== undefined) {
          return <g key={`z-${i}`}>{line({ x: -10000, y: movePreview!.pos.y, z: g.z }, { x: 10000, y: movePreview!.pos.y, z: g.z })}</g>
        }
        return null
      })}
      <text x={500} y={18} textAnchor="middle" fontSize="11" fill="#ffd166" fontWeight={600}>Snapped — hold Shift to bypass</text>
    </g>
  }

  // Measurement overlay
  const measurementOverlay = () => {
    if (measurePoints.length === 0) return null
    const segs: React.ReactNode[] = []
    for (let i = 0; i < measurePoints.length - 1; i++) {
      const a = measurePoints[i], b = measurePoints[i + 1]
      const seg = line(a, b)
      if (!seg) continue
      const pa = project(a), pb = project(b)
      const midX = (pa.x + pb.x) / 2, midY = (pa.y + pb.y) / 2
      const dist = distanceMm(a, b)
      const label = `${displayMeasurement(dist, unit)} ${unit}`
      segs.push(<g key={i} pointerEvents="none">
        <g stroke="#7ec8e3" strokeWidth={2.5}>{seg}</g>
        <circle cx={pa.x} cy={pa.y} r={5} fill="#7ec8e3" stroke="#0e1110" strokeWidth={1.5} />
        <circle cx={pb.x} cy={pb.y} r={5} fill="#7ec8e3" stroke="#0e1110" strokeWidth={1.5} />
        <rect x={midX - 34} y={midY - 14} width={68} height={16} rx={3} fill="#0e1110" stroke="#7ec8e3" />
        <text x={midX} y={midY - 4} textAnchor="middle" fontSize={10} fill="#7ec8e3" fontWeight={600}>{label}</text>
      </g>)
    }
    // Single point dot
    if (measurePoints.length === 1) {
      const p = project(measurePoints[0])
      segs.push(<circle key="single" cx={p.x} cy={p.y} r={5} fill="#7ec8e3" stroke="#fff" strokeWidth={1.5} pointerEvents="none" />)
    }
    return <g data-measure-overlay="true">{segs}</g>
  }

  const handlePointerDown = (event: React.PointerEvent<SVGSVGElement>) => {
    if (event.button !== 0) return
    const target = event.target
    const objectId = target instanceof Element ? target.closest('[data-object-id]')?.getAttribute('data-object-id') ?? null : null
    // Measure mode: click adds point, never orbit/move
    if (activeTool === 'measure') {
      event.preventDefault()
      const rect = event.currentTarget.getBoundingClientRect()
      // Determine surface Y: if clicking on object, use its top; else floor 0
      let planeY = 0
      let surface = 'floor (Y=0)'
      if (objectId) {
        const hit = objects.find(o => o.id === objectId)
        if (hit) { planeY = hit.positionMm.y + hit.dimensionsMm.height; surface = `${hit.name} top` }
      }
      const wp = worldPointOnPlane(event.clientX, event.clientY, planeY, camera, frame, zoom, rect)
      if (!wp) return
      // If object hit but we used floor, prefer object's plane if that point is near object bounds?
      // For now use computed wp with chosen planeY
      onMeasureAdd(wp, surface)
      return
    }
    // Move mode: dragging selected object moves it
    if (activeTool === 'move' && objectId && objectId === selectedId) {
      const sel = objects.find(o => o.id === selectedId)
      if (!sel) return
      if (!movementPlaneIsUsable(camera)) {
        // fallback: allow selection but not drag
        return
      }
      event.preventDefault()
      moveDrag.current = {
        objectId,
        startPos: { ...sel.positionMm },
        planeY: sel.positionMm.y,
        startX: event.clientX,
        startY: event.clientY,
        didMove: false,
        preview: { ...sel.positionMm },
        didSnap: false,
        guides: [],
      }
      setMovePreview({ pos: { ...sel.positionMm }, didSnap: false, guides: [] })
      event.currentTarget.setPointerCapture(event.pointerId)
      event.currentTarget.style.cursor = 'grabbing'
      // also store drag for click detection
      drag.current = { pointerId: event.pointerId, startX: event.clientX, startY: event.clientY, x: event.clientX, y: event.clientY, moved: false, objectId }
      return
    }
    // Otherwise orbit/select
    drag.current = { pointerId: event.pointerId, startX: event.clientX, startY: event.clientY, x: event.clientX, y: event.clientY, moved: false, objectId }
    event.currentTarget.setPointerCapture(event.pointerId)
    event.currentTarget.style.cursor = 'grabbing'
  }

  const handlePointerMove = (event: React.PointerEvent<SVGSVGElement>) => {
    // Move drag handling
    if (moveDrag.current) {
      const md = moveDrag.current
      if (md.objectId !== selectedId) return
      const dxScreen = event.clientX - md.startX
      const dyScreen = event.clientY - md.startY
      if (!md.didMove && Math.hypot(dxScreen, dyScreen) < 4) return
      md.didMove = true
      const delta = worldDeltaFromScreenDelta(dxScreen, dyScreen, camera, frame, zoom, md.planeY)
      if (!delta) {
        // plane edge-on fallback: keep original
        return
      }
      const tentative: Point3 = { x: md.startPos.x + delta.dx, y: md.startPos.y, z: md.startPos.z + delta.dz }
      const sel = objects.find(o => o.id === selectedId)
      if (!sel) return
      const others = objects.filter(o => o.id !== selectedId)
      const bypass = event.shiftKey
      let snapped = tentative
      let didSnap = false
      let guides: { x?: number; z?: number }[] = []
      if (!bypass) {
        const snap = snapDelta({ positionMm: sel.positionMm, dimensionsMm: { width: sel.dimensionsMm.width, depth: sel.dimensionsMm.depth }, rotationDegrees: sel.rotationDegrees }, others.map(o => ({ positionMm: o.positionMm, dimensionsMm: { width: o.dimensionsMm.width, depth: o.dimensionsMm.depth }, rotationDegrees: o.rotationDegrees })), tentative)
        snapped = snap.snapped
        didSnap = snap.didSnap
        guides = snap.guides
      }
      md.preview = snapped
      md.didSnap = didSnap
      md.guides = guides
      setMovePreview({ pos: snapped, didSnap, guides })
      return
    }
    const current = drag.current
    if (!current || current.pointerId !== event.pointerId) return
    if (Math.hypot(event.clientX - current.startX, event.clientY - current.startY) > 4) current.moved = true
    if (current.moved) onOrbit(event.clientX - current.x, event.clientY - current.y)
    current.x = event.clientX; current.y = event.clientY
  }

  const handlePointerUp = (event: React.PointerEvent<SVGSVGElement>) => {
    if (moveDrag.current) {
      const md = moveDrag.current
      const shouldCommit = md.didMove
      const preview = md.preview
      moveDrag.current = null
      setMovePreview(null)
      event.currentTarget.style.cursor = ''
      if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId)
      drag.current = null
      if (shouldCommit && md.objectId) {
        onMoveObject(md.objectId, preview)
      } else if (!md.didMove && md.objectId) {
        onSelect(md.objectId)
      }
      return
    }
    const current = drag.current
    if (!current || current.pointerId !== event.pointerId) return
    if (!current.moved && current.objectId) onSelect(current.objectId)
    drag.current = null
    event.currentTarget.style.cursor = ''
    if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId)
  }

  const handlePointerCancel = () => {
    moveDrag.current = null
    setMovePreview(null)
    drag.current = null
    if (svgRef.current) svgRef.current.style.cursor = ''
  }

  const cursorStyle = activeTool === 'measure' ? 'crosshair' : activeTool === 'move' && selectedId ? 'grab' : undefined

  return (
    <svg
      ref={svgRef}
      className="kitchen-preview"
      data-tool={activeTool}
      viewBox="0 0 1000 800"
      role="group"
      aria-label="3D kitchen viewport. Drag to orbit, scroll to zoom, or select an object."
      style={{ touchAction: 'none', userSelect: 'none', cursor: cursorStyle } as React.CSSProperties}
      overflow="hidden"
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={handlePointerUp}
      onPointerCancel={handlePointerCancel}
    >
      {showGrid && <g data-grid-plane="floor" pointerEvents="none">{FLOOR_GRID.map((segment, index) => <g key={index} stroke={segment.axis ? '#75967a' : '#465c4a'} strokeWidth={segment.axis ? 1.5 : segment.major ? 1 : 0.6} strokeOpacity={segment.axis ? 0.7 : segment.major ? 0.52 : 0.3}>{line(segment.from, segment.to)}</g>)}</g>}
      {verticalGuide()}
      {sortedDisplay.map((box) => {
        const selected = box.object.id === selectedId
        const isDragging = movePreview && box.object.id === selectedId
        const name = `${box.object.name}, ${displayMeasurement(box.object.dimensionsMm.width, unit)} ${unit} wide${selected ? ', selected' : ''}`
        const faces = boxFaces(box).filter(isVisible).sort((a, b) => project(a.center).depth - project(b.center).depth)
        return (
          <g key={box.object.id} className="kitchen-object" data-object-id={box.object.id} role="button" tabIndex={0} aria-label={name} aria-pressed={selected} style={{ opacity: isDragging ? 0.9 : 1 }}
            onClick={(event) => { if (event.detail === 0) onSelect(box.object.id) }}
            onKeyDown={(event) => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); onSelect(box.object.id) } }}>
            <title>{name}</title>
            {faces.map((face) => {
              const wall = box.object.kind === 'wall'
              const fill = wall ? face.side === 'top' ? '#748470' : '#53664f' : face.side === 'top' ? '#f1f4e9' : face.side === 'bottom' ? '#a1b09a' : face.side === 'front' ? '#dfe5d5' : face.side === 'right' ? '#becab5' : '#ccd6c2'
              const stroke = isDragging && selected ? '#ffd166' : selected ? '#72d79c' : '#788571'
              return <g key={face.side}><polygon points={points(face.points)} fill={fill} stroke={stroke} strokeWidth={selected ? 2 : 1.5} strokeLinejoin="round" />{cabinetDetails(box, face.side)}</g>
            })}
          </g>
        )
      })}
      {previewSelectedBox && dimension(previewSelectedBox)}
      {snapGuides()}
      {measurementOverlay()}
    </svg>
  )
}
