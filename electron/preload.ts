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

contextBridge.exposeInMainWorld('renovacadApi', {
  isAvailable: (): boolean => true,
  proposeEdit: (payload: ProposePayload): Promise<ProposeResult> => ipcRenderer.invoke('ai:propose-edit', payload),
  getStatus: (): Promise<{ ready: boolean; address: string | null; error: string | null }> => ipcRenderer.invoke('ai:status'),
})
