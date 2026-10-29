import type { AppConfig, LiveEvent } from '../../shared/types';
import type { Logger } from '../utils/logger';
import { DANMAKU_MAX_LENGTH } from '../../shared/limits';
import { charLength, matchesAny, sanitizeDanmaku, similarity, truncate } from '../utils/text';

export interface GuardVerdict {
  allowed: boolean;
  reason?: string;
  text: string;
}

/** 不可关闭的硬性拦截规则 */
const HARD_RULES: Array<{ name: string; pattern: RegExp }> = [
  { name: '违禁品与黑产', pattern: /冰毒|大麻|海洛因|赌博|博彩|菠菜|刷单|刷量|代刷|枪支|弹药|走私|洗钱|套现|黑产/ },
  { name: '色情低俗', pattern: /色情|裸聊|约炮|一夜情|成人影片|黄片|涩涩/ },
  { name: '暴力与自伤', pattern: /自杀|自残|轻生|砍人|炸弹|投毒/ },
  { name: '隐私与凭据', pattern: /身份证号|银行卡号|家庭住址|家庭地址|验证码是|密码是|api[_ -]?key|secret[_ -]?key|sk-[A-Za-z0-9]{6,}/i },
  { name: '冒充身份', pattern: /我是官方|官方客服|平台客服|我是主播本人|真人认证|不是(ai|机器人)/i },
  { name: '引流与诈骗', pattern: /加微信|加qq|私聊赚钱|兼职日结|转账到|扫码领奖/ },
];

/** 提示词注入检测：外部文本一律视为不可信数据 */
const INJECTION_RULES: Array<{ name: string; pattern: RegExp }> = [
  { name: '覆盖指令', pattern: /忽略(以上|之前|前面|上面)(的)?(所有|全部)?(指令|规则|提示|设定)/ },
  { name: '覆盖指令(EN)', pattern: /ignore (all )?(previous|prior|above) (instructions|prompts|rules)/i },
  { name: '索取系统提示', pattern: /(输出|打印|重复|显示)(你的)?(系统)?(提示词|提示|指令|规则|system\s*prompt)/i },
  { name: '索取密钥', pattern: /(api[_ -]?key|密钥|token|cookie|密码)(是|给我|发出来|告诉我)/i },
  { name: '改写人格', pattern: /(你现在|从现在起|接下来)(就是|变成|扮演)(一个)?(没有限制的)?/ },
  { name: '执行系统命令', pattern: /(运行|执行)(cmd|powershell|bash|shell|命令)/i },
  { name: '读取本地资源', pattern: /(读取|打开|删除)(本地)?(文件|目录|数据库|注册表)/ },
];

export class Guards {
  constructor(
    private readonly getConfig: () => AppConfig,
    private readonly logger: Logger,
  ) {}

  /** 检查外部输入是否企图改写人格、索取密钥或控制应用 */
  inspectIncoming(event: LiveEvent): { injection: boolean; reasons: string[] } {
    const text = event.text ?? '';
    const reasons = INJECTION_RULES.filter((r) => r.pattern.test(text)).map((r) => r.name);
    if (reasons.length) {
      this.logger.warn('guard', `检测到可疑输入（${reasons.join('、')}），来源 ${event.uname}`);
    }
    return { injection: reasons.length > 0, reasons };
  }

  private hardCheck(text: string): string | undefined {
    for (const rule of HARD_RULES) {
      if (rule.pattern.test(text)) return `命中硬性拦截：${rule.name}`;
    }
    return undefined;
  }

  /** 输出过滤：硬性规则 + 用户屏蔽词/话题 + 长度 + 重复度 */
  filterOutgoing(text: string, recentTexts: string[] = []): GuardVerdict {
    const config = this.getConfig();
    const clean = sanitizeDanmaku(text);
    if (!clean) return { allowed: false, reason: '内容为空', text: '' };
    if (charLength(clean) > DANMAKU_MAX_LENGTH * config.interaction.maxSegments) {
      return { allowed: false, reason: '内容过长，超出可分段上限', text: '' };
    }
    const hard = this.hardCheck(clean);
    if (hard) return { allowed: false, reason: hard, text: '' };
    if (matchesAny(clean, config.safety.blockedWords)) {
      return { allowed: false, reason: '命中自定义禁止词', text: '' };
    }
    if (matchesAny(clean, config.safety.blockedTopics)) {
      return { allowed: false, reason: '命中不回应话题', text: '' };
    }
    if (recentTexts.some((prev) => similarity(prev, clean) > 0.88)) {
      return { allowed: false, reason: '与最近发言高度重复', text: '' };
    }
    return { allowed: true, text: clean };
  }

  /** 摘要类文本：允许更长，但仍做硬性检查与截断 */
  filterSummary(text: string, maxLen = 400): string {
    const safe = HARD_RULES.some((r) => r.pattern.test(text)) ? '' : text.replace(/[\r\n]+/g, ' ').trim();
    return truncate(safe, maxLen);
  }
}
