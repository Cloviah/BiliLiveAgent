declare module 'sql.js' {
  interface SqlJsStatic {
    Database: new (data?: Uint8Array | Buffer | null) => SqlJsDatabase;
  }
  interface SqlJsDatabase {
    exec(sql: string): Array<{ columns: string[]; values: unknown[][] }>;
    close(): void;
  }
  interface InitSqlJsConfig {
    locateFile?: (file: string) => string;
    wasmBinary?: Uint8Array | ArrayBuffer;
  }
  export type { SqlJsStatic, SqlJsDatabase, InitSqlJsConfig };
  export default function initSqlJs(config?: InitSqlJsConfig): Promise<SqlJsStatic>;
}
