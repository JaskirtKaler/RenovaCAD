import { contextBridge, ipcRenderer } from 'electron'

export type ProposePayload = {
  instruction: string
  selectedObjectId: string
  sceneRevision: number
  scene: { objects: unknown[] }
}

export type ProposeResult =
  | { kind: 'proposal'; proposal: { objectId: string; objectName: string; operation: string; dimension: string; beforeMm: number; afterMm: number; explanation: string; sceneRevision: number } }
  | { kind: 'clarification'; message: string; sceneRevision?: number }
  | { kind: 'error'; code: string; message: string; httpStatus?: number }

export type AnalyzePhotoPayload = {
  image: { name: string; mimeType: string; dataUrl: string }
}

export type AnalyzePhotoResult =
  | { kind: 'analysis'; description: string; followUpQuestions: string[] }
  | { kind: 'error'; code: string; message: string; httpStatus?: number }

export type ProposeLayoutPayload = {
  image: { name: string; mimeType: string; dataUrl: string }
}

export type ProposeLayoutResult =
  | { kind: 'layout_draft'; draft: { version: number; objects: { kind: string; name: string; dimensionsMm: { width: number; height: number; depth: number }; positionMm: { x: number; y: number; z: number }; rotationDegrees: number }[]; description: string; followUpQuestions: string[]; warnings: string[]; isApproximate: boolean } }
  | { kind: 'needs_info'; message: string; followUpQuestions: string[] }
  | { kind: 'error'; code: string; message: string; httpStatus?: number }

contextBridge.exposeInMainWorld('renovacadApi', {
  isAvailable: (): boolean => true,
  proposeEdit: (payload: ProposePayload): Promise<ProposeResult> => ipcRenderer.invoke('ai:propose-edit', payload),
  analyzePhoto: (payload: AnalyzePhotoPayload): Promise<AnalyzePhotoResult> => ipcRenderer.invoke('ai:analyze-photo', payload),
  proposeLayout: (payload: ProposeLayoutPayload): Promise<ProposeLayoutResult> => ipcRenderer.invoke('ai:propose-layout', payload),
  getStatus: (): Promise<{ ready: boolean; address: string | null; error: string | null }> => ipcRenderer.invoke('ai:status'),
})

contextBridge.exposeInMainWorld('renovacadProject', {
  isAvailable: (): boolean => true,
  setDirty: (dirty: boolean): Promise<{ ok: boolean }> => ipcRenderer.invoke('project:set-dirty', dirty),
  confirmUnsaved: (message?: string): Promise<{ choice: 'save' | 'discard' | 'cancel' }> => ipcRenderer.invoke('project:confirm-unsaved', message),
  confirmClose: (): Promise<{ ok: boolean }> => ipcRenderer.invoke('project:confirm-close'),
  openProject: (): Promise<{ canceled: boolean; filePath?: string; content?: string; error?: string }> => ipcRenderer.invoke('project:open'),
  saveProject: (payload: { filePath?: string | null; content: string; defaultName?: string }): Promise<{ canceled: boolean; filePath?: string; error?: string }> => ipcRenderer.invoke('project:save', payload),
  onRequestSaveBeforeQuit: (handler: () => void): (() => void) => {
    const listener = () => handler()
    ipcRenderer.on('project:request-save-before-quit', listener)
    return () => ipcRenderer.removeListener('project:request-save-before-quit', listener)
  },
})
