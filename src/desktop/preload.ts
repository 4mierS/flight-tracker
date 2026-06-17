import { contextBridge, ipcRenderer } from "electron";
import {
  CHANNELS,
  type DesktopApi,
  type WorkerStatus,
  type WatchRunStatus,
} from "./shared";

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
    snapshots: (id, limit) => ipcRenderer.invoke(CHANNELS.watchesSnapshots, id, limit),
  },
  settings: {
    get: () => ipcRenderer.invoke(CHANNELS.settingsGet),
    update: (input) => ipcRenderer.invoke(CHANNELS.settingsUpdate, input),
  },
  worker: {
    runOnce: () => ipcRenderer.invoke(CHANNELS.workerRunOnce),
    start: () => ipcRenderer.invoke(CHANNELS.workerStart),
    stop: () => ipcRenderer.invoke(CHANNELS.workerStop),
    status: () => ipcRenderer.invoke(CHANNELS.workerStatus),
    onStatusChanged: (cb) => {
      const listener = (_event: unknown, status: WorkerStatus) => cb(status);
      ipcRenderer.on(CHANNELS.workerStatusChanged, listener);
      return () => ipcRenderer.removeListener(CHANNELS.workerStatusChanged, listener);
    },
    searchWatch: (id) => ipcRenderer.invoke(CHANNELS.watchSearch, id),
    stopWatchSearch: (id) => ipcRenderer.invoke(CHANNELS.watchSearchStop, id),
    watchStatuses: () => ipcRenderer.invoke(CHANNELS.watchRunStatuses),
    onWatchStatusChanged: (cb) => {
      const listener = (_event: unknown, status: WatchRunStatus) => cb(status);
      ipcRenderer.on(CHANNELS.watchRunStatusChanged, listener);
      return () => ipcRenderer.removeListener(CHANNELS.watchRunStatusChanged, listener);
    },
  },
};

contextBridge.exposeInMainWorld("api", api);
