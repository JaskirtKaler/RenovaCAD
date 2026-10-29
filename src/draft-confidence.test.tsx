import assert from 'node:assert/strict'
import { afterEach, beforeEach, test } from 'node:test'
import { act, create, type ReactTestInstance, type ReactTestRenderer } from 'react-test-renderer'
import App from './App'
import { parseProject, serializeProject } from './project'

const listeners = new Map<string, Set<EventListener>>()
let saved: Map<string, PropertyDescriptor | undefined>
function installGlobals() {
  const names = ['IS_REACT_ACT_ENVIRONMENT', 'HTMLElement', 'Element', 'HTMLInputElement', 'HTMLTextAreaElement', 'document', 'window', 'navigator', 'crypto', 'FileReader']
  saved = new Map(names.map((n) => [n, Object.getOwnPropertyDescriptor(globalThis as unknown as Record<string, unknown>, n)]))
  class ElementStub { tagName='DIV'; isContentEditable=false; focus(){}; closest(): ElementStub|null {return null}}
  class HtmlElementStub extends ElementStub {}
  class InputStub extends HtmlElementStub {}
  class TextareaStub extends HtmlElementStub {}
  class FileReaderStub { result:string|null=null; onload:(()=>void)|null=null; readAsDataURL(_f:unknown){this.result='data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+ip1sAAAAASUVORK5CYII='; setTimeout(()=>this.onload?.(),0)}}
  Object.defineProperties(globalThis, {
    IS_REACT_ACT_ENVIRONMENT:{configurable:true,value:true},
    HTMLElement:{configurable:true,value:HtmlElementStub},
    Element:{configurable:true,value:ElementStub},
    HTMLInputElement:{configurable:true,value:InputStub},
    HTMLTextAreaElement:{configurable:true,value:TextareaStub},
    FileReader:{configurable:true,value:FileReaderStub},
    document:{configurable:true,value:{activeElement:null,querySelector:()=>null,addEventListener(k:string,l:EventListener){if(!listeners.has(k))listeners.set(k,new Set());listeners.get(k)?.add(l)},removeEventListener(k:string,l:EventListener){listeners.get(k)?.delete(l)}}},
    window:{configurable:true,value:{setTimeout,clearTimeout,addEventListener(k:string,l:EventListener){if(!listeners.has(k))listeners.set(k,new Set());listeners.get(k)?.add(l)},removeEventListener(k:string,l:EventListener){listeners.get(k)?.delete(l)},confirm:()=>true}},
    navigator:{configurable:true,value:{userAgent:'Electron'}},
    crypto:{configurable:true,value:{randomUUID:()=> 'test-'+Math.random().toString(36).slice(2,8)}},
  } as unknown as PropertyDescriptorMap)
}
function restoreGlobals(){ for(const [n,d] of saved){ if(d) Object.defineProperty(globalThis,n,d); else Reflect.deleteProperty(globalThis as unknown as Record<string,unknown>,n)}}
function text(n:ReactTestInstance):string{return n.children.map(c=>typeof c==='string'?c:text(c as ReactTestInstance)).join('')}
function host(type:string, root:ReactTestInstance, pred:(n:ReactTestInstance)=>boolean){const m=root.findAll(n=>n.type===type && pred(n)); assert.equal(m.length,1,`Expected one ${type} found ${m.length}`); return m[0]}

async function mount(api:Record<string,unknown>, proj:Record<string,unknown>){
  listeners.clear()
  const w=(globalThis as unknown as {window:Record<string,unknown>}).window as Record<string,unknown>
  w['renovacadApi']=api; w['renovacadProject']=proj
  let r:ReactTestRenderer|undefined
  await act(()=>{ r=create(<App/>, {createNodeMock:()=>({style:{cursor:''},focus(){},click(){},scrollIntoView(){},contains:()=>false,addEventListener(){},removeEventListener(){},querySelector:()=>null,querySelectorAll:()=>[]})} as unknown as Parameters<typeof create>[1])})
  if(!r) throw new Error('mount failed')
  return {root:()=>r!.root}
}
function fakeProj(){return {isAvailable:()=>true,setDirty:async()=>({ok:true}),confirmUnsaved:async()=>({choice:'discard' as const}),confirmClose:async()=>({ok:true}),openProject:async()=>({canceled:true}),saveProject:async()=>({canceled:true}),onRequestSaveBeforeQuit:()=>()=>{}}}

