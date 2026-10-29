import { useReducer } from 'react'

export type ObjectKind = 'base-cabinet' | 'wall-cabinet' | 'tall-cabinet' | 'wall' | 'sink'
export type Dimension = 'width' | 'height' | 'depth'
export type Unit = 'in' | 'mm'
export type ViewMode = 'photo' | 'cad' | 'render'
export type Axis = 'x' | 'y' | 'z'
export type PositionMm = Record<Axis, number>
export const TILE_MM = 304.8
export const POSITION_LIMIT_MM = 10000

export interface SceneObject {
  id: string
  kind: ObjectKind
  name: string
  dimensionsMm: Record<Dimension, number>
  rotationDegrees: number
  positionMm: PositionMm
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

interface WorkspaceState {
  past: Scene[]
  present: Scene
  future: Scene[]
  revision: number
  selectedId: string | null
  proposal: Proposal
}

type Action =
  | { kind: 'select'; id: string }
  | { kind: 'resize'; dimension: Dimension; valueMm: number }
  | { kind: 'rotate'; degrees: number }
  | { kind: 'nudge'; axis: Axis; direction: -1 | 1 }
  | { kind: 'set-position'; axis: Axis; valueMm: number }
  | { kind: 'add'; objectKind: ObjectKind; id: string }
  | { kind: 'delete' }
  | { kind: 'sample-proposal' }
  | { kind: 'ai-proposal'; objectId: string; objectName: string; revision: number; beforeMm: number; afterMm: number }
  | { kind: 'apply-proposal' }
  | { kind: 'cancel-proposal' }
  | { kind: 'undo' }
  | { kind: 'redo' }

const initialState: WorkspaceState = {
  past: [],
  present: [createObject('base-cabinet', 'base-01', { x: -650, y: 0, z: -300 }), createObject('wall-cabinet', 'upper-01', { x: -650, y: 1480, z: -300 }), createObject('tall-cabinet', 'tall-01', { x: 650, y: 0, z: -300 })],
  future: [],
  revision: 0,
  selectedId: 'base-01',
  proposal: { kind: 'resize', status: 'pending', objectId: 'base-01', objectName: 'Base cabinet', revision: 0, beforeMm: 914.4, afterMm: 1066.8 },
}

function commit(state: WorkspaceState, next: Scene): WorkspaceState {
  return { ...state, past: [...state.past.slice(-49), state.present], present: next, future: [], revision: state.revision + 1, proposal: { kind: 'none' } }
}

function restoreSelection(state: WorkspaceState, scene: Scene): string | null {
  return scene.some((object) => object.id === state.selectedId) ? state.selectedId : scene[0]?.id ?? null
}

export function workspaceReducer(state: WorkspaceState, action: Action): WorkspaceState {
  const selected = state.present.find((object) => object.id === state.selectedId)
  switch (action.kind) {
    case 'select':
      return state.present.some((object) => object.id === action.id) ? { ...state, selectedId: action.id } : state
    case 'resize': {
      if (!selected || !Number.isFinite(action.valueMm) || action.valueMm < 25.4 || action.valueMm > 10000) return state
      const valueMm = Math.round(action.valueMm * 1000) / 1000
      if (Math.abs(selected.dimensionsMm[action.dimension] - valueMm) < 0.0005) return state
      return commit(state, state.present.map((object) => object.id === selected.id ? { ...object, dimensionsMm: { ...object.dimensionsMm, [action.dimension]: valueMm } } : object))
    }
    case 'rotate':
      if (!selected || !Number.isFinite(action.degrees) || Math.abs(action.degrees) > 360 || selected.rotationDegrees === action.degrees) return state
      return commit(state, state.present.map((object) => object.id === selected.id ? { ...object, rotationDegrees: action.degrees } : object))
    case 'nudge': {
      if (!selected || !canNudge(selected, action.axis, action.direction)) return state
      const coordinate = Math.round((selected.positionMm[action.axis] + TILE_MM * action.direction) * 1000) / 1000
      return commit(state, state.present.map((object) => object.id === selected.id ? { ...object, positionMm: { ...object.positionMm, [action.axis]: coordinate } } : object))
    }
    case 'set-position': {
      if (!selected || !Number.isFinite(action.valueMm) || Math.abs(action.valueMm) > POSITION_LIMIT_MM) return state
      const valueMm = Math.round(action.valueMm * 1000) / 1000
      if (Math.abs(selected.positionMm[action.axis] - valueMm) < 0.0005) return state
      return commit(state, state.present.map((object) => object.id === selected.id ? { ...object, positionMm: { ...object.positionMm, [action.axis]: valueMm } } : object))
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
      const previous = state.past.at(-1)
      if (!previous) return state
      return { ...state, past: state.past.slice(0, -1), present: previous, future: [state.present, ...state.future], selectedId: restoreSelection(state, previous), revision: state.revision + 1, proposal: { kind: 'none' } }
    }
    case 'redo': {
      const next = state.future[0]
      if (!next) return state
      return { ...state, past: [...state.past, state.present], present: next, future: state.future.slice(1), selectedId: restoreSelection(state, next), revision: state.revision + 1, proposal: { kind: 'none' } }
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
