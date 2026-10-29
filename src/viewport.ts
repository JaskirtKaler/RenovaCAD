import { TILE_MM, type SceneObject } from './workspace'

export type Projection = 'perspective' | 'orthographic'
export interface Camera { yaw: number; pitch: number; projection: Projection }
export interface Point3 { x: number; y: number; z: number }
export interface ProjectedPoint { x: number; y: number; depth: number }
export interface SceneBox { object: SceneObject; origin: Point3 }
export type FaceSide = 'front' | 'back' | 'left' | 'right' | 'top' | 'bottom'
export interface BoxFace { side: FaceSide; points: Point3[]; normal: Point3; center: Point3 }
export interface Bounds3 { min: Point3; max: Point3 }

const tau = Math.PI * 2
const clamp = (value: number, min: number, max: number) => Math.max(min, Math.min(value, max))
const normalize = (angle: number) => ((angle + Math.PI) % tau + tau) % tau - Math.PI

function preset<Id extends string>(id: Id, label: string, x: number, y: number, z: number) {
  const axes = [x, y, z].filter((value) => value !== 0).length
  const kind: 'face' | 'edge' | 'corner' = axes === 1 ? 'face' : axes === 2 ? 'edge' : 'corner'
  return { id, label, direction: { x, y, z }, kind }
}

export const CAMERA_VIEWS = [
  preset('front', 'Front', 0, 0, 1), preset('back', 'Back', 0, 0, -1),
  preset('left', 'Left', -1, 0, 0), preset('right', 'Right', 1, 0, 0),
  preset('top', 'Top', 0, 1, 0), preset('bottom', 'Bottom', 0, -1, 0),
  preset('top-front', 'Top front', 0, 1, 1), preset('top-back', 'Top back', 0, 1, -1),
  preset('top-left', 'Top left', -1, 1, 0), preset('top-right', 'Top right', 1, 1, 0),
  preset('bottom-front', 'Bottom front', 0, -1, 1), preset('bottom-back', 'Bottom back', 0, -1, -1),
  preset('bottom-left', 'Bottom left', -1, -1, 0), preset('bottom-right', 'Bottom right', 1, -1, 0),
  preset('front-left', 'Front left', -1, 0, 1), preset('front-right', 'Front right', 1, 0, 1),
  preset('back-left', 'Back left', -1, 0, -1), preset('back-right', 'Back right', 1, 0, -1),
  preset('top-front-left', 'Top front left', -1, 1, 1), preset('top-front-right', 'Top front right', 1, 1, 1),
  preset('top-back-left', 'Top back left', -1, 1, -1), preset('top-back-right', 'Top back right', 1, 1, -1),
  preset('bottom-front-left', 'Bottom front left', -1, -1, 1), preset('bottom-front-right', 'Bottom front right', 1, -1, 1),
  preset('bottom-back-left', 'Bottom back left', -1, -1, -1), preset('bottom-back-right', 'Bottom back right', 1, -1, -1),
]
export type CameraView = typeof CAMERA_VIEWS[number]['id']
export const HOME_VIEW: CameraView = 'top-front-right'

export function cameraForView(view: CameraView, projection: Projection): Camera {
  const { direction } = CAMERA_VIEWS.find((item) => item.id === view) ?? CAMERA_VIEWS[0]
  return { yaw: Math.atan2(direction.x, direction.z), pitch: Math.atan2(direction.y, Math.hypot(direction.x, direction.z)), projection }
}

export function selectedCameraView(camera: Camera) {
  const direction = cameraDirection(camera)
  return CAMERA_VIEWS.find((item) => {
    const length = Math.hypot(item.direction.x, item.direction.y, item.direction.z)
    return (direction.x * item.direction.x + direction.y * item.direction.y + direction.z * item.direction.z) / length > 0.9998
  })
}

export function viewLabel(camera: Camera): string {
  return selectedCameraView(camera)?.label ?? 'Orbit'
}

export function orbitCamera(camera: Camera, dx: number, dy: number): Camera {
  return { ...camera, yaw: normalize(camera.yaw - dx * 0.007), pitch: clamp(camera.pitch + dy * 0.007, -Math.PI / 2 + 0.012, Math.PI / 2 - 0.012) }
}

export function cameraDirection(camera: Camera): Point3 {
  return { x: Math.sin(camera.yaw) * Math.cos(camera.pitch), y: Math.sin(camera.pitch), z: Math.cos(camera.yaw) * Math.cos(camera.pitch) }
}

