/// <reference types="vite/client" />

interface ElectronAPI {
  platform: string
  minimizeWindow?: () => void
  maximizeWindow?: () => void
  closeWindow?: () => void
}

interface Window {
  electronAPI?: ElectronAPI
}
