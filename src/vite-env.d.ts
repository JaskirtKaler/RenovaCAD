/// <reference types="vite/client" />

declare global {
  interface Window {
    renovacadApi?: {
      isAvailable(): boolean
      proposeEdit: (payload: unknown) => Promise<{ kind: string; proposal?: unknown; message?: string; code?: string; httpStatus?: number }>
      getStatus: () => Promise<{ ready: boolean; address: string | null; error: string | null }>
    }
  }
}
export {}
