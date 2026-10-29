import type { SceneObject, ObjectKind, Unit, ViewMode } from './workspace'
import type { Camera, Projection } from './viewport'

export const PROJECT_VERSION = 1
// Practical limits for demo project files
export const MAX_PROJECT_BYTES = 12 * 1024 * 1024 // 12 MB total file
export const MAX_IMAGE_BYTES = 5 * 1024 * 1024 // 5 MB decoded image
export const MAX_IMAGE_DATAURL_LENGTH = Math.ceil(MAX_IMAGE_BYTES * 4 / 3) + 120 // base64 overhead + prefix
export const MAX_OBJECTS = 50
export const SUPPORTED_VERSIONS = [1] as const
export const PROJECT_EXTENSION = 'renovacad'

export interface ProjectSettings {
  unit: Unit
  showGrid: boolean
}

export interface ProjectCamera {
  yaw: number
  pitch: number
  projection: Projection
  zoom: number
}

export interface ProjectPhoto {
  name: string
  mimeType: string
  dataUrl: string // data:image/...;base64,...
}

export interface ProjectFile {
  version: number
  name: string
  scene: SceneObject[]
  selectedId: string | null
  settings: ProjectSettings
  camera: ProjectCamera
  viewMode: ViewMode
  referencePhoto: ProjectPhoto | null
}

const VALID_KINDS: ObjectKind[] = ['base-cabinet', 'wall-cabinet', 'tall-cabinet', 'wall', 'sink']
const VALID_UNITS: Unit[] = ['in', 'mm']
const VALID_PROJECTIONS: Projection[] = ['perspective', 'orthographic']
const VALID_VIEW_MODES: ViewMode[] = ['photo', 'cad', 'render']
const VALID_MIME = new Set(['image/jpeg', 'image/png', 'image/webp'])

function isFiniteNumber(v: unknown): boolean {
  return typeof v === 'number' && Number.isFinite(v)
}

function assert(condition: unknown, msg: string): asserts condition {
  if (!condition) throw new Error(msg)
}