export function sceneBoxes(objects: SceneObject[]): SceneBox[] {
  return objects.map((object) => ({ object, origin: object.positionMm }))
}

export function sceneFrame(objects: SceneObject[]): Point3[] {
  const vertices = sceneBoxes(objects).flatMap((box) => boxFaces(box).flatMap((face) => face.points))
  if (!vertices.length) return [{ x: -770, y: 0, z: -420 }, { x: 1250, y: 2400, z: 800 }]
  const bounds = boundsOf(vertices)
  return [...vertices, { x: bounds.min.x - 120, y: 0, z: bounds.min.z - 120 }, { x: bounds.max.x + 140, y: 0, z: bounds.max.z + 180 }]
}

export function floorGridSegments(extent = 25000) {
  const segments: { from: Point3; to: Point3; major: boolean; axis: boolean }[] = []
  const tiles = Math.floor(extent / TILE_MM)
  for (let index = -tiles; index <= tiles; index++) {
    const coordinate = index * TILE_MM
    segments.push({ from: { x: coordinate, y: 0, z: -extent }, to: { x: coordinate, y: 0, z: extent }, major: index % 5 === 0, axis: index === 0 })
    segments.push({ from: { x: -extent, y: 0, z: coordinate }, to: { x: extent, y: 0, z: coordinate }, major: index % 5 === 0, axis: index === 0 })
  }
  return segments
}

export const FLOOR_GRID = floorGridSegments()

export function cubeRegions() {
  const bevel = 0.62
  const axes = ['x', 'y', 'z'] satisfies (keyof Point3)[]
  return CAMERA_VIEWS.map((view) => {
    const active = axes.filter((axis) => view.direction[axis] !== 0)
    const free = axes.filter((axis) => view.direction[axis] === 0)
    const point = (): Point3 => ({ x: 0, y: 0, z: 0 })
    let points: Point3[]
    if (view.kind === 'face') {
      points = [[-bevel, -bevel], [bevel, -bevel], [bevel, bevel], [-bevel, bevel]].map(([a, b]) => {
        const p = point(); p[active[0]] = view.direction[active[0]]; p[free[0]] = a; p[free[1]] = b; return p
      })
    } else if (view.kind === 'edge') {
      points = [[1, bevel, -bevel], [1, bevel, bevel], [bevel, 1, bevel], [bevel, 1, -bevel]].map(([a, b, c]) => {
        const p = point(); p[active[0]] = a * view.direction[active[0]]; p[active[1]] = b * view.direction[active[1]]; p[free[0]] = c; return p
      })
    } else {
      points = axes.map((outer) => ({ x: view.direction.x * (outer === 'x' ? 1 : bevel), y: view.direction.y * (outer === 'y' ? 1 : bevel), z: view.direction.z * (outer === 'z' ? 1 : bevel) }))
    }
    return { ...view, points, normal: view.direction, center: { x: points.reduce((sum, p) => sum + p.x, 0) / points.length, y: points.reduce((sum, p) => sum + p.y, 0) / points.length, z: points.reduce((sum, p) => sum + p.z, 0) / points.length } }
  })
}

// Coordinates use millimeters: X = width, Y = height, Z = depth toward the front.
// Fractional box coordinates make cabinet details follow every dimension/rotation.
export function boxPoint(box: SceneBox, x: number, y: number, z: number): Point3 {
  const { width, height, depth } = box.object.dimensionsMm
  const angle = box.object.rotationDegrees * Math.PI / 180
  const localX = (x - 0.5) * width, localZ = (z - 0.5) * depth
  return { x: box.origin.x + width / 2 + localX * Math.cos(angle) + localZ * Math.sin(angle), y: box.origin.y + y * height, z: box.origin.z + depth / 2 - localX * Math.sin(angle) + localZ * Math.cos(angle) }
}

