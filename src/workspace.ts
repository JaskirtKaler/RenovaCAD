import { useReducer } from 'react'

export type ObjectKind = 'base-cabinet' | 'wall-cabinet' | 'tall-cabinet' | 'wall' | 'sink'
export type Dimension = 'width' | 'height' | 'depth'
export type Unit = 'in' | 'mm'
export type ViewMode = 'photo' | 'cad' | 'render'
export type Axis = 'x' | 'y' | 'z'
export type PositionMm = Record<Axis, number>
export const TILE_MM = 304.8
export const POSITION_LIMIT_MM = 10000

export type ApproximateFields = {
  width: boolean
  height: boolean
  depth: boolean
  x: boolean
  y: boolean
  z: boolean
  rotation: boolean
}

export interface SceneObject {
  id: string
  kind: ObjectKind
  name: string
  dimensionsMm: Record<Dimension, number>
  rotationDegrees: number
  positionMm: PositionMm
  /** Which fields are approximate estimates (true) vs user-edited (false). Undefined for legacy files. Editing a field does NOT imply verified construction measurement. */
  approximateFields?: ApproximateFields
}

export const objectCatalog: Record<ObjectKind, { name: string; dimensionsMm: SceneObject['dimensionsMm'] }> = {
  'base-cabinet': { name: 'Base cabinet', dimensionsMm: { width: 914.4, height: 876.3, depth: 609.6 } },
  'wall-cabinet': { name: 'Wall cabinet', dimensionsMm: { width: 914.4, height: 762, depth: 304.8 } },
  'tall-cabinet': { name: 'Tall cabinet', dimensionsMm: { width: 457.2, height: 2133.6, depth: 609.6 } },
  wall: { name: 'Wall', dimensionsMm: { width: 3048, height: 2438.4, depth: 152.4 } },
  sink: { name: 'Sink', dimensionsMm: { width: 762, height: 228.6, depth: 508 } },
}

function createObject(kind: ObjectKind, id: string, positionMm: PositionMm): SceneObject {
  return { id, kind, ...objectCatalog[kind], rotationDegrees: 0, positionMm }
}

function placementForNewObject(objects: SceneObject[], kind: ObjectKind): PositionMm | undefined {
  const dimensions = objectCatalog[kind].dimensionsMm
  for (let z = 1100; z <= POSITION_LIMIT_MM; z += TILE_MM * 4) {
    for (let x = -650; x <= POSITION_LIMIT_MM; x += TILE_MM * 4) {
      const occupied = objects.some((object) => x < object.positionMm.x + object.dimensionsMm.width + 100 && x + dimensions.width + 100 > object.positionMm.x && z < object.positionMm.z + object.dimensionsMm.depth + 100 && z + dimensions.depth + 100 > object.positionMm.z)
      if (!occupied) return { x, y: kind === 'wall-cabinet' ? 1480 : 0, z }
    }
  }
}

export function canNudge(object: SceneObject | undefined, axis: Axis, direction: -1 | 1): boolean {
  if (!object || !Object.values(object.positionMm).every((value) => Number.isFinite(value) && Math.abs(value) <= POSITION_LIMIT_MM)) return false
  return Math.abs(object.positionMm[axis] + TILE_MM * direction) <= POSITION_LIMIT_MM
}

type Scene = SceneObject[]
export type Proposal = { kind: 'none' } | {
  kind: 'resize'
  status: 'pending' | 'applied' | 'canceled'
  objectId: string
  objectName: string
  revision: number
  beforeMm: number
  afterMm: number
}

export type MeasurementProvenance = 'approximate' | 'user-entered'
export interface RoomMeasurements {
  wallLengthMm: number | null
  wallHeightMm: number | null
  wallLengthProvenance: MeasurementProvenance | null
  wallHeightProvenance: MeasurementProvenance | null
  wallLengthConfirmed: boolean
  wallHeightConfirmed: boolean
}

export const defaultRoomMeasurements: RoomMeasurements = {
  wallLengthMm: null,
  wallHeightMm: null,
  wallLengthProvenance: null,
  wallHeightProvenance: null,
  wallLengthConfirmed: false,
  wallHeightConfirmed: false,
}

interface WorkspaceState {
  past: Scene[]
  present: Scene
  future: Scene[]
  revision: number
  selectedId: string | null
  proposal: Proposal
  roomMeasurements: RoomMeasurements
  roomMeasurementsPast: RoomMeasurements[]
  roomMeasurementsFuture: RoomMeasurements[]
}

