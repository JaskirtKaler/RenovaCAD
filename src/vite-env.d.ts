/// <reference types="vite/client" />

declare global {
  interface Window {
    renovacadApi?: {
      isAvailable(): boolean
      proposeEdit: (payload: unknown) => Promise<{ kind: string; proposal?: unknown; message?: string; code?: string; httpStatus?: number }>
      analyzePhoto: (payload: unknown) => Promise<{ kind: string; description?: string; followUpQuestions?: string[]; code?: string; message?: string; httpStatus?: number }>
      getStatus: () => Promise<{ ready: boolean; address: string | null; error: string | null }>
    }
    renovacadProject?: {
      isAvailable(): boolean
      setDirty: (dirty: boolean) => Promise<{ ok: boolean }>
      confirmUnsaved: (message?: string) => Promise<{ choice: 'save' | 'discard' | 'cancel' }>
      confirmClose: () => Promise<{ ok: boolean }>
      openProject: () => Promise<{ canceled: boolean; filePath?: string; content?: string; error?: string }>
      saveProject: (payload: { filePath?: string | null; content: string; defaultName?: string }) => Promise<{ canceled: boolean; filePath?: string; error?: string }>
      onRequestSaveBeforeQuit: (handler: () => void) => () => void
    }
  }
}
export {}