export function boxFaces(box: SceneBox): BoxFace[] {
  const face = (side: FaceSide, coordinates: number[][], normal: Point3): BoxFace => {
    const points = coordinates.map(([x, y, z]) => boxPoint(box, x, y, z))
    const angle = box.object.rotationDegrees * Math.PI / 180
    return { side, points, normal: { x: normal.x * Math.cos(angle) + normal.z * Math.sin(angle), y: normal.y, z: -normal.x * Math.sin(angle) + normal.z * Math.cos(angle) }, center: { x: points.reduce((sum, p) => sum + p.x, 0) / 4, y: points.reduce((sum, p) => sum + p.y, 0) / 4, z: points.reduce((sum, p) => sum + p.z, 0) / 4 } }
  }
  return [
    face('front', [[0, 0, 1], [1, 0, 1], [1, 1, 1], [0, 1, 1]], { x: 0, y: 0, z: 1 }),
    face('back', [[1, 0, 0], [0, 0, 0], [0, 1, 0], [1, 1, 0]], { x: 0, y: 0, z: -1 }),
    face('left', [[0, 0, 0], [0, 0, 1], [0, 1, 1], [0, 1, 0]], { x: -1, y: 0, z: 0 }),
    face('right', [[1, 0, 1], [1, 0, 0], [1, 1, 0], [1, 1, 1]], { x: 1, y: 0, z: 0 }),
    face('top', [[0, 1, 1], [1, 1, 1], [1, 1, 0], [0, 1, 0]], { x: 0, y: 1, z: 0 }),
    face('bottom', [[0, 0, 0], [1, 0, 0], [1, 0, 1], [0, 0, 1]], { x: 0, y: -1, z: 0 }),
  ]
}

export function boundsOf(points: Point3[]): Bounds3 {
  if (points.length === 0) return { min: { x: -650, y: 0, z: -300 }, max: { x: 1100, y: 2240, z: 700 } }
  return { min: { x: Math.min(...points.map((p) => p.x)), y: Math.min(...points.map((p) => p.y)), z: Math.min(...points.map((p) => p.z)) }, max: { x: Math.max(...points.map((p) => p.x)), y: Math.max(...points.map((p) => p.y)), z: Math.max(...points.map((p) => p.z)) } }
}

export function axisScreenVectors(camera: Camera): { x: { x: number; y: number }; y: { x: number; y: number }; z: { x: number; y: number } } {
  // Use viewport projection conventions as source of truth: derive screen vectors from the same raw projection used by createProjector.
  // Matches the orientation widget to the actual viewport projection for both perspective and orthographic modes.
  const cosYaw = Math.cos(camera.yaw), sinYaw = Math.sin(camera.yaw)
  const sinPitch = Math.sin(camera.pitch), cosPitch = Math.cos(camera.pitch)
  const toScreen = (v: Point3) => {
    const x = v.x * cosYaw - v.z * sinYaw
    const y = v.x * sinYaw * sinPitch - v.y * cosPitch + v.z * cosYaw * sinPitch
    return { x, y }
  }
  return { x: toScreen({ x: 1, y: 0, z: 0 }), y: toScreen({ x: 0, y: 1, z: 0 }), z: toScreen({ x: 0, y: 0, z: 1 }) }
}

export function movementPlaneIsUsable(camera: Camera): boolean {
  const dir = cameraDirection(camera)
  // plane normal is Y up (0,1,0). If camera looks nearly edge-on, |dot| small.
  return Math.abs(dir.y) > 0.12
}

export function worldDeltaFromScreenDelta(
  screenDx: number,
  screenDy: number,
  camera: Camera,
  frame: Point3[],
  zoom: number,
  planeY: number,
): { dx: number; dz: number } | null {
  // Build screen basis for 1mm X and Z moves at planeY.
  const proj = createProjector(frame, camera, zoom)
  const p0 = proj.project({ x: 0, y: planeY, z: 0 })
  const px = proj.project({ x: 1, y: planeY, z: 0 })
  const pz = proj.project({ x: 0, y: planeY, z: 1 })
  const bx = { x: px.x - p0.x, y: px.y - p0.y }
  const bz = { x: pz.x - p0.x, y: pz.y - p0.y }
  const det = bx.x * bz.y - bx.y * bz.x
  if (Math.abs(det) < 0.05) return null
  const invDet = 1 / det
  const dx = (screenDx * bz.y - screenDy * bz.x) * invDet
  const dz = (bx.x * screenDy - bx.y * screenDx) * invDet
  return { dx, dz }
}