type Action =
  | { kind: 'select'; id: string }
  | { kind: 'resize'; dimension: Dimension; valueMm: number }
  | { kind: 'rotate'; degrees: number }
  | { kind: 'nudge'; axis: Axis; direction: -1 | 1 }
  | { kind: 'set-position'; axis: Axis; valueMm: number }
  | { kind: 'move-to'; id: string; positionMm: PositionMm }
  | { kind: 'add'; objectKind: ObjectKind; id: string }
  | { kind: 'delete' }
  | { kind: 'sample-proposal' }
  | { kind: 'ai-proposal'; objectId: string; objectName: string; revision: number; beforeMm: number; afterMm: number }
  | { kind: 'apply-proposal' }
  | { kind: 'cancel-proposal' }
  | { kind: 'undo' }
  | { kind: 'redo' }
  | { kind: 'load'; scene: SceneObject[]; selectedId: string | null; roomMeasurements?: RoomMeasurements }
  | { kind: 'apply-layout'; objects: SceneObject[] }
  | { kind: 'set-room-measurement'; field: 'wallLength' | 'wallHeight'; valueMm: number | null }
  | { kind: 'confirm-room-measurement'; field: 'wallLength' | 'wallHeight' }

export const initialState: WorkspaceState = {
  past: [],
  present: [createObject('base-cabinet', 'base-01', { x: -650, y: 0, z: -300 }), createObject('wall-cabinet', 'upper-01', { x: -650, y: 1480, z: -300 }), createObject('tall-cabinet', 'tall-01', { x: 650, y: 0, z: -300 })],
  future: [],
  revision: 0,
  selectedId: 'base-01',
  proposal: { kind: 'resize', status: 'pending', objectId: 'base-01', objectName: 'Base cabinet', revision: 0, beforeMm: 914.4, afterMm: 1066.8 },
  roomMeasurements: { ...defaultRoomMeasurements },
  roomMeasurementsPast: [],
  roomMeasurementsFuture: [],
}

const initialStateRef = initialState

function commit(state: WorkspaceState, next: Scene): WorkspaceState {
  return {
    ...state,
    past: [...state.past.slice(-49), state.present],
    present: next,
    future: [],
    roomMeasurementsPast: [...state.roomMeasurementsPast.slice(-49), state.roomMeasurements],
    roomMeasurementsFuture: [],
    revision: state.revision + 1,
    proposal: { kind: 'none' },
  }
}

function restoreSelection(state: WorkspaceState, scene: Scene): string | null {
  return scene.some((object) => object.id === state.selectedId) ? state.selectedId : scene[0]?.id ?? null
}

