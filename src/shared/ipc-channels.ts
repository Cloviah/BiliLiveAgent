/** IPC 通道名与载荷类型，主进程与渲染进程共用 */

export const CH = {
  configGet: 'config:get',
  configSave: 'config:save',
  secretSet: 'secret:set',
  secretHas: 'secret:has',

  accountList: 'account:list',
  accountQrStart: 'account:qrcode:start',
  accountQrPoll: 'account:qrcode:poll',
  accountBrowserImport: 'account:browser:import',
  accountActivate: 'account:activate',
  accountRemove: 'account:remove',
  accountVerify: 'account:verify',

  roomInfo: 'room:info',

  runtimeStatus: 'runtime:status',
  runtimeStart: 'runtime:start',
  runtimeStop: 'runtime:stop',
  runtimePause: 'runtime:pause',
  runtimeResume: 'runtime:resume',
  runtimeSetRoom: 'runtime:setRoom',

  eventsRecent: 'events:recent',
  sendRecent: 'send:recent',
  sendTest: 'send:test',

  personaList: 'persona:list',
  personaSave: 'persona:save',
  personaDelete: 'persona:delete',
  personaActivate: 'persona:activate',
  personaImport: 'persona:import',
  personaExport: 'persona:export',

  memoryList: 'memory:list',
  memorySaveRoom: 'memory:room:save',
  memorySaveUser: 'memory:user:save',
  memoryDeleteUser: 'memory:user:delete',

  usageGet: 'usage:get',
  pluginSearchTest: 'plugin:search:test',
  pluginUsage: 'plugin:usage',
  logsGet: 'logs:get',
  logsExport: 'logs:export',
  dataExport: 'data:export',
  dataCleanup: 'data:cleanup',
  diagRun: 'diag:run',
  openDataDir: 'app:openDataDir',
} as const;

export const PUSH = {
  status: 'push:status',
  events: 'push:events',
  send: 'push:send',
  stats: 'push:stats',
  logs: 'push:logs',
  accounts: 'push:accounts',
  qrState: 'push:qrState',
} as const;