export function worldPointOnPlane(
  screenX: number,
  screenY: number,
  planeY: number,
  camera: Camera,
  frame: Point3[],
  zoom: number,
  svgRect: DOMRect,
): Point3 | null {
  // Convert client/screen to SVG viewBox (0..1000,0..800)
  const viewX = ((screenX - svgRect.left) / Math.max(1, svgRect.width)) * 1000
  const viewY = ((screenY - svgRect.top) / Math.max(1, svgRect.height)) * 800
  const proj = createProjector(frame, camera, zoom)
  const p0 = proj.project({ x: 0, y: planeY, z: 0 })
  const px = proj.project({ x: 1, y: planeY, z: 0 })
  const pz = proj.project({ x: 0, y: planeY, z: 1 })
  const bx = { x: px.x - p0.x, y: px.y - p0.y }
  const bz = { x: pz.x - p0.x, y: pz.y - p0.y }
  const det = bx.x * bz.y - bx.y * bz.x
  if (Math.abs(det) < 0.05) return null
  const invDet = 1 / det
  const dx = viewX - p0.x
  const dy = viewY - p0.y
  const worldX = (dx * bz.y - dy * bz.x) * invDet
  const worldZ = (bx.x * dy - bx.y * dx) * invDet
  return { x: worldX, y: planeY, z: worldZ }
}

export function snapDelta(
  movingBox: { positionMm: Point3; dimensionsMm: { width: number; depth: number }; rotationDegrees: number },
  otherBoxes: { positionMm: Point3; dimensionsMm: { width: number; depth: number }; rotationDegrees: number }[],
  tentative: Point3,
  toleranceMm = 40,
): { snapped: Point3; didSnap: boolean; guides: { x?: number; z?: number }[] } {
  // Only support axis-aligned (rotation 0) for both moving and others; otherwise no snap.
  if (Math.abs(movingBox.rotationDegrees) > 0.5) return { snapped: tentative, didSnap: false, guides: [] }
  const moving = { x: tentative.x, z: tentative.z, w: movingBox.dimensionsMm.width, d: movingBox.dimensionsMm.depth }
  let bestDx = 0, bestDz = 0, didSnap = false
  let bestXAbs = Infinity, bestZAbs = Infinity
  const guides: { x?: number; z?: number }[] = []
  for (const other of otherBoxes) {
    if (Math.abs(other.rotationDegrees) > 0.5) continue
    const o = { x: other.positionMm.x, z: other.positionMm.z, w: other.dimensionsMm.width, d: other.dimensionsMm.depth }
    // candidate snap values for X: moving left to other right (gap 0), moving right to other left, moving left to other left, moving right to other right, center to center
    const candidatesX = [
      o.x + o.w - moving.x, // left to right
      o.x - moving.w - moving.x, // right to left
      o.x - moving.x, // left to left
      o.x + o.w - moving.w - moving.x, // right to right
      o.x + o.w / 2 - moving.w / 2 - moving.x, // center
    ]
    for (const c of candidatesX) {
      if (Math.abs(c) <= toleranceMm && Math.abs(c) < bestXAbs - 1e-6) {
        // Check Z overlap with small margin for edge snap relevance
        const movingZ0 = moving.z, movingZ1 = moving.z + moving.d
        const oZ0 = o.z, oZ1 = o.z + o.d
        const overlap = Math.min(movingZ1, oZ1) - Math.max(movingZ0, oZ0)
        if (overlap > -50) {
          bestDx = c
          bestXAbs = Math.abs(c)
          didSnap = true
        }
      }
    }
    const candidatesZ = [
      o.z + o.d - moving.z,
      o.z - moving.d - moving.z,
      o.z - moving.z,
      o.z + o.d - moving.d - moving.z,
      o.z + o.d / 2 - moving.d / 2 - moving.z,
    ]
    for (const c of candidatesZ) {
      if (Math.abs(c) <= toleranceMm && Math.abs(c) < bestZAbs - 1e-6) {
        const movingX0 = moving.x, movingX1 = moving.x + moving.w
        const oX0 = o.x, oX1 = o.x + o.w
        const overlap = Math.min(movingX1, oX1) - Math.max(movingX0, oX0)
        if (overlap > -50) {
          bestDz = c
          bestZAbs = Math.abs(c)
          didSnap = true
        }
      }
    }
  }
  // Choose closest overall? Currently we combine both axes independently if within tolerance
  const snapped = { ...tentative }
  if (Math.abs(bestDx) <= toleranceMm && bestXAbs !== Infinity) {
    snapped.x += bestDx
    guides.push({ x: snapped.x })
    guides.push({ x: snapped.x + moving.w })
  }
  if (Math.abs(bestDz) <= toleranceMm && bestZAbs !== Infinity) {
    snapped.z += bestDz
    guides.push({ z: snapped.z })
    guides.push({ z: snapped.z + moving.d })
  }
  return { snapped, didSnap: didSnap && (bestXAbs !== Infinity || bestZAbs !== Infinity), guides }
}

