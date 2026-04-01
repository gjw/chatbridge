// Electron adds a `path` property to File objects.
// This augmentation keeps code that references it compiling after stripping Electron.
interface File {
  readonly path?: string
}

interface Window {
  electronAPI?: unknown
}

declare module 'core-js/actual'
declare module '@/platform/desktop_platform' {
  const DesktopPlatform: { new (electronAPI: unknown): unknown }
  export default DesktopPlatform
}
declare module '@/platform/mobile_platform' {
  const MobilePlatform: { new (): unknown }
  export default MobilePlatform
}
declare module '@mastra/core/vector' {
  export interface QueryResult {
    id: string
    score: number
    metadata?: Record<string, unknown>
    document?: string
  }
}
declare module '@mastra/rag/dist/rerank' {
  export interface RerankerFunctionOptions {
    topK?: number
    weights?: { semantic?: number; vector?: number; position?: number }
  }
  export interface RerankResult {
    result: import('@mastra/core/vector').QueryResult
    score: number
    details: Record<string, unknown>
  }
}