export function workspaceReducer(state: WorkspaceState, action: Action): WorkspaceState {
  // Ensure legacy states missing roomMeasurements still work
  if (!state.roomMeasurements) (state as unknown as WorkspaceState).roomMeasurements = { ...defaultRoomMeasurements }
  if (!state.roomMeasurementsPast) (state as unknown as WorkspaceState).roomMeasurementsPast = []
  if (!state.roomMeasurementsFuture) (state as unknown as WorkspaceState).roomMeasurementsFuture = []
  const selected = state.present.find((object) => object.id === state.selectedId)
  switch (action.kind) {
    case 'select':
      return state.present.some((object) => object.id === action.id) ? { ...state, selectedId: action.id } : state
    case 'resize': {
      if (!selected || !Number.isFinite(action.valueMm) || action.valueMm < 25.4 || action.valueMm > 10000) return state
      const valueMm = Math.round(action.valueMm * 1000) / 1000
      if (Math.abs(selected.dimensionsMm[action.dimension] - valueMm) < 0.0005) return state
      return commit(state, state.present.map((object) => object.id === selected.id ? { ...object, dimensionsMm: { ...object.dimensionsMm, [action.dimension]: valueMm }, approximateFields: object.approximateFields ? { ...object.approximateFields, [action.dimension]: false } : undefined } : object))
    }
    case 'rotate':
      if (!selected || !Number.isFinite(action.degrees) || Math.abs(action.degrees) > 360 || selected.rotationDegrees === action.degrees) return state
      return commit(state, state.present.map((object) => object.id === selected.id ? { ...object, rotationDegrees: action.degrees, approximateFields: object.approximateFields ? { ...object.approximateFields, rotation: false } : undefined } : object))
    case 'nudge': {
      if (!selected || !canNudge(selected, action.axis, action.direction)) return state
      const coordinate = Math.round((selected.positionMm[action.axis] + TILE_MM * action.direction) * 1000) / 1000
      return commit(state, state.present.map((object) => object.id === selected.id ? { ...object, positionMm: { ...object.positionMm, [action.axis]: coordinate }, approximateFields: object.approximateFields ? { ...object.approximateFields, [action.axis]: false } : undefined } : object))
    }
    case 'set-position': {
      if (!selected || !Number.isFinite(action.valueMm) || Math.abs(action.valueMm) > POSITION_LIMIT_MM) return state
      const valueMm = Math.round(action.valueMm * 1000) / 1000
      if (Math.abs(selected.positionMm[action.axis] - valueMm) < 0.0005) return state
      return commit(state, state.present.map((object) => object.id === selected.id ? { ...object, positionMm: { ...object.positionMm, [action.axis]: valueMm }, approximateFields: object.approximateFields ? { ...object.approximateFields, [action.axis]: false } : undefined } : object))
    }
    case 'move-to': {
      const target = state.present.find((o) => o.id === action.id)
      if (!target) return state
      for (const axis of ['x', 'y', 'z'] as const) {
        if (!Number.isFinite(action.positionMm[axis]) || Math.abs(action.positionMm[axis]) > POSITION_LIMIT_MM) return state
      }
      const nextPos = {
        x: Math.round(action.positionMm.x * 1000) / 1000,
        y: Math.round(action.positionMm.y * 1000) / 1000,
        z: Math.round(action.positionMm.z * 1000) / 1000,
      }
      if (Math.abs(target.positionMm.x - nextPos.x) < 0.0005 && Math.abs(target.positionMm.y - nextPos.y) < 0.0005 && Math.abs(target.positionMm.z - nextPos.z) < 0.0005) return state
      const changed: Partial<ApproximateFields> = {}
      let hasChange = false
      for (const axis of ['x', 'y', 'z'] as const) {
        if (Math.abs(target.positionMm[axis] - nextPos[axis]) >= 0.0005) {
          changed[axis] = false
          hasChange = true
        }
      }
      if (!hasChange && !target.approximateFields) {
        return commit(state, state.present.map((o) => o.id === action.id ? { ...o, positionMm: nextPos } : o))
      }
      return commit(state, state.present.map((o) => o.id === action.id ? { ...o, positionMm: nextPos, approximateFields: o.approximateFields ? { ...o.approximateFields, ...changed } : undefined } : o))
    }
    case 'add': {
      const position = placementForNewObject(state.present, action.objectKind)
      if (!position) return state
      const next = commit(state, [...state.present, createObject(action.objectKind, action.id, position)])
      return { ...next, selectedId: action.id }
    }
    case 'delete': {
      if (!selected) return state
      const next = state.present.filter((object) => object.id !== selected.id)
      return { ...commit(state, next), selectedId: next[0]?.id ?? null }
    }
    case 'sample-proposal':
      return selected && selected.dimensionsMm.width < 10000 ? { ...state, proposal: { kind: 'resize', status: 'pending', objectId: selected.id, objectName: selected.name, revision: state.revision, beforeMm: selected.dimensionsMm.width, afterMm: Math.min(selected.dimensionsMm.width + 152.4, 10000) } } : state
    case 'ai-proposal': {
      const before = Math.round(action.beforeMm * 1000) / 1000
      const after = Math.round(action.afterMm * 1000) / 1000
      if (!Number.isFinite(before) || !Number.isFinite(after) || before < 25.4 || before > 10000 || after < 25.4 || after > 10000) return state
      if (Math.abs(before - after) < 0.0005) return state
      if (!Number.isInteger(action.revision) || action.revision < 0) return state
      // Object must still exist; beforeMm is echoed from backend snapshot. Allow stale before mismatch — apply will discard.
      if (!state.present.some((object) => object.id === action.objectId)) return { ...state, proposal: { kind: 'none' } }
      return { ...state, proposal: { kind: 'resize', status: 'pending', objectId: action.objectId, objectName: action.objectName, revision: action.revision, beforeMm: before, afterMm: after } }
    }
    case 'apply-proposal': {
      const proposal = state.proposal
      if (proposal.kind !== 'resize' || proposal.status !== 'pending' || proposal.revision !== state.revision) return state
      if (proposal.afterMm === proposal.beforeMm) return { ...state, proposal: { kind: 'none' } }
      if (!state.present.some((object) => object.id === proposal.objectId && object.dimensionsMm.width === proposal.beforeMm)) return { ...state, proposal: { kind: 'none' } }
      const next = commit(state, state.present.map((object) => object.id === proposal.objectId ? { ...object, dimensionsMm: { ...object.dimensionsMm, width: proposal.afterMm } } : object))
      return { ...next, proposal: { ...proposal, status: 'applied' } }
    }
    case 'cancel-proposal':
      return state.proposal.kind === 'resize' && state.proposal.status === 'pending' ? { ...state, proposal: { ...state.proposal, status: 'canceled' } } : state
    case 'undo': {
      if (state.past.length === 0) return state
      const previous = state.past[state.past.length - 1]
      const prevRM = state.roomMeasurementsPast[state.roomMeasurementsPast.length - 1]
      // Past and roomMeasurementsPast are kept in lockstep; each entry corresponds to one ordered action
      if (prevRM === undefined) return state
      return {
        ...state,
        past: state.past.slice(0, -1),
        present: previous,
        future: [state.present, ...state.future],
        roomMeasurements: prevRM,
        roomMeasurementsPast: state.roomMeasurementsPast.slice(0, -1),
        roomMeasurementsFuture: [state.roomMeasurements, ...state.roomMeasurementsFuture],
        selectedId: restoreSelection(state, previous),
        revision: state.revision + 1,
        proposal: { kind: 'none' },
      }
    }
    case 'redo': {
      if (state.future.length === 0) return state
      const next = state.future[0]
      const nextRM = state.roomMeasurementsFuture[0]
      if (nextRM === undefined) return state
      return {
        ...state,
        past: [...state.past, state.present],
        present: next,
        future: state.future.slice(1),
        roomMeasurements: nextRM,
        roomMeasurementsPast: [...state.roomMeasurementsPast, state.roomMeasurements],
        roomMeasurementsFuture: state.roomMeasurementsFuture.slice(1),
        selectedId: restoreSelection(state, next),
        revision: state.revision + 1,
        proposal: { kind: 'none' },
      }
    }
    case 'load': {
      // Loading a project replaces scene, resets history, revision, and any pending proposal.
      // Selection is restored if it exists in new scene, otherwise first object.
      const scene = action.scene
      const ids = new Set(scene.map(o => o.id))
      const selectedId = action.selectedId && ids.has(action.selectedId) ? action.selectedId : scene[0]?.id ?? null
      const rm = action.roomMeasurements ?? { ...defaultRoomMeasurements }
      return { past: [], present: scene, future: [], revision: 0, selectedId, proposal: { kind: 'none' }, roomMeasurements: rm, roomMeasurementsPast: [], roomMeasurementsFuture: [] }
    }
    case 'apply-layout': {
      // Apply approved draft as one undoable commit that adds objects to current scene.
      // Validate each object strictly; preserve existing scene on invalid input.
      if (!Array.isArray(action.objects) || action.objects.length === 0 || action.objects.length > 50) return state
      if (state.present.length + action.objects.length > 50) return state
      const seen = new Set(state.present.map(o => o.id))
      for (const o of action.objects) {
        if (typeof o.id !== 'string' || o.id.length === 0 || o.id.length > 128) return state
        if (seen.has(o.id)) return state
        seen.add(o.id)
        if (!['base-cabinet', 'wall-cabinet', 'tall-cabinet', 'wall', 'sink'].includes(o.kind)) return state
        if (typeof o.name !== 'string' || o.name.length === 0 || o.name.length > 100) return state
        if (!Number.isFinite(o.dimensionsMm.width) || o.dimensionsMm.width < 25.4 || o.dimensionsMm.width > 10000) return state
        if (!Number.isFinite(o.dimensionsMm.height) || o.dimensionsMm.height < 25.4 || o.dimensionsMm.height > 10000) return state
        if (!Number.isFinite(o.dimensionsMm.depth) || o.dimensionsMm.depth < 25.4 || o.dimensionsMm.depth > 10000) return state
        if (!Number.isFinite(o.rotationDegrees) || Math.abs(o.rotationDegrees) > 360) return state
        if (!Number.isFinite(o.positionMm.x) || Math.abs(o.positionMm.x) > 10000) return state
        if (!Number.isFinite(o.positionMm.y) || Math.abs(o.positionMm.y) > 10000) return state
        if (!Number.isFinite(o.positionMm.z) || Math.abs(o.positionMm.z) > 10000) return state
        if (o.approximateFields !== undefined) {
          const af = o.approximateFields as Record<string, unknown>
          if (!af || typeof af !== 'object') return state
          for (const k of ['width', 'height', 'depth', 'x', 'y', 'z', 'rotation'] as const) {
            if (typeof af[k] !== 'boolean') return state
          }
        }
        // Normalize to 0.001 mm
        o.dimensionsMm.width = Math.round(o.dimensionsMm.width * 1000) / 1000
        o.dimensionsMm.height = Math.round(o.dimensionsMm.height * 1000) / 1000
        o.dimensionsMm.depth = Math.round(o.dimensionsMm.depth * 1000) / 1000
        o.positionMm.x = Math.round(o.positionMm.x * 1000) / 1000
        o.positionMm.y = Math.round(o.positionMm.y * 1000) / 1000
        o.positionMm.z = Math.round(o.positionMm.z * 1000) / 1000
        o.rotationDegrees = Math.round(o.rotationDegrees * 1000) / 1000
      }
      const next = [...state.present, ...action.objects]
      const committed = commit(state, next)
      // Select first newly added object
      return { ...committed, selectedId: action.objects[0]?.id ?? committed.selectedId }
    }
    case 'set-room-measurement': {
      const field = action.field
      const val = action.valueMm === null ? null : Math.round(action.valueMm * 1000) / 1000
      if (val !== null && (!Number.isFinite(val) || val < 25.4 || val > 10000)) return state
      const current = field === 'wallLength' ? state.roomMeasurements.wallLengthMm : state.roomMeasurements.wallHeightMm
      if (current === val) return state
      const nextRM: RoomMeasurements = {
        ...state.roomMeasurements,
        wallLengthMm: field === 'wallLength' ? val : state.roomMeasurements.wallLengthMm,
        wallHeightMm: field === 'wallHeight' ? val : state.roomMeasurements.wallHeightMm,
        wallLengthProvenance: field === 'wallLength' ? (val === null ? null : 'user-entered') : state.roomMeasurements.wallLengthProvenance,
        wallHeightProvenance: field === 'wallHeight' ? (val === null ? null : 'user-entered') : state.roomMeasurements.wallHeightProvenance,
        wallLengthConfirmed: field === 'wallLength' ? false : state.roomMeasurements.wallLengthConfirmed,
        wallHeightConfirmed: field === 'wallHeight' ? false : state.roomMeasurements.wallHeightConfirmed,
      }
      if (val === null) {
        nextRM.wallLengthConfirmed = field === 'wallLength' ? false : nextRM.wallLengthConfirmed
        nextRM.wallHeightConfirmed = field === 'wallHeight' ? false : nextRM.wallHeightConfirmed
      }
      return {
        ...state,
        past: [...state.past.slice(-49), state.present],
        present: state.present,
        future: [],
        roomMeasurements: nextRM,
        roomMeasurementsPast: [...state.roomMeasurementsPast.slice(-49), state.roomMeasurements],
        roomMeasurementsFuture: [],
        revision: state.revision + 1,
        proposal: { kind: 'none' },
      }
    }
    case 'confirm-room-measurement': {
      const field = action.field
      const val = field === 'wallLength' ? state.roomMeasurements.wallLengthMm : state.roomMeasurements.wallHeightMm
      if (val === null || !Number.isFinite(val)) return state
      const isConfirmed = field === 'wallLength' ? state.roomMeasurements.wallLengthConfirmed : state.roomMeasurements.wallHeightConfirmed
      if (isConfirmed) return state
      const nextRM: RoomMeasurements = {
        ...state.roomMeasurements,
        wallLengthConfirmed: field === 'wallLength' ? true : state.roomMeasurements.wallLengthConfirmed,
        wallHeightConfirmed: field === 'wallHeight' ? true : state.roomMeasurements.wallHeightConfirmed,
        wallLengthProvenance: field === 'wallLength' ? 'user-entered' : state.roomMeasurements.wallLengthProvenance,
        wallHeightProvenance: field === 'wallHeight' ? 'user-entered' : state.roomMeasurements.wallHeightProvenance,
      }
      return {
        ...state,
        past: [...state.past.slice(-49), state.present],
        present: state.present,
        future: [],
        roomMeasurements: nextRM,
        roomMeasurementsPast: [...state.roomMeasurementsPast.slice(-49), state.roomMeasurements],
        roomMeasurementsFuture: [],
        revision: state.revision + 1,
        proposal: { kind: 'none' },
      }
    }
    default: {
      const exhaustive: never = action
      return exhaustive
    }
  }
}

export function useWorkspace() {
  const [state, dispatch] = useReducer(workspaceReducer, initialState)
  const selectedObject = state.present.find((object) => object.id === state.selectedId)
  return { state, dispatch, selectedObject }
}

export function displayMeasurement(valueMm: number, unit: Unit): string {
  return Number((unit === 'in' ? valueMm / 25.4 : valueMm).toFixed(2)).toString()
}

export function isApproximateField(obj: SceneObject | undefined, field: keyof ApproximateFields): boolean | undefined {
  return obj?.approximateFields?.[field]
}

export function approximateBadgeLabel(obj: SceneObject | undefined, field: keyof ApproximateFields): string | null {
  const v = isApproximateField(obj, field)
  if (v === undefined) return null
  return v ? 'approx — from photo' : 'edited — not verified'
}
