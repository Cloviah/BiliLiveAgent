import { contextBridge, ipcRenderer } from 'electron';
import { CH, PUSH } from '../shared/ipc-channels';

type Unsubscribe = () => void;

function subscribe(channel: string, callback: (payload: any) => void): Unsubscribe {
  const listener = (_event: unknown, payload: unknown) => callback(payload);
  ipcRenderer.on(channel, listener);
  return () => ipcRenderer.removeListener(channel, listener);
}

const api = {
  config: {
    get: () => ipcRenderer.invoke(CH.configGet),
    save: (patch: unknown) => ipcRenderer.invoke(CH.configSave, patch),
  },
  secret: {
    set: (name: string, value: string) => ipcRenderer.invoke(CH.secretSet, name, value),
    has: (name: string) => ipcRenderer.invoke(CH.secretHas, name),
  },
  account: {
    list: () => ipcRenderer.invoke(CH.accountList),
    qrStart: () => ipcRenderer.invoke(CH.accountQrStart),
    qrPoll: (key: string) => ipcRenderer.invoke(CH.accountQrPoll, key),
    browserImport: () => ipcRenderer.invoke(CH.accountBrowserImport),
    activate: (uid: number) => ipcRenderer.invoke(CH.accountActivate, uid),
    remove: (uid: number) => ipcRenderer.invoke(CH.accountRemove, uid),
    verify: (uid?: number) => ipcRenderer.invoke(CH.accountVerify, uid),
  },
  room: {
    info: (roomId: number) => ipcRenderer.invoke(CH.roomInfo, roomId),
  },
  runtime: {
    status: () => ipcRenderer.invoke(CH.runtimeStatus),
    start: (roomId?: number) => ipcRenderer.invoke(CH.runtimeStart, roomId),
    stop: () => ipcRenderer.invoke(CH.runtimeStop),
    pause: () => ipcRenderer.invoke(CH.runtimePause),
    resume: () => ipcRenderer.invoke(CH.runtimeResume),
    setRoom: (roomId: number) => ipcRenderer.invoke(CH.runtimeSetRoom, roomId),
  },
  events: {
    recent: (roomId: number, limit?: number) => ipcRenderer.invoke(CH.eventsRecent, roomId, limit),
  },
  send: {
    recent: (limit?: number) => ipcRenderer.invoke(CH.sendRecent, limit),
    test: (text: string) => ipcRenderer.invoke(CH.sendTest, text),
  },
  persona: {
    list: () => ipcRenderer.invoke(CH.personaList),
    save: (card: unknown) => ipcRenderer.invoke(CH.personaSave, card),
    remove: (id: string) => ipcRenderer.invoke(CH.personaDelete, id),
    activate: (id: string) => ipcRenderer.invoke(CH.personaActivate, id),
    importMd: (markdown: string) => ipcRenderer.invoke(CH.personaImport, markdown),
    exportMd: (id: string) => ipcRenderer.invoke(CH.personaExport, id),
  },
  memory: {
    list: (keyword?: string) => ipcRenderer.invoke(CH.memoryList, keyword),
    saveRoom: (summary: string) => ipcRenderer.invoke(CH.memorySaveRoom, summary),
    saveUser: (payload: unknown) => ipcRenderer.invoke(CH.memorySaveUser, payload),
    deleteUser: (uid: number) => ipcRenderer.invoke(CH.memoryDeleteUser, uid),
  },
  usage: {
    get: () => ipcRenderer.invoke(CH.usageGet),
  },
  logs: {
    get: (limit?: number) => ipcRenderer.invoke(CH.logsGet, limit),
    export: () => ipcRenderer.invoke(CH.logsExport),
  },
  data: {
    export: () => ipcRenderer.invoke(CH.dataExport),
    cleanup: () => ipcRenderer.invoke(CH.dataCleanup),
    openDir: () => ipcRenderer.invoke(CH.openDataDir),
  },
  diag: {
    run: (scope: string) => ipcRenderer.invoke(CH.diagRun, scope),
  },
  plugin: {
    searchTest: (query: string) => ipcRenderer.invoke(CH.pluginSearchTest, query),
    usage: () => ipcRenderer.invoke(CH.pluginUsage),
  },
  on: {
    status: (cb: (payload: any) => void) => subscribe(PUSH.status, cb),
    events: (cb: (payload: any) => void) => subscribe(PUSH.events, cb),
    send: (cb: (payload: any) => void) => subscribe(PUSH.send, cb),
    stats: (cb: (payload: any) => void) => subscribe(PUSH.stats, cb),
    logs: (cb: (payload: any) => void) => subscribe(PUSH.logs, cb),
    accounts: (cb: (payload: any) => void) => subscribe(PUSH.accounts, cb),
  },
};

contextBridge.exposeInMainWorld('bili', api);

export type BiliApi = typeof api;