export function validateProject(data: unknown): ProjectFile {
  assert(data !== null && typeof data === 'object', 'Invalid project file: expected JSON object')
  const obj = data as Record<string, unknown>

  // version
  assert(typeof obj.version === 'number' && Number.isInteger(obj.version), 'Invalid project file: missing or invalid version')
  assert((SUPPORTED_VERSIONS as readonly number[]).includes(obj.version), `Unsupported project version ${obj.version}. This app supports version ${SUPPORTED_VERSIONS.join(', ')}.`)
  
  // name
  assert(typeof obj.name === 'string' && obj.name.trim().length > 0 && obj.name.trim().length <= 100, 'Invalid project file: project name must be 1–100 characters')

  // scene
  assert(Array.isArray(obj.scene), 'Invalid project file: missing scene')
  assert(obj.scene.length <= MAX_OBJECTS, `Invalid project file: too many objects (${obj.scene.length} > ${MAX_OBJECTS})`)
  for (let i = 0; i < obj.scene.length; i++) {
    const o = (obj.scene as unknown[])[i] as Record<string, unknown>
    assert(o && typeof o === 'object', `Invalid project file: object ${i} is not an object`)
    assert(typeof o.id === 'string' && o.id.length > 0 && o.id.length <= 128, `Invalid project file: object ${i} has invalid id`)
    assert(typeof o.kind === 'string' && (VALID_KINDS as string[]).includes(o.kind), `Invalid project file: object ${i} has invalid kind`)
    assert(typeof o.name === 'string' && o.name.length > 0 && o.name.length <= 100, `Invalid project file: object ${i} has invalid name`)
    const dims = o.dimensionsMm as Record<string, unknown>
    assert(dims && typeof dims === 'object', `Invalid project file: object ${i} missing dimensions`)
    for (const dim of ['width', 'height', 'depth'] as const) {
      const v = dims[dim]
      assert(isFiniteNumber(v) && (v as number) >= 25.4 && (v as number) <= 10000, `Invalid project file: object ${i} has invalid ${dim} (${String(v)})`)
    }
    assert(isFiniteNumber(o.rotationDegrees) && Math.abs(o.rotationDegrees as number) <= 360, `Invalid project file: object ${i} has invalid rotation`)
    const pos = o.positionMm as Record<string, unknown>
    assert(pos && typeof pos === 'object', `Invalid project file: object ${i} missing position`)
    for (const axis of ['x', 'y', 'z'] as const) {
      const v = pos[axis]
      assert(isFiniteNumber(v) && Math.abs(v as number) <= 10000, `Invalid project file: object ${i} has invalid position.${axis}`)
    }
  }
  // ids unique
  const ids = (obj.scene as SceneObject[]).map(o => o.id)
  assert(new Set(ids).size === ids.length, 'Invalid project file: duplicate object ids')

  // selectedId
  if (obj.selectedId !== null) {
    assert(typeof obj.selectedId === 'string' && obj.selectedId.length > 0, 'Invalid project file: invalid selectedId')
    // allow dangling selectedId? We'll allow it but will fallback to first object on load; not an error. If strict, allow any string.
    // But if scene non-empty, warn not error. Keep lenient: no error.
  } else {
    assert(obj.selectedId === null, 'Invalid project file: selectedId must be string or null')
  }

  // settings
  const settings = obj.settings as Record<string, unknown>
  assert(settings && typeof settings === 'object', 'Invalid project file: missing settings')
  assert(typeof settings.unit === 'string' && (VALID_UNITS as string[]).includes(settings.unit), 'Invalid project file: invalid unit')
  assert(typeof settings.showGrid === 'boolean', 'Invalid project file: invalid showGrid')

  // camera
  const cam = obj.camera as Record<string, unknown>
  assert(cam && typeof cam === 'object', 'Invalid project file: missing camera')
  assert(isFiniteNumber(cam.yaw), 'Invalid project file: invalid camera yaw')
  assert(isFiniteNumber(cam.pitch) && Math.abs(cam.pitch as number) <= Math.PI, 'Invalid project file: invalid camera pitch')
  assert(typeof cam.projection === 'string' && (VALID_PROJECTIONS as string[]).includes(cam.projection), 'Invalid project file: invalid projection')
  assert(isFiniteNumber(cam.zoom) && (cam.zoom as number) >= 0.5 && (cam.zoom as number) <= 2, 'Invalid project file: invalid zoom')

  // viewMode
  assert(typeof obj.viewMode === 'string' && (VALID_VIEW_MODES as string[]).includes(obj.viewMode), 'Invalid project file: invalid viewMode')

  // referencePhoto
  if (obj.referencePhoto !== null) {
    const photo = obj.referencePhoto as Record<string, unknown>
    assert(photo && typeof photo === 'object', 'Invalid project file: invalid referencePhoto')
    assert(typeof photo.name === 'string' && photo.name.length > 0 && photo.name.length <= 200, 'Invalid project file: invalid photo name')
    assert(typeof photo.mimeType === 'string' && VALID_MIME.has(photo.mimeType), `Invalid project file: unsupported photo type ${String(photo.mimeType)}`)
    assert(typeof photo.dataUrl === 'string' && photo.dataUrl.startsWith('data:'), 'Invalid project file: invalid photo data')
    // Check prefix matches mimeType
    assert(photo.dataUrl.startsWith(`data:${photo.mimeType};base64,`), 'Invalid project file: photo dataUrl does not match mimeType')
    const b64 = photo.dataUrl.slice(`data:${photo.mimeType};base64,`.length)
    // Rough size check without decoding full
    assert(b64.length <= MAX_IMAGE_DATAURL_LENGTH, `Invalid project file: photo is too large (limit ${MAX_IMAGE_BYTES / (1024*1024)} MB)`)
    // Validate base64 chars
    assert(/^[A-Za-z0-9+/=]*$/.test(b64), 'Invalid project file: photo data is not valid base64')
    // Estimate decoded bytes
    const decodedBytes = Math.floor(b64.length * 3 / 4)
    assert(decodedBytes <= MAX_IMAGE_BYTES, `Invalid project file: photo is too large (limit ${MAX_IMAGE_BYTES / (1024*1024)} MB)`)
    // Also ensure dataUrl total length not absurd
    assert(photo.dataUrl.length <= MAX_IMAGE_DATAURL_LENGTH + 50, 'Invalid project file: photo dataUrl too long')
  }

  // Reject unexpected top-level keys that indicate transient state leakage? No, allow extra keys to be ignored? But spec says don't persist API keys, proposals. Validate should fail if those present? We choose to ignore unknown keys except known transient ones that would be error to persist? Simpler: strip unknown keys, but validate should not reject extra unknown keys to allow forward compat. However transient proposal leakage should be caught as error? Instead serialize strips them, and validate will ignore extra keys except we check size.
  // Size check for total JSON
  // Note: caller also checks MAX_PROJECT_BYTES via string length; we approximate.

  return obj as unknown as ProjectFile
}