function makeDraft(isApprox: boolean|null){
  return {
    kind:'layout_draft' as const,
    draft:{
      version:1,
      objects:[
        {kind:'base-cabinet', name:'Base 1', dimensionsMm:{width:914.4,height:876.3,depth:609.6}, positionMm:{x:-650,y:0,z:-300}, rotationDegrees:0},
        {kind:'wall-cabinet', name:'Wall 1', dimensionsMm:{width:914.4,height:762,depth:304.8}, positionMm:{x:-650,y:1480,z:-300}, rotationDegrees:0},
      ],
      description:'Draft',
      followUpQuestions:['Q?'],
      warnings:['Approximate dimensions — please verify'],
      isApproximate: isApprox as unknown as boolean,
    }
  }
}

beforeEach(()=>installGlobals())
afterEach(()=>{listeners.clear(); restoreGlobals()})

test('draft input: intermediate typing, negative, decimal, empty flagged, commit on blur, unit switch preserves mm', async ()=>{
  const api={isAvailable:()=>true,getStatus:async()=>({ready:true,address:'127.0.0.1:8787',error:null}),proposeEdit:async()=>({kind:'clarification',message:'?'}),analyzePhoto:async()=>({kind:'analysis',description:'x',followUpQuestions:[]}),proposeLayout:async()=>makeDraft(true)}
  const {root}=await mount(api as unknown as Record<string,unknown>, fakeProj())
  const fileInput=()=>host('input',root(),n=>n.props.type==='file')
  await act(()=> fileInput().props.onChange({target:{files:[{name:'k.png',type:'image/png',size:100} as unknown as File],value:'k.png'}}))
  await act(async()=>{await new Promise(r=>setTimeout(r,20))})
  const btn=root().findAll(n=>n.type==='button' && n.props['aria-label']==='Create draft layout')[0]
  await act(async()=>{btn.props.onClick(); await new Promise(r=>setTimeout(r,20))})
  // Width input
  let widthInput=root().findAll(n=>n.type==='input' && n.props['aria-label']==='Base 1 width')[0]
  // Type intermediate "34." should keep text until blur, then commit 34
  await act(()=>{widthInput.props.onChange({target:{value:'34.'}})})
  await act(async()=>{await new Promise(r=>setTimeout(r,0))})
  widthInput=root().findAll(n=>n.type==='input' && n.props['aria-label']==='Base 1 width')[0]
  assert.equal(String(widthInput.props.value),'34.')
  await act(()=>{widthInput.props.onBlur()})
  await act(async()=>{await new Promise(r=>setTimeout(r,0))})
  widthInput=root().findAll(n=>n.type==='input' && n.props['aria-label']==='Base 1 width')[0]
  assert.equal(String(widthInput.props.value),'34')
  assert.match(text(root()),/edited/)
  // Negative position — unit is in, so -100 in = -2540 mm (valid), -25.59 in = -650 mm
  let xInput=root().findAll(n=>n.type==='input' && n.props['aria-label']==='Base 1 x')[0]
  await act(()=>{xInput.props.onChange({target:{value:'-100'}})})
  await act(()=>{xInput.props.onBlur()})
  await act(async()=>{await new Promise(r=>setTimeout(r,0))})
  xInput=root().findAll(n=>n.type==='input' && n.props['aria-label']==='Base 1 x')[0]
  assert.equal(String(xInput.props.value),'-100')
  // Clearing field (empty) should flag invalid and keep empty visible
  await act(()=>{xInput.props.onChange({target:{value:''}})})
  await act(()=>{xInput.props.onBlur()})
  await act(async()=>{await new Promise(r=>setTimeout(r,0))})
  xInput=root().findAll(n=>n.type==='input' && n.props['aria-label']==='Base 1 x')[0]
  assert.equal(String(xInput.props.value),'')
  assert.equal(xInput.props['aria-invalid'],true)
  // Fix it — back to -25.59 in which is -650 mm
  await act(()=>{xInput.props.onChange({target:{value:'-25.59'}})})
  await act(()=>{xInput.props.onBlur()})
  await act(async()=>{await new Promise(r=>setTimeout(r,0))})
  xInput=root().findAll(n=>n.type==='input' && n.props['aria-label']==='Base 1 x')[0]
  assert.equal(String(xInput.props.value),'-25.59')
  assert.equal(xInput.props['aria-invalid'],false)
  // Unit switch should preserve mm: width 34 in = 863.6 mm, switching to mm should show 863.6
  // Find settings and switch to mm
  const settingsBtn=root().findAll(n=>n.type==='button' && n.props['aria-label']==='Workspace settings')[0]
  await act(()=> settingsBtn.props.onClick())
  await act(async()=>{await new Promise(r=>setTimeout(r,0))})
  const mmBtn=root().findAll(n=>n.type==='button' && text(n).trim()==='mm')[0]
  await act(()=> mmBtn.props.onClick())
  const closeBtn=root().findAll(n=>n.type==='button' && n.props['aria-label']==='Close dialog')[0]
  await act(()=> closeBtn.props.onClick())
  await act(async()=>{await new Promise(r=>setTimeout(r,0))})
  widthInput=root().findAll(n=>n.type==='input' && n.props['aria-label']==='Base 1 width')[0]
  // 34 in -> 863.6 mm
  assert.match(String(widthInput.props.value),/863\.6/)
  // Apply corrected draft should succeed
  const applyBtn=host('button',root(),n=>n.props['aria-label']==='Apply draft layout')
  await act(()=>{applyBtn.props.onClick()})
  await act(async()=>{await new Promise(r=>setTimeout(r,10))})
  // Should have applied 2 objects
  assert.equal(root().findAll(n=>n.type==='button' && String(n.props.className).includes('scene-row')).length,5)
})

