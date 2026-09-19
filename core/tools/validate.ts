/**
 * 卡牌数据校验器
 *
 * 把 docs/gdd/13-balance-data-model.md §5 的 10 条规则变成可执行检查。
 * 运行：npm run validate
 *
 * 退出码：0 = 通过（可能有警告）；1 = 有错误（CI 应阻断合并）
 */

import { readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

import { ACTIONS, CARD_TYPES, FORBIDDEN_KEYWORD_COMBOS, KEYWORDS, STATUSES, TAGS } from '../src/constants.ts';
import type { CardDef, CardEffect, SkillDef } from '../src/types.ts';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const DATA = join(ROOT, 'data');

/* ---------- 数值模型（docs/gdd/13-balance-data-model.md） ---------- */

/** 关键词成本（负值 = 占用预算） */
const KEYWORD_VALUE: Record<string, number> = {
  jie_zhen: -0.5, shen_she: -0.5, jia_dun: -1, wu_sheng: -1, xian_gong: -1,
  qi_xi: -1, yin_xue: -1, ji_xing: -1.5, lian_ji: -1.5, yi_ji: -2, wu_shuang: -2,
  zhong_yi: 0,   // 视具体亡语效果而定
};

/**
 * 效果等效价值
 *
 * ADR-033：带 chance 的效果按概率线性打折（50% 的 4 点伤害 = 2 点价值）；
 *          带 condition 的效果按 CONDITION_RATE 打折（条件越苛刻价值越低）。
 */
const CONDITION_RATE = 0.7;

function baseEffectValue(eff: CardEffect): number {
  switch (eff.action) {
    case 'damage': return (eff.value ?? 0) * 0.5;
    case 'heal': return (eff.value ?? 0) * 0.4;
    case 'draw': return (eff.value ?? 1) * 3;
    case 'summon': return (eff.count ?? 1) * 3;
    case 'gain_armor': return (eff.value ?? 1) * 1;
    case 'apply_status':
      return eff.status === 'zhen_she' ? 5 : (eff.stacks ?? 1) * 2;
    case 'destroy': return 8;
    case 'discard': return (eff.count ?? 1) * 1.5;
    case 'return_to_hand': return 3;
    // ADR-033~042 新增动作的价值估算
    case 'clash': return 2;                                   // 拼点：中等收益
    case 'scry': return (eff.count ?? 1) * 1.5;               // 卡池操作
    case 'flip': return 2.5;                                  // 翻面：既是保护也是封锁
    case 'ban_play': return (eff.count ?? 1) * 2.5;           // 禁止上场
    case 'steal_card': return (eff.count ?? 1) * 3.5;         // 夺取手牌
    case 'cost_modifier': return Math.abs(eff.value ?? 0) * 2 * (eff.count ?? 1);
    case 'survive': return 6;                                 // 免死
    case 'extra_attack': return 3.5;                          // 额外一次攻击
    case 'take_control': return 7;                            // 控制权转移
    case 'copy_skill': return 5;                              // 复制技能
    case 'force_attack': return (eff.count ?? 1) * 2;         // 强制攻击
    case 'transform': return 4;                               // 进化（按单次估算）
    case 'modify': {
      const a = Math.abs(eff.attack ?? 0), h = Math.abs(eff.health ?? 0);
      const cnt = eff.count ?? 1;
      // 动态取值（*_from）按 2 点预估
      const dyn = (eff.attack_from || eff.health_from) ? 2 : 0;
      return ((a + h) * 1.5 + dyn) * cnt;
    }
    default: return 0;
  }
}

function effectValue(eff: CardEffect): number {
  let v = baseEffectValue(eff);
  if (typeof eff.chance === 'number') v *= eff.chance;        // 概率打折
  if (eff.condition) v *= CONDITION_RATE;                     // 条件打折
  return v;
}

/** 触发概率折扣 */
const TRIGGER_RATE: Record<string, number> = {
  on_play: 1.0, on_death: 0.6, turn_start: 0.7, turn_end: 0.7, on_damaged: 0.6,
};

function skillValue(sk: SkillDef): number {
  const raw = (sk.effects ?? []).reduce((s, e) => s + effectValue(e), 0);
  if (sk.kind === 'active') return raw * 0.8;          // 主动技可被震慑打断
  const rate = TRIGGER_RATE[sk.trigger ?? 'on_play'] ?? 0.8;
  return raw * rate;
}

/** 卡牌总价值 */
export function cardValue(card: CardDef): { stats: number; keywords: number; skills: number; total: number } {
  const isChar = ['troop', 'general', 'strategist'].includes(card.type);
  const stats = isChar ? (card.attack ?? 0) + (card.health ?? 0) : 0;
  const keywords = (card.keywords ?? []).reduce((s, k) => s + (KEYWORD_VALUE[k] ?? 0), 0);
  // ⚠️ 卡里的 DSL 存在 skills[].dsl（翻译结果），必须摊平后才能计入技能价值
  const flatSkills: SkillDef[] = (card.skills ?? []).flatMap((sk) => {
    const nested = (sk as SkillDef & { dsl?: SkillDef[] }).dsl;
    return nested?.length ? nested : [sk];
  });
  const skills = flatSkills.reduce((s, sk) => s + skillValue(sk), 0)
    + (card.effects ?? []).reduce((s, e) => s + effectValue(e), 0);
  return { stats, keywords, skills, total: stats + keywords + skills };
}

/** 白板基准：属性点 ≈ 2 × 统率 + 1 */
export const budgetOf = (cost: number): number => 2 * cost + 1;

/* ---------- 检查 ---------- */

export interface Issue { level: 'error' | 'warn'; cardId: string; message: string }

export function validateCards(cards: CardDef[]): Issue[] {
  const issues: Issue[] = [];
  const ids = new Set(cards.map((c) => c.id));
  const add = (level: Issue['level'], cardId: string, message: string) =>
    issues.push({ level, cardId, message });

  for (const c of cards) {
    // ③ 卡名长度
    if (!c.name || [...c.name].length > 4) add('error', c.id, `卡名必须 1–4 字，当前「${c.name}」`);
    // ⑨ 缺 memo
    if (!c.memo) add('warn', c.id, '缺少 memo（一句话记忆点）');
    // ④ 非法关键词组合
    for (const combo of FORBIDDEN_KEYWORD_COMBOS) {
      if (combo.every((k) => (c.keywords ?? []).includes(k))) {
        add('error', c.id, `非法关键词组合：${combo.join(' + ')}`);
      }
    }
    // ⑧ 引用未注册的关键词 / 状态 / 动作
    for (const k of c.keywords ?? []) {
      if (!KEYWORDS[k]) add('error', c.id, `未注册的关键词：${k}`);
      else if (!KEYWORDS[k]!.implemented) add('warn', c.id, `关键词「${k}」引擎尚未实现`);
    }
    // ⑪ 未注册的归属标签（ADR-029）
    for (const t of c.tags ?? []) {
      if (!TAGS[t]) add('error', c.id, `未注册的归属标签：${t}`);
    }
    const scanEffects = (effs: CardEffect[] | undefined, where: string) => {
      for (const e of effs ?? []) {
        if (!(ACTIONS as readonly string[]).includes(e.action)) add('error', c.id, `${where} 未注册的动作：${e.action}`);
        if (e.status && !STATUSES[e.status]) add('error', c.id, `${where} 未注册的状态：${e.status}`);
        if (e.target?.filter?.keyword && !KEYWORDS[e.target.filter.keyword]) {
          add('error', c.id, `${where} 选择器引用了未注册的关键词：${e.target.filter.keyword}`);
        }
        if (e.target?.filter?.tag && !TAGS[e.target.filter.tag]) {
          add('error', c.id, `${where} 选择器引用了未注册的归属标签：${e.target.filter.tag}`);
        }
        if (e.unit && !ids.has(e.unit)) add('error', c.id, `${where} 召唤了不存在的卡：${e.unit}`);
      }
    };
    scanEffects(c.effects, 'effects');
    for (const sk of c.skills ?? []) scanEffects(sk.effects, `技能「${sk.name}」`);

    // ⑤ 谋臣攻击力上限 1（原规则「必须为 0」已于 ADR-015/018 放宽）
    const STRATEGIST_ATTACK_MAX = 1;
    if (c.type === 'strategist' && (c.attack ?? 0) > STRATEGIST_ATTACK_MAX) {
      add('error', c.id, `谋臣攻击力上限 ${STRATEGIST_ATTACK_MAX}，当前 ${c.attack}`);
    }
    // 类型合法
    if (!(CARD_TYPES as readonly string[]).includes(c.type)) add('error', c.id, `未知卡牌类型：${c.type}`);

    // ①② 数值预算（仅人物卡）
    if (['troop', 'general', 'strategist'].includes(c.type)) {
      const v = cardValue(c);
      const budget = budgetOf(c.cost);
      const diff = v.total - budget;
      if (Math.abs(diff) > 3) {
        add('error', c.id, `总价值 ${v.total.toFixed(1)} 超出同费预算 ${budget} 达 ${diff.toFixed(1)}（±3 以上）`);
      } else if (Math.abs(diff) > 1.5) {
        add('warn', c.id, `总价值 ${v.total.toFixed(1)} 偏离预算 ${budget} 达 ${diff.toFixed(1)}（建议复核）`);
      }
      // 谋臣无普攻的补偿
      if (c.type === 'strategist' && diff < -1.5) {
        add('warn', c.id, `谋臣无普攻，总价值 ${v.total.toFixed(1)} 低于预算 ${budget}，可考虑加强`);
      }
    }
  }

  // ⑦ 羁绊引用（若提供了 bonds 数据）
  const bondsPath = join(DATA, 'bonds.json');
  if (existsSync(bondsPath)) {
    const bonds = JSON.parse(readFileSync(bondsPath, 'utf8')) as Array<{ id: string; name: string; condition?: { require?: string[]; enemy_has?: string[] } }>;
    for (const b of bonds) {
      for (const id of [...(b.condition?.require ?? []), ...(b.condition?.enemy_has ?? [])]) {
        if (!ids.has(id)) add('error', b.id, `羁绊「${b.name}」引用了不存在的卡：${id}`);
      }
    }
  }

  // ⑩ 同类卡数量失衡
  const byType = new Map<string, number>();
  for (const c of cards) byType.set(c.type, (byType.get(c.type) ?? 0) + 1);
  const counts = [...byType.values()];
  if (counts.length > 1) {
    const avg = counts.reduce((a, b) => a + b, 0) / counts.length;
    for (const [t, n] of byType) {
      if (avg >= 3 && (n > avg * 1.5 || n < avg * 0.5)) {
        add('warn', '-', `卡牌类型「${t}」数量 ${n} 与均值 ${avg.toFixed(1)} 失衡`);
      }
    }
  }

  return issues;
}

/* ---------- CLI ---------- */

function loadCards(): CardDef[] {
  const cardsPath = join(DATA, 'cards.json');
  if (!existsSync(cardsPath)) {
    console.error(`找不到 ${cardsPath}\n请先运行：python3 tools/yaml2json.py`);
    process.exit(1);
  }
  const raw = JSON.parse(readFileSync(cardsPath, 'utf8'));
  return Array.isArray(raw) ? raw : (raw.cards ?? []);
}

function main(): void {
  const cards = loadCards();
  const issues = validateCards(cards);
  const errors = issues.filter((i) => i.level === 'error');
  const warns = issues.filter((i) => i.level === 'warn');

  console.log(`\n校验 ${cards.length} 张卡\n${'─'.repeat(52)}`);
  for (const i of issues) {
    const tag = i.level === 'error' ? '✗ 错误' : '⚠ 警告';
    console.log(`${tag}  ${i.cardId.padEnd(28)} ${i.message}`);
  }
  console.log('─'.repeat(52));
  console.log(`结果：${errors.length} 错误 / ${warns.length} 警告\n`);

  if (process.argv.includes('--verbose')) {
    for (const c of cards) {
      if (!['troop', 'general', 'strategist'].includes(c.type)) continue;
      const v = cardValue(c);
      console.log(`  ${c.name.padEnd(6)} ${c.cost}费  属性${v.stats} 关键词${v.keywords.toFixed(1)} 技能${v.skills.toFixed(1)} = ${v.total.toFixed(1)} / 预算 ${budgetOf(c.cost)}`);
    }
    console.log('');
  }

  process.exit(errors.length ? 1 : 0);
}

if (process.argv[1] && process.argv[1].endsWith('validate.ts')) main();
