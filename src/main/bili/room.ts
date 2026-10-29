import type { RoomMeta } from '../../shared/types';
import type { Logger } from '../utils/logger';
import type { BiliHttpClient, BiliResponse } from './http-client';

interface RoomInfoData {
  uid: number;
  room_id: number;
  short_id: number;
  title: string;
  description: string;
  area_name: string;
  parent_area_name: string;
  live_status: number;
  online: number;
  attention: number;
}

interface DanmakuServerData {
  token: string;
  host_list: Array<{ host: string; port: number; wss_port: number; ws_port: number }>;
}

export interface DanmakuEndpoint {
  url: string;
  token: string;
}

export class RoomService {
  constructor(
    private readonly http: BiliHttpClient,
    private readonly logger: Logger,
  ) {}

  /** 读取直播间公开元数据（不拉取音视频） */
  async fetchMeta(roomId: number): Promise<RoomMeta> {
    const res = await this.http.getJson<RoomInfoData>(
      `https://api.live.bilibili.com/room/v1/Room/get_info?room_id=${roomId}`,
    );
    if (res.code !== 0) throw new Error(`房间信息获取失败：${res.message}`);
    const d = res.data;
    return {
      roomId: d.room_id || roomId,
      title: d.title ?? '',
      anchorUid: d.uid ?? 0,
      anchorName: '',
      areaName: d.area_name ?? '',
      parentAreaName: d.parent_area_name ?? '',
      description: d.description ?? '',
      liveStatus: d.live_status === 1 ? 1 : 0,
      popularity: d.online ?? 0,
    };
  }

  async fetchAnchorName(anchorUid: number): Promise<string> {
    if (!anchorUid) return '';
    try {
      const res = await this.http.getJson<{ info?: { uname?: string } }>(
        `https://api.bilibili.com/x/space/wbi/acc/info?mid=${anchorUid}`,
        { wbi: true },
      );
      return res.data?.info?.uname ?? '';
    } catch {
      return '';
    }
  }

  /** 获取弹幕服务器地址与鉴权 token */
  async fetchDanmakuEndpoint(roomId: number): Promise<DanmakuEndpoint> {
    await this.ensureDeviceCookie();
    const realRoomId = await this.resolveRealRoomId(roomId);
    // 现网接口为 getDanmuInfo（getDanmakuServer 已下线返回 404），且必须带 WBI 签名，否则返回 -352 风控
    const url = `https://api.live.bilibili.com/xlive/web-room/v1/index/getDanmuInfo?type=0&id=${realRoomId}`;
    let res = await this.http.getJson<DanmakuServerData>(url, { wbi: true });
    if (res.code !== 0) {
      // 风控时刷新一次 buvid3 再试
      await this.ensureDeviceCookie(true);
      res = await this.http.getJson<DanmakuServerData>(url, { wbi: true });
    }
    if (res.code !== 0) throw new Error(`弹幕服务器获取失败：${res.message || res.code}`);
    const host = res.data.host_list?.[0];
    if (!host) throw new Error('没有可用的弹幕服务器');
    const port = host.wss_port || host.ws_port || 443;
    return { url: `wss://${host.host}:${port}/sub`, token: res.data.token ?? '' };
  }

  /** 短号转真实房间号（弹幕接口只认真实房间号） */
  private async resolveRealRoomId(roomId: number): Promise<number> {
    try {
      const res = await this.http.getJson<{ room_id?: number }>(
        `https://api.live.bilibili.com/room/v1/Room/room_init?id=${roomId}`,
      );
      return res.data?.room_id || roomId;
    } catch {
      return roomId;
    }
  }

  /** 补齐 buvid3/buvid4：风控接口缺少该 Cookie 时会被拦截 */
  private async ensureDeviceCookie(force = false): Promise<void> {
    const current = this.http.getCookie();
    if (!force && /buvid3=/i.test(current)) return;
    try {
      const res = await this.http.getJson<{ b_3?: string; b_4?: string }>(
        'https://api.bilibili.com/x/frontend/finger/spi',
      );
      const buvid3 = res.data?.b_3 ?? '';
      const buvid4 = res.data?.b_4 ?? '';
      if (!buvid3) return;
      const parts = [`buvid3=${buvid3}`, `buvid4=${buvid4}`, `b_nut=${Date.now()}`];
      const kept = current
        .split(';')
        .map((c) => c.trim())
        .filter((c) => c && !/^buvid3=|^buvid4=|^b_nut=/i.test(c));
      this.http.setCookie([...kept, ...parts].join('; '));
      this.logger.info('room', '已获取 buvid3，用于通过风控校验');
    } catch (error) {
      this.logger.warn('room', `获取 buvid3 失败：${String(error)}`);
    }
  }
}