test('confidence: provider claiming exact still treated as approximate, partially edited, save/reopen and undo', async ()=>{
  const api={isAvailable:()=>true,getStatus:async()=>({ready:true,address:'127.0.0.1:8787',error:null}),proposeEdit:async()=>({kind:'clarification',message:'?'}),analyzePhoto:async()=>({kind:'analysis',description:'x',followUpQuestions:[]}),proposeLayout:async()=>makeDraft(false)}
  let saved:string|null=null
  const proj={
    isAvailable:()=>true,setDirty:async()=>({ok:true}),confirmUnsaved:async()=>({choice:'discard' as const}),confirmClose:async()=>({ok:true}),
    openProject:async()=>({canceled:false,filePath:'/tmp/saved.renovacad',content:saved??''}),
    saveProject:async(payload:unknown)=>{saved=(payload as {content:string}).content; return {canceled:false,filePath:'/tmp/saved.renovacad'}},
    onRequestSaveBeforeQuit:()=>()=>{}
  }
  const {root}=await mount(api as unknown as Record<string,unknown>, proj as unknown as Record<string,unknown>)
  const fileInput=()=>host('input',root(),n=>n.props.type==='file')
  await act(()=> fileInput().props.onChange({target:{files:[{name:'k.png',type:'image/png',size:100} as unknown as File],value:'k.png'}}))
  await act(async()=>{await new Promise(r=>setTimeout(r,20))})
  const btn=root().findAll(n=>n.type==='button' && n.props['aria-label']==='Create draft layout')[0]
  await act(async()=>{btn.props.onClick(); await new Promise(r=>setTimeout(r,20))})
  // Even though provider said false, UI must show approx badges
  assert.match(text(root()),/approx/)
  // Edit one field
  const w=root().findAll(n=>n.type==='input' && n.props['aria-label']==='Base 1 width')[0]
  await act(()=>{w.props.onChange({target:{value:'40'}})})
  await act(()=>{w.props.onBlur()})
  await act(async()=>{await new Promise(r=>setTimeout(r,0))})
  assert.match(text(root()),/edited/)
  // Apply
  const apply=host('button',root(),n=>n.props['aria-label']==='Apply draft layout')
  await act(()=>{apply.props.onClick()})
  await act(async()=>{await new Promise(r=>setTimeout(r,10))})
  assert.equal(root().findAll(n=>n.type==='button' && String(n.props.className).includes('scene-row')).length,5)
  // Check confidence persisted in saved file
  const saveBtn=root().findAll(n=>n.type==='button' && String(n.props['aria-label']).includes('Save project'))[0]
  await act(async()=>{saveBtn.props.onClick(); await new Promise(r=>setTimeout(r,20))})
  assert.ok(saved)
  const parsed=parseProject(saved!)
  const added=parsed.scene.find(o=>o.name==='Base 1')
  assert.ok(added)
  assert.equal(added?.approximateFields?.width,false) // edited
  assert.equal(added?.approximateFields?.height,true) // approx
  // Undo should revert applied objects but keep original scene
  const undo=host('button',root(),n=>n.props['aria-label']==='Undo (⌘Z)')
  await act(()=>{undo.props.onClick()})
  await act(async()=>{await new Promise(r=>setTimeout(r,0))})
  assert.equal(root().findAll(n=>n.type==='button' && String(n.props.className).includes('scene-row')).length,3)
  // Redo
  const redo=host('button',root(),n=>n.props['aria-label']==='Redo (⇧⌘Z)')
  await act(()=>{redo.props.onClick()})
  await act(async()=>{await new Promise(r=>setTimeout(r,0))})
  assert.equal(root().findAll(n=>n.type==='button' && String(n.props.className).includes('scene-row')).length,5)
  // Reopen (parse saved) should still have confidence
  const openBtn=root().findAll(n=>n.type==='button' && String(n.props['aria-label']).includes('Open project'))[0]
  await act(async()=>{openBtn.props.onClick(); await new Promise(r=>setTimeout(r,20))})
  assert.equal(root().findAll(n=>n.type==='button' && String(n.props.className).includes('scene-row')).length,5)
  assert.match(text(root()),/approx/)
  // Legacy file without confidence should still open
  const legacy={version:1,name:'Legacy',scene:[{id:'a',kind:'base-cabinet',name:'Cab',dimensionsMm:{width:914.4,height:876.3,depth:609.6},rotationDegrees:0,positionMm:{x:0,y:0,z:0}}],selectedId:'a',settings:{unit:'in',showGrid:true},camera:{yaw:0,pitch:0,projection:'perspective',zoom:1},viewMode:'cad',referencePhoto:null}
  const legacyJson=serializeProject(legacy as unknown as Parameters<typeof serializeProject>[0])
  assert.doesNotThrow(()=>parseProject(legacyJson))
})

