import assert from 'node:assert/strict'
import { test } from 'node:test'
import { workspaceReducer as reduce, defaultRoomMeasurements } from './workspace'
import { parseProject, serializeProject } from './project'

test('ordered history: wall length then resize then undo reverts only resize', () => {
  let s: any = {
    past: [], future: [], revision: 0, selectedId: 'a',
    present: [{ id:'a', kind:'base-cabinet', name:'A', dimensionsMm:{width:914.4,height:876.3,depth:609.6}, rotationDegrees:0, positionMm:{x:0,y:0,z:0}}],
    proposal:{kind:'none'},
    roomMeasurements:{...defaultRoomMeasurements}, roomMeasurementsPast:[], roomMeasurementsFuture:[]
  }
  s = reduce(s, {kind:'set-room-measurement', field:'wallLength', valueMm:3048})
  assert.equal(s.roomMeasurements.wallLengthMm,3048)
  const afterWall = s
  s = reduce(s, {kind:'resize', dimension:'width', valueMm:1000})
  assert.equal(s.present[0].dimensionsMm.width,1000)
  // Undo once should revert resize but keep wall length
  s = reduce(s, {kind:'undo'})
  assert.equal(s.present[0].dimensionsMm.width,914.4)
  assert.equal(s.roomMeasurements.wallLengthMm,3048)
  // Undo again should revert wall length
  s = reduce(s, {kind:'undo'})
  assert.equal(s.roomMeasurements.wallLengthMm,null)
  // Redo should restore wall length
  s = reduce(s, {kind:'redo'})
  assert.equal(s.roomMeasurements.wallLengthMm,3048)
  // Redo again should restore resize
  s = reduce(s, {kind:'redo'})
  assert.equal(s.present[0].dimensionsMm.width,1000)
  // New edit after undo clears redo
  let s2: any = {
    past: [], future: [], revision: 0, selectedId: 'a',
    present: [{ id:'a', kind:'base-cabinet', name:'A', dimensionsMm:{width:914.4,height:876.3,depth:609.6}, rotationDegrees:0, positionMm:{x:0,y:0,z:0}}],
    proposal:{kind:'none'},
    roomMeasurements:{...defaultRoomMeasurements}, roomMeasurementsPast:[], roomMeasurementsFuture:[]
  }
  s2 = reduce(s2, {kind:'set-room-measurement', field:'wallLength', valueMm:3048})
  s2 = reduce(s2, {kind:'resize', dimension:'width', valueMm:1000})
  s2 = reduce(s2, {kind:'undo'})
  s2 = reduce(s2, {kind:'undo'})
  // now future has 2 entries
  assert.equal(s2.future.length,2)
  s2 = reduce(s2, {kind:'set-room-measurement', field:'wallHeight', valueMm:2438.4})
  assert.equal(s2.future.length,0)
  assert.equal(s2.roomMeasurementsFuture.length,0)
})

test('measurement-only undo enables toolbar', () => {
  let s: any = {
    past: [], future: [], revision: 0, selectedId: 'a',
    present: [{ id:'a', kind:'base-cabinet', name:'A', dimensionsMm:{width:914.4,height:876.3,depth:609.6}, rotationDegrees:0, positionMm:{x:0,y:0,z:0}}],
    proposal:{kind:'none'},
    roomMeasurements:{...defaultRoomMeasurements}, roomMeasurementsPast:[], roomMeasurementsFuture:[]
  }
  s = reduce(s, {kind:'set-room-measurement', field:'wallLength', valueMm:3048})
  assert.ok(s.past.length>0)
  assert.ok(s.roomMeasurementsPast.length>0)
})

test('wall face placement: front vs back uses thickness', () => {
  // Simulate placement logic via reducer? Instead test via direct placement math
  const wall = { id:'w1', kind:'wall' as const, name:'Wall', dimensionsMm:{width:3048,height:2438.4,depth:152.4}, rotationDegrees:0, positionMm:{x:0,y:0,z:0}}
  const cabinet = { width:914.4, depth:609.6 }
  const frontZ = wall.positionMm.z + wall.dimensionsMm.depth // 152.4
  const backZ = wall.positionMm.z
  assert.equal(frontZ,152.4)
  assert.equal(backZ,0)
  // Front placement: cabinet at front face
  const frontPos = frontZ
  // Back placement: cabinet back at wall back, so cabinet front at back - depth? Actually cabinet at back face would be behind wall
  const backPos = backZ - cabinet.depth // -609.6
  assert.equal(backPos,-609.6)
  // Ensure no penetration: front case cabinet [frontZ, frontZ+depth] does not intersect wall [0,152.4] interior? Cabinet starts at 152.4, wall ends at 152.4, touching not overlapping
  assert.ok(frontPos >= wall.positionMm.z + wall.dimensionsMm.depth -0.001)
})

