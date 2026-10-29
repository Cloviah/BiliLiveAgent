import { Database, Download, FolderOpen, Trash2 } from 'lucide-react';
import type { AppCtx } from '../../App';
import { api } from '../../api/ipc-client';
import { Card } from '../ui';

export default function DataPanel({ ctx }: { ctx: AppCtx }) {
  return (
    <Card title="数据与日志">
      <div className="flex flex-wrap gap-2">
        <button
          type="button"
          className="btn-ghost"
          onClick={() => api.data.export().then((file) => ctx.toast(`已导出：${file}`)).catch(console.error)}
        >
          <Download size={14} /> 导出配置与记忆
        </button>
        <button
          type="button"
          className="btn-ghost"
          onClick={() => api.logs.export().then(() => ctx.toast('日志已导出到数据目录')).catch(console.error)}
        >
          <Database size={14} /> 导出运行日志
        </button>
        <button
          type="button"
          className="btn-ghost"
          onClick={() => api.data.openDir().catch(console.error)}
        >
          <FolderOpen size={14} /> 打开数据目录
        </button>
        <button
          type="button"
          className="btn-danger"
          onClick={() =>
            api.data.cleanup().then(() => {
              ctx.toast('已按保留天数清理过期数据');
              ctx.refreshSends();
            }).catch(console.error)
          }
        >
          <Trash2 size={14} /> 立即清理过期数据
        </button>
      </div>
      <p className="mt-2 text-[11px] leading-relaxed text-soft-sub/70">
        导出内容包含配置、人格、房间摘要与观众记忆，不包含 API Key 与 B 站登录凭据。
      </p>
    </Card>
  );
}