test('project save/reopen full workflow with photo and confidence', async ()=>{
  const api={isAvailable:()=>true,getStatus:async()=>({ready:true,address:'127.0.0.1:8787',error:null}),proposeEdit:async()=>({kind:'clarification',message:'?'}),analyzePhoto:async()=>({kind:'analysis',description:'x',followUpQuestions:[]}),proposeLayout:async()=>makeDraft(true)}
  let saved:string|null=null
  const proj={
    isAvailable:()=>true,setDirty:async()=>({ok:true}),confirmUnsaved:async()=>({choice:'discard' as const}),confirmClose:async()=>({ok:true}),
    openProject:async()=>({canceled:false,filePath:'/tmp/x.renovacad',content:saved??''}),
    saveProject:async(p:unknown)=>{saved=(p as {content:string}).content; return {canceled:false,filePath:'/tmp/x.renovacad'}},
    onRequestSaveBeforeQuit:()=>()=>{}
  }
  const {root}=await mount(api as unknown as Record<string,unknown>, proj as unknown as Record<string,unknown>)
  const fileInput=()=>host('input',root(),n=>n.props.type==='file')
  await act(()=> fileInput().props.onChange({target:{files:[{name:'k.png',type:'image/png',size:100} as unknown as File],value:'k.png'}}))
  await act(async()=>{await new Promise(r=>setTimeout(r,20))})
  const btn=root().findAll(n=>n.type==='button' && n.props['aria-label']==='Create draft layout')[0]
  await act(async()=>{btn.props.onClick(); await new Promise(r=>setTimeout(r,20))})
  const apply=host('button',root(),n=>n.props['aria-label']==='Apply draft layout')
  await act(()=>{apply.props.onClick()})
  await act(async()=>{await new Promise(r=>setTimeout(r,10))})
  assert.equal(root().findAll(n=>n.type==='button' && String(n.props.className).includes('scene-row')).length,5)
  const saveBtn=root().findAll(n=>n.type==='button' && String(n.props['aria-label']).includes('Save project'))[0]
  await act(async()=>{saveBtn.props.onClick(); await new Promise(r=>setTimeout(r,20))})
  const parsed=parseProject(saved!)
  assert.equal(parsed.scene.length,5)
  assert.ok(parsed.referencePhoto)
  assert.ok(parsed.scene.some(o=>o.approximateFields))
})