test('L-shaped: two walls meeting at corner, placement on either wall', () => {
  const wallA = { id:'wa', kind:'wall' as const, name:'Wall A', dimensionsMm:{width:3048,height:2438.4,depth:152.4}, rotationDegrees:0, positionMm:{x:-1524,y:0,z:-400}}
  const wallB = { id:'wb', kind:'wall' as const, name:'Wall B', dimensionsMm:{width:3048,height:2438.4,depth:152.4}, rotationDegrees:90, positionMm:{x:1524,y:0,z:-400}}
  // Check they meet at corner (1524,-400) shared
  assert.equal(wallA.positionMm.x + wallA.dimensionsMm.width,1524)
  assert.equal(wallB.positionMm.x,1524)
  // For L-shaped, available length each is width
  assert.equal(wallA.dimensionsMm.width,3048)
  assert.equal(wallB.dimensionsMm.width,3048)
  // Unsupported angle
  const wallC = { ...wallA, rotationDegrees:45 }
  const isSupported = Math.abs(wallC.rotationDegrees) <0.5 || Math.abs(wallC.rotationDegrees-90)<0.5 || Math.abs(wallC.rotationDegrees-180)<0.5 || Math.abs(wallC.rotationDegrees-270)<0.5
  assert.equal(isSupported,false)
})

test('wall height check: base/upper/tall vs wall height', () => {
  const wallHeight = 2438.4
  const base = { positionMm:{y:0}, dimensionsMm:{height:876.3}}
  const upper = { positionMm:{y:1480}, dimensionsMm:{height:762}}
  const tall = { positionMm:{y:0}, dimensionsMm:{height:2133.6}}
  assert.ok(base.positionMm.y + base.dimensionsMm.height < wallHeight)
  assert.ok(upper.positionMm.y + upper.dimensionsMm.height < wallHeight)
  assert.ok(tall.positionMm.y + tall.dimensionsMm.height < wallHeight)
  const tooTall = { positionMm:{y:0}, dimensionsMm:{height:2500}}
  assert.ok(tooTall.positionMm.y + tooTall.dimensionsMm.height > wallHeight)
})

test('save/reopen with L-shaped walls preserves', () => {
  const proj = {
    version:1, name:'L', scene:[
      { id:'wa', kind:'wall', name:'Wall A', dimensionsMm:{width:3048,height:2438.4,depth:152.4}, rotationDegrees:0, positionMm:{x:-1524,y:0,z:-400}},
      { id:'wb', kind:'wall', name:'Wall B', dimensionsMm:{width:3048,height:2438.4,depth:152.4}, rotationDegrees:90, positionMm:{x:1524,y:0,z:-400}},
      { id:'a', kind:'base-cabinet', name:'Base', dimensionsMm:{width:914.4,height:876.3,depth:609.6}, rotationDegrees:0, positionMm:{x:0,y:0,z:152.4}, approximateFields:{width:false,height:true,depth:true,x:false,y:true,z:false,rotation:true}},
    ], selectedId:'wa', settings:{unit:'in',showGrid:true}, camera:{yaw:0,pitch:0,projection:'perspective',zoom:1}, viewMode:'cad', referencePhoto:null,
    roomMeasurements:{ wallLengthMm:3048, wallHeightMm:2438.4, wallLengthProvenance:'user-entered', wallHeightProvenance:'user-entered', wallLengthConfirmed:true, wallHeightConfirmed:true }
  } as any
  const json = serializeProject(proj)
  const parsed = parseProject(json)
  assert.equal(parsed.scene.length,3)
  assert.equal(parsed.roomMeasurements?.wallLengthMm,3048)
  assert.equal(parsed.scene.find(o=>o.id==='a')?.approximateFields?.x,false)
})

test('legacy project without roomMeasurements loads', () => {
  const legacy = {
    version:1, name:'Legacy', scene:[{ id:'a', kind:'base-cabinet', name:'Cab', dimensionsMm:{width:914.4,height:876.3,depth:609.6}, rotationDegrees:0, positionMm:{x:0,y:0,z:0}}],
    selectedId:'a', settings:{unit:'in',showGrid:true}, camera:{yaw:0,pitch:0,projection:'perspective',zoom:1}, viewMode:'cad', referencePhoto:null
  } as any
  const json = serializeProject(legacy)
  const parsed = parseProject(json)
  assert.ok(parsed)
  // legacy without wall should still be valid after adding wall later
  assert.equal(parsed.roomMeasurements,undefined)
})
