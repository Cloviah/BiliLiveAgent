import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { Store } from '../src/main/store/db';
import { Logger } from '../src/main/utils/logger';
import { ConversationRepo } from '../src/main/store/conversation-repo';
import { Guards } from '../src/main/agent/guards';
import { MemoryManager } from '../src/main/agent/memory';
import { ConfigStore } from '../src/main/core/config';

function setup() {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'bili-mem-'));
  const logger = new Logger(tmp);
  const store = new Store(tmp);
  const config = new ConfigStore(tmp);
  const conversations = new ConversationRepo(store);
  const guards = new Guards(() => config.get(), logger);
  const memory = new MemoryManager(conversations, guards, logger);
  return { memory, conversations, config };
}

const ROOM = 12345;
const longSummary = Array.from({ length: 40 }, (_, i) => `- 第 ${i} 条历史要点：主播常聊游戏与日常`).join('\n');

describe('记忆自动整理', () => {
  it('摘要超过阈值才需要压缩', () => {
    const { memory } = setup();
    memory.saveRoomSummary(ROOM, '- 主播常聊游戏');
    expect(memory.needsCompress(ROOM, 900)).toBe(false);
    memory.saveRoomSummary(ROOM, longSummary);
    expect(memory.needsCompress(ROOM, 900)).toBe(true);
  });

  it('压缩成功时替换为更短的要点', async () => {
    const { memory } = setup();
    memory.saveRoomSummary(ROOM, longSummary);
    const before = memory.stats(ROOM).summaryChars;

    const ok = await memory.compressRoom(ROOM, 6, async () => '- 常聊游戏\n- 喜欢和老观众互动');
    expect(ok).toBe(true);
    expect(memory.stats(ROOM).summaryChars).toBeLessThan(before);
    expect(memory.room(ROOM)?.summary).toContain('常聊游戏');
  });

  it('压缩失败时保留原文，绝不丢记忆', async () => {
    const { memory } = setup();
    memory.saveRoomSummary(ROOM, longSummary);
    const before = memory.room(ROOM)?.summary;

    const ok = await memory.compressRoom(ROOM, 6, async () => {
      throw new Error('模型不可用');
    });
    expect(ok).toBe(false);
    expect(memory.room(ROOM)?.summary).toBe(before);
  });

  it('压缩结果没变短就不替换', async () => {
    const { memory } = setup();
    memory.saveRoomSummary(ROOM, '- 主播常聊游戏');
    const ok = await memory.compressRoom(ROOM, 6, async (summary) => summary);
    expect(ok).toBe(false);
    expect(memory.room(ROOM)?.summary).toBe('- 主播常聊游戏');
  });

  it('模型不可用时兜底裁剪到阈值内', () => {
    const { memory } = setup();
    memory.saveRoomSummary(ROOM, longSummary);
    expect(memory.trimRoomSummary(ROOM, 200)).toBe(true);
    const after = memory.room(ROOM)?.summary ?? '';
    expect(after.length).toBeLessThanOrEqual(200);
    expect(after.length).toBeGreaterThan(0);
    expect(after).toContain('历史要点');
  });

  it('归档长期没有互动的观众记忆', () => {
    const { memory, conversations } = setup();
    memory.upsertUser(1001, '老观众', '喜欢聊游戏');
    memory.upsertUser(1002, '新观众', '刚来');
    conversations.saveUser({
      uid: 1001,
      uname: '老观众',
      note: '喜欢聊游戏',
      lastSeen: Date.now() - 90 * 86_400_000,
      updatedAt: Date.now(),
    });

    expect(memory.archiveStaleUsers(30)).toBe(1);
    expect(memory.listUsers().map((u) => u.uid)).toEqual([1002]);
  });

  it('归档天数为 0 时不归档任何记忆', () => {
    const { memory } = setup();
    memory.upsertUser(1003, '观众', '聊游戏');
    expect(memory.archiveStaleUsers(0)).toBe(0);
    expect(memory.listUsers()).toHaveLength(1);
  });

  it('stats 反映摘要字数与观众记忆条数', () => {
    const { memory } = setup();
    memory.saveRoomSummary(ROOM, '- 主播常聊游戏');
    memory.upsertUser(1004, '观众甲', '喜欢点歌');
    memory.upsertUser(1005, '观众乙', '常问开播时间');
    const stats = memory.stats(ROOM);
    expect(stats.summaryChars).toBe('- 主播常聊游戏'.length);
    expect(stats.userCount).toBe(2);
  });
});
