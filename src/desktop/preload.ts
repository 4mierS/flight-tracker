import { contextBridge, ipcRenderer } from "electron";
import { CHANNELS, type DesktopApi } from "./shared";

/**
 * The renderer's ONLY path to the database. Each method is a thin wrapper over
 * ipcRenderer.invoke; the real work (Prisma, validation) happens in the main
 * process. Exposed as `window.api`.
 */
const api: DesktopApi = {
  watches: {
    list: () => ipcRenderer.invoke(CHANNELS.watchesList),
    get: (id) => ipcRenderer.invoke(CHANNELS.watchesGet, id),
    create: (input) => ipcRenderer.invoke(CHANNELS.watchesCreate, input),
    update: (id, input) => ipcRenderer.invoke(CHANNELS.watchesUpdate, id, input),
    remove: (id) => ipcRenderer.invoke(CHANNELS.watchesRemove, id),
    setActive: (id, active) => ipcRenderer.invoke(CHANNELS.watchesSetActive, id, active),
    snooze: (id, untilIso) => ipcRenderer.invoke(CHANNELS.watchesSnooze, id, untilIso),
  },
  settings: {
    get: () => ipcRenderer.invoke(CHANNELS.settingsGet),
    update: (input) => ipcRenderer.invoke(CHANNELS.settingsUpdate, input),
  },
};

contextBridge.exposeInMainWorld("api", api);