export function parseProject(json: string): ProjectFile {
  if (typeof json !== 'string') throw new Error('Invalid project file: expected string')
  if (json.length > MAX_PROJECT_BYTES) throw new Error(`Project file is too large (${(json.length / (1024*1024)).toFixed(1)} MB > ${MAX_PROJECT_BYTES / (1024*1024)} MB)`)
  // quick malformed check
  let data: unknown
  try {
    data = JSON.parse(json)
  } catch {
    throw new Error('Invalid project file: malformed JSON')
  }
  return validateProject(data)
}

export function serializeProject(project: ProjectFile): string {
  // Build clean object with only allowed fields, normalized.
  const clean: ProjectFile = {
    version: PROJECT_VERSION,
    name: project.name.trim(),
    scene: project.scene.map(o => ({
      id: o.id,
      kind: o.kind,
      name: o.name,
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
    })),
    selectedId: project.selectedId,
    settings: { unit: project.settings.unit, showGrid: project.settings.showGrid },
    camera: { yaw: project.camera.yaw, pitch: project.camera.pitch, projection: project.camera.projection, zoom: project.camera.zoom },
    viewMode: project.viewMode,
    referencePhoto: project.referencePhoto ? { name: project.referencePhoto.name, mimeType: project.referencePhoto.mimeType, dataUrl: project.referencePhoto.dataUrl } : null,
  }
  // Validate before serializing
  validateProject(clean)
  const json = JSON.stringify(clean)
  if (json.length > MAX_PROJECT_BYTES) throw new Error(`Project is too large to save (${(json.length / (1024*1024)).toFixed(1)} MB > ${MAX_PROJECT_BYTES / (1024*1024)} MB). Try a smaller reference photo.`)
  return json
}

export function createDefaultProject(): ProjectFile {
  // Matches workspace initialState plus defaults
  return {
    version: PROJECT_VERSION,
    name: 'Kitchen Remodel Project',
    scene: [
      { id: 'base-01', kind: 'base-cabinet', name: 'Base cabinet', dimensionsMm: { width: 914.4, height: 876.3, depth: 609.6 }, rotationDegrees: 0, positionMm: { x: -650, y: 0, z: -300 } },
      { id: 'upper-01', kind: 'wall-cabinet', name: 'Wall cabinet', dimensionsMm: { width: 914.4, height: 762, depth: 304.8 }, rotationDegrees: 0, positionMm: { x: -650, y: 1480, z: -300 } },
      { id: 'tall-01', kind: 'tall-cabinet', name: 'Tall cabinet', dimensionsMm: { width: 457.2, height: 2133.6, depth: 609.6 }, rotationDegrees: 0, positionMm: { x: 650, y: 0, z: -300 } },
    ],
    selectedId: 'base-01',
    settings: { unit: 'in', showGrid: true },
    camera: { yaw: Math.atan2(-1, 1), pitch: Math.atan2(1, Math.hypot(-1, 1)), projection: 'perspective', zoom: 1 },
    viewMode: 'cad',
    referencePhoto: null,
  }
}