export function distanceMm(a: Point3, b: Point3): number {
  return Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z)
}

export function createProjector(points: Point3[], camera: Camera, zoom: number) {
  const bounds = boundsOf(points)
  const center = { x: (bounds.min.x + bounds.max.x) / 2, y: (bounds.min.y + bounds.max.y) / 2, z: (bounds.min.z + bounds.max.z) / 2 }
  const radius = Math.max(1, Math.hypot(bounds.max.x - bounds.min.x, bounds.max.y - bounds.min.y, bounds.max.z - bounds.min.z) / 2)
  const distance = radius * 3.5
  const direction = cameraDirection(camera)
  const viewer = { x: center.x + direction.x * distance, y: center.y + direction.y * distance, z: center.z + direction.z * distance }
  const nearDepth = distance * 0.92
  const depthOf = (point: Point3) => (point.x - center.x) * direction.x + (point.y - center.y) * direction.y + (point.z - center.z) * direction.z
  const intersection = (a: Point3, b: Point3) => {
    const fraction = (nearDepth - depthOf(a)) / (depthOf(b) - depthOf(a))
    return { x: a.x + (b.x - a.x) * fraction, y: a.y + (b.y - a.y) * fraction, z: a.z + (b.z - a.z) * fraction }
  }
  const raw = (point: Point3): ProjectedPoint => {
    const x = point.x - center.x, y = point.y - center.y, z = point.z - center.z
    const depth = x * direction.x + y * direction.y + z * direction.z
    const factor = camera.projection === 'perspective' ? distance / Math.max(distance * 0.08, distance - depth) : 1
    return { x: (x * Math.cos(camera.yaw) - z * Math.sin(camera.yaw)) * factor, y: (x * Math.sin(camera.yaw) * Math.sin(camera.pitch) - y * Math.cos(camera.pitch) + z * Math.cos(camera.yaw) * Math.sin(camera.pitch)) * factor, depth }
  }
  const projected = points.length ? points.map(raw) : [raw(bounds.min), raw(bounds.max)]
  const minX = Math.min(...projected.map((p) => p.x)), maxX = Math.max(...projected.map((p) => p.x))
  const minY = Math.min(...projected.map((p) => p.y)), maxY = Math.max(...projected.map((p) => p.y))
  const scale = Math.min(870 / Math.max(1, maxX - minX), 670 / Math.max(1, maxY - minY)) * zoom
  const project = (point: Point3): ProjectedPoint => {
    const p = raw(point)
    return { x: 500 + (p.x - (minX + maxX) / 2) * scale, y: 400 + (p.y - (minY + maxY) / 2) * scale, depth: p.depth }
  }
  const isVisible = (face: Pick<BoxFace, 'normal' | 'center'>): boolean => {
    const vector = camera.projection === 'perspective' ? { x: viewer.x - face.center.x, y: viewer.y - face.center.y, z: viewer.z - face.center.z } : direction
    return face.normal.x * vector.x + face.normal.y * vector.y + face.normal.z * vector.z > 0.0001
  }
  const isInFront = (point: Point3) => camera.projection === 'orthographic' || depthOf(point) <= nearDepth
  const projectSegment = (a: Point3, b: Point3): [ProjectedPoint, ProjectedPoint] | null => {
    if (!isInFront(a) && !isInFront(b)) return null
    return [project(isInFront(a) ? a : intersection(a, b)), project(isInFront(b) ? b : intersection(a, b))]
  }
  const projectPolygon = (vertices: Point3[]): ProjectedPoint[] => {
    const clipped: Point3[] = []
    for (let index = 0; index < vertices.length; index++) {
      const a = vertices[index], b = vertices[(index + 1) % vertices.length]
      if (isInFront(a)) clipped.push(a)
      if (isInFront(a) !== isInFront(b)) clipped.push(intersection(a, b))
    }
    return clipped.map(project)
  }
  return { project, isVisible, isInFront, projectSegment, projectPolygon }
}
