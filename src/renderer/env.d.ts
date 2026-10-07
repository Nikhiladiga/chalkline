/// <reference types="vite/client" />
declare module '*.woff2?inline' {
  const src: string;
  export default src;
}

interface Window {
  api: import('../shared/ipc').Api;
}
