import { contextBridge, ipcRenderer } from 'electron';
import type { Api } from '../shared/ipc';

const api: Api = {
  invoke: (channel, arg) => ipcRenderer.invoke(channel, arg),
  on: (event, cb) => {
    const listener = (_e: unknown, payload: unknown) => cb(payload);
    ipcRenderer.on(event, listener);
    return () => ipcRenderer.removeListener(event, listener);
  },
  exportReady: (payload) => ipcRenderer.send('export:ready', payload),
};

contextBridge.exposeInMainWorld('api', api);
