import type {
  AppConfig,
  BiliAccount,
  LiveEvent,
  LogEntry,
  PersonaCard,
  RoomMemory,
  RoomMeta,
  RuntimeStatus,
  SendRecord,
  UsageStats,
  UserMemory,
} from '../../shared/types';

interface Bridge {
  config: { get: () => Promise<AppConfig>; save: (patch: Partial<AppConfig>) => Promise<AppConfig> };
  secret: { set: (name: string, value: string) => Promise<boolean>; has: (name: string) => Promise<boolean> };
  account: {
    list: () => Promise<BiliAccount[]>;
    qrStart: () => Promise<{ key: string; url: string; image: string; expiresAt: number }>;
    qrPoll: (key: string) => Promise<{ state: string; message: string; uid?: number; uname?: string }>;
    browserImport: () => Promise<BiliAccount[]>;
    activate: (uid: number) => Promise<boolean>;
    remove: (uid: number) => Promise<boolean>;
    verify: (uid?: number) => Promise<{ ok: boolean; message: string }>;
  };
  room: { info: (roomId: number) => Promise<RoomMeta> };
  runtime: {
    status: () => Promise<RuntimeStatus>;
    start: (roomId?: number) => Promise<{ ok: boolean; message: string }>;
    stop: () => Promise<boolean>;
    pause: () => Promise<boolean>;
    resume: () => Promise<boolean>;
    setRoom: (roomId: number) => Promise<boolean>;
  };
  events: { recent: (roomId: number, limit?: number) => Promise<LiveEvent[]> };
  send: { recent: (limit?: number) => Promise<SendRecord[]>; test: (text: string) => Promise<boolean> };
  persona: {
    list: () => Promise<PersonaCard[]>;
    save: (card: PersonaCard) => Promise<PersonaCard>;
    remove: (id: string) => Promise<PersonaCard[]>;
    activate: (id: string) => Promise<boolean>;
    importMd: (markdown: string) => Promise<PersonaCard>;
    exportMd: (id: string) => Promise<string>;
  };
  memory: {
    list: (keyword?: string) => Promise<{ room?: RoomMemory; users: UserMemory[] }>;
    saveRoom: (summary: string) => Promise<boolean>;
    saveUser: (payload: { uid: number; uname: string; note: string }) => Promise<boolean>;
    deleteUser: (uid: number) => Promise<boolean>;
  };
  usage: { get: () => Promise<UsageStats> };
  logs: { get: (limit?: number) => Promise<LogEntry[]>; export: () => Promise<string> };
  data: {
    export: () => Promise<string>;
    cleanup: () => Promise<boolean>;
    openDir: () => Promise<string>;
  };
  diag: { run: (scope: string) => Promise<{ ok: boolean; scope: string; message: string }> };
  plugin: {
    searchTest: (query: string) => Promise<{ ok: boolean; message: string }>;
    usage: () => Promise<{ usedToday: number; limit: number }>;
  };
  on: {
    status: (cb: (payload: RuntimeStatus) => void) => () => void;
    events: (cb: (payload: LiveEvent[]) => void) => () => void;
    send: (cb: (payload: SendRecord) => void) => () => void;
    stats: (cb: (payload: number) => void) => () => void;
    logs: (cb: (payload: LogEntry) => void) => () => void;
    accounts: (cb: (payload: BiliAccount[]) => void) => () => void;
  };
}

export const api = ((window as unknown as { bili: Bridge }).bili) as Bridge;
