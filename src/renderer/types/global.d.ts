// Electron adds a `path` property to File objects.
// This augmentation keeps code that references it compiling after stripping Electron.
interface File {
  readonly path?: string
}

interface Window {
  electronAPI?: unknown
}
