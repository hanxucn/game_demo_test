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
import { IMPLEMENTED_ACTIONS } from '../src/effects.ts';
import type { CardDef, CardEffect, EffectCondition, SkillDef, TargetSelector } from '../src/types.ts';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const DATA = join(ROOT, 'data');

/* ---------- 数值模型（docs/gdd/13-balance-data-model.md） ---------- */

/** 关键词成本（负值 = 占用预算） */
const KEYWORD_VALUE: Record<string, number> = {
  // ADR-054：关键词定义由设计者逐条给出。数值为"占用预算"（负值）。
  jia_dun: -1,     // 嘲讽
  xian_gong: -1,   // 入场当回合即可攻击（= 已合并的「疾行」）
  lian_ji: -1.5,   // 每回合攻击 2 次
  yi_ji: -2,       // 亡语
  yin_xue: -1,     // 饮血（待实现）
  sheng_dun: -1,   // 圣盾：免疫一次伤害
  shen_she: -1,    // 神射（待实现）
  qi_xi: -1,       // 奇袭（待实现）
  zhong_yi: -1,    // 忠义：免疫混乱/离间（待实现）
};


/**
 * 效果等效价值
 *
 * ADR-033：带 chance 的效果按概率线性打折（50% 的 4 点伤害 = 2 点价值）；
 *          带 condition 的效果按 CONDITION_RATE 打折（条件越苛刻价值越低）。
 */
const CONDITION_RATE = 0.7;

/**
 * 条件折扣（ADR-033 → ADR-074 细化）
 *
 * 原先无论条件多复杂，一律 `v *= 0.7` —— 于是「张氏三兄弟同时在场才多召 2 个」
 * 这种组合技被按"基本必中"计价（张宝算到 +4.4，直接超差）。
 * 现在按**子句连乘**：
 *   · 每个条件子句 ×0.7；
 *   · 子句指名了**具体某张卡**（`filter.card_id`）再 ×0.5 —— 那是组合技要求；
 *   · `all_of` 连乘（都要满足，更难）；`any_of` 取**最宽**的一支（满足其一即可）。
 */
const COMBO_RATE = 0.5;
function conditionRate(cond: EffectCondition): number {
  let rate = 1;
  const clause = (sel?: TargetSelector): void => {
    rate *= CONDITION_RATE;
    if (sel?.filter?.card_id) rate *= COMBO_RATE;   // 指名某张卡 = 组合技
  };
  if (cond.exists) clause(cond.exists);
  if (cond.count) clause(cond.count.selector);
  if (cond.count_vs) { clause(cond.count_vs.left); clause(cond.count_vs.right); }
  if (cond.event) rate *= CONDITION_RATE;
  if (cond.chosen_side) rate *= CONDITION_RATE;
  if (cond.turn_max !== undefined) rate *= CONDITION_RATE;
  if (cond.victim_type) rate *= CONDITION_RATE;
  if (cond.acted_this_turn !== undefined) rate *= CONDITION_RATE;
  if (cond.dealt_damage_this_turn !== undefined) rate *= CONDITION_RATE;
  for (const c of cond.all_of ?? []) rate *= conditionRate(c);
  if (cond.any_of?.length) rate *= Math.max(...cond.any_of.map((c) => conditionRate(c)));
  return rate;
}

/**
 * AOE（`target.count: 'all'`）的期望命中数。
 *
 * 不能一律按满场算：`adjacent_to` 最多左右两个，"全体西凉人物"这类带标签/费用限制的
 * 子集只会更少。按 filter 的**选择性**给名义值，比一个常数更接近真实（ADR-046）。
 */
function aoeTargets(sel?: TargetSelector): number {
  if (sel?.count !== 'all') return 1;
  const f = sel.filter ?? {};
  if (f.adjacent_to) return 2;                       // 相邻：最多左右各一
  const narrowing = (['tag', 'keyword', 'cost_max', 'cost_min',
    'has_status', 'health_max', 'troopKind', 'row', 'lane', 'faction'] as const)
    .filter((k) => f[k] !== undefined).length;
  return narrowing === 0 ? 3 : narrowing === 1 ? 1.5 : 1;
}

/** 无 filter 的全体（如「全体敌方人物」）的期望命中数，用于统计口径 */
const AOE_NOMINAL = 3;

/** 估值上下文：transform 需要卡表做「进化前后」对比 */
export interface ValueCtx {
  cards?: Map<string, CardDef>;
  /** 同一技能里的兄弟效果（用于推断 transform 的作用对象与数量） */
  siblings?: CardEffect[];
  /** 递归保护：transform 估值会回头调 cardValue */
  depth?: number;
}

/**
 * 推断 transform 的「进化前」卡与受影响数量。
 *
 * 典型写法是同一技能里先 summon 再 transform（公孙瓒/马腾/高顺），
 * 所以优先用兄弟 summon 的效果找来源卡与数量；找不到退回 filter.troopKind 反查。
 */
function inferTransformSource(
  eff: CardEffect, ctx: ValueCtx,
): { card: CardDef; count: number } | null {
  const cards = ctx.cards;
  if (!cards) return null;
  const kind = eff.target?.filter?.troopKind;

  for (const sib of ctx.siblings ?? []) {
    if (sib === eff || sib.action !== 'summon' || !sib.unit) continue;
    const c = cards.get(sib.unit);
    if (!c) continue;
    if (kind && c.troopKind !== kind) continue;
    return { card: c, count: sib.count ?? 1 };
  }
  if (kind) {
    for (const c of cards.values()) {
      if (c.troopKind === kind && c.type !== 'elite') return { card: c, count: 1 };
    }
  }
  return null;
}

function baseEffectValue(eff: CardEffect, ctx: ValueCtx = {}): number {
  // 两个独立的规模因子（ADR-046）：
  //   times = 「打 N 次」——同一目标反复结算（张角 value=1 count=5）
  //   aoe   = 「作用于全体」——target.count:'all'，实际张数取决于场面，取名义值（陆逊 AOE 毒）
  const times = Math.max(1, eff.count ?? 1);
  const aoe = aoeTargets(eff.target);
  const scale = times * aoe;
  switch (eff.action) {
    case 'damage': return (eff.value ?? 0) * 0.5 * scale;
    case 'heal': return (eff.value ?? 0) * 0.4 * scale;
    case 'draw': return (eff.value ?? 1) * 3;
    case 'summon': return (eff.count ?? 1) * 3;
    case 'gain_armor': return (eff.value ?? 1) * 1 * scale;
    case 'apply_status': {
      const per = eff.status === 'zhen_she' ? 5 : (eff.stacks ?? 1) * 2;
      // 标志型状态（numeric: false，如震慑/混乱/翻面）**不叠加**：
      // 同一张卡多次施加时，重复命中同一目标是浪费，不能按次数线性计价（ADR-056）。
      // 数值型状态（如中毒 stacks:2）可以叠，仍按次数计。
      const isFlag = STATUSES[eff.status ?? '']?.numeric === false;
      const effectiveCount = isFlag && times > 1 ? 1 + (times - 1) * 0.3 : times;
      return per * effectiveCount * aoe;
    }
    case 'destroy': return 8;
    case 'discard': {
      // 弃牌是**代价**还是**收益**取决于弃谁的牌（ADR-046）：
      // 弃自己的牌 = 净亏（"抽2弃2"净手牌为 0，不能两项都记正分）；弃对手的牌 = 干扰收益
      const sel = eff.target?.side ?? 'enemy';
      const self = sel === 'self' || sel === 'ally';
      return self ? 0 : scale * 1.0;
    }
    case 'return_to_hand': return 2;              // 让对手单位回手：拖节奏，非净赚
    case 'remove_status': {
      // 驱散（ADR-046：原先未计价）。ADR-071：按**类别**批量驱散（remove_kind）
      // 一次能清掉一堆 debuff，不能还按「1 层」计价。
      if (eff.remove_kind) return (eff.count ?? 1) * 3;
      return (eff.stacks ?? 1) * 2;
    }
    // ADR-033~042 新增动作的价值估算
    case 'clash': return 2;                                   // 拼点：中等收益
    case 'scry': return (eff.count ?? 1) * 2.5;               // 卡池操作 + 信息优势
    case 'flip': return 2.5;                                  // 翻面：既是保护也是封锁
    case 'ban_play': return (eff.count ?? 1) * 4.0;           // 禁止上场：与单体震慑(5)同级的硬控
    case 'steal_card': return (eff.count ?? 1) * 3.5;         // 夺取手牌
    case 'cost_modifier': return Math.abs(eff.value ?? 0) * 2 * (eff.count ?? 1);
    case 'survive': return 6;                                 // 免死
    case 'extra_attack': return 3.5;                          // 额外一次攻击
    case 'take_control': return 7;                            // 控制权转移
    case 'copy_skill': return 5;                              // 复制技能
    case 'force_attack': return (eff.count ?? 1) * 2;         // 强制攻击
    // ADR-050 新增动作的估值：塞牌进牌库 ≈ 半张抽牌（延迟且需再抽到）；送牌给对方 ≈ 负收益按 0 计
    case 'add_to_deck': return (eff.count ?? 1) * 1.5;
    case 'send_to_deck': return 0;
    case 'cycle_to_deck': return 1.0;                 // 弃 1 抽 1 的加强版（牌回牌库）
    // ADR-071 新增动作
    //   sacrifice：销毁自己的单位是**代价**，按 self-discard 的先例记 0 分；
    //              收益由后续 value_from_flag 的 heal/damage 记（见 effectValue）
    case 'sacrifice': return 0;
    //   attack_each：名义值 ≈ 一次额外普攻的伤害（打点 3）。张苞 4/3 打「攻 < 4」的敌人，
    //              通常吃 2 个目标但要承担反击、且自己阵亡就中断，故不给满值。
    case 'attack_each': return 3;
    //   draw_until：名义值 ≈ 比抽 1 张多拿到半张（策略密度决定）。
    case 'draw_until': return 3;
    //   mill：弃掉对手牌库一张 ≈ 半个干扰收益（对方本来也不一定抽到它）。
    case 'mill': return (eff.count ?? 1) * 1.5;
    case 'transform': {
      // 进化：价值 = (进化后总价值 − 进化前总价值) × 受影响单位数
      // 固定给 4 分会把「+1 攻」和「+1/2 攻且带每回合 2 伤技能」算成一样，方向都可能反（ADR-046）
      const to = ctx.cards?.get(String(eff.to ?? ''));
      if (!to || (ctx.depth ?? 0) > 2) return 4;             // 拿不到卡表 → 退回旧的名义值
      const src = inferTransformSource(eff, ctx);
      const cnt = eff.count
        ?? (eff.target?.count === 'all' ? (src?.count ?? AOE_NOMINAL) : 1);
      const after = cardValue(to).total;
      const before = src ? cardValue(src.card).total : 0;
      const delta = after - before;
      if (!src) return 4;                                    // 来源未知 → 名义值
      return Math.max(0, delta) * cnt;                       // 进化只会更强，负差值按 0 计
    }
    case 'modify': {
      const a = Math.abs(eff.attack ?? 0), h = Math.abs(eff.health ?? 0);
      const cnt = eff.count ?? 1;
      // 动态取值（*_from）按 2 点预估
      const dyn = (eff.attack_from || eff.health_from) ? 2 : 0;
      // 永久属性修正按**面值**计（+2 上限就是 2 分，与印刷属性同权）；
      // 只有带 duration 的临时修正才因「本回合有效」而打折（ADR-046）
      const rate = eff.duration === undefined ? 1.0 : 0.7;
      return ((a + h) * rate + dyn) * cnt * aoe;
    }
    default: return 0;
  }
}

/** `value_from_discarded` 的取值名义值：被弃牌多在 3 费/3 血附近 */
const DISCARDED_NOMINAL = 3;

/**
 * `value_from_flag` 的取值名义值（ADR-071）
 *
 * 程昱「审时度势」的数值来自被牺牲单位的血量；`sacrifice` 记 0 分（它是代价），
 * 若这里不记收益，整条链会算成白板。牺牲品的血量与「被弃牌的血量」同量级（≈3）。
 */
const FLAG_NOMINAL = 3;

function effectValue(eff: CardEffect, ctx: ValueCtx = {}): number {
  let v = baseEffectValue(eff, ctx);
  // 读数取自「最近被弃牌」的机制（ADR-040）原先记 0 分，等于整张卡的核心机制白送
  if (eff.value_from_discarded) {
    v = eff.action === 'damage' ? DISCARDED_NOMINAL * 0.5
      : eff.action === 'heal' ? DISCARDED_NOMINAL * 0.4
      : v;
  }
  // ADR-071：读数取自 flags（牺牲品的 maxHp / 当前 hp），同口径处理
  if (eff.value_from_flag) {
    v = eff.action === 'damage' ? FLAG_NOMINAL * 0.5
      : eff.action === 'heal' ? FLAG_NOMINAL * 0.4
      : v;
  }
  if (typeof eff.chance === 'number') v *= eff.chance;        // 概率打折
  if (eff.condition) v *= conditionRate(eff.condition);       // 条件打折（ADR-074：按子句连乘）
  return v;
}

/** 给一组效果补上兄弟上下文（transform 需要） */
const withSiblings = (effs: CardEffect[], ctx: ValueCtx): ValueCtx => ({ ...ctx, siblings: effs });

/** 触发概率折扣 */
const TRIGGER_RATE: Record<string, number> = {
  on_play: 1.0, on_death: 0.6, turn_start: 0.7, turn_end: 0.7, on_damaged: 0.6,
};

function skillValue(sk: SkillDef, ctx: ValueCtx = {}): number {
  // 抉择（ADR-071）：玩家会挑最有利的分支，所以按**各分支的最大值**计价 ——
  // 把两条分支相加等于把「二选一」当成「都拿到」，会把卡算爆。
  const modeVals = (sk.modes ?? []).map((m) =>
    (m.effects ?? []).reduce((s, e) => s + effectValue(e, withSiblings(m.effects, ctx)), 0));
  const effs = sk.effects ?? [];
  let raw = modeVals.length ? Math.max(...modeVals)
    : effs.reduce((s, e) => s + effectValue(e, withSiblings(effs, ctx)), 0);
  // 技能级概率（ADR-039：免死等）原先完全没参与折扣，导致 50% 的血战被按 100% 计价
  if (typeof sk.chance === 'number') raw *= sk.chance;
  if (sk.kind === 'active') return raw * 0.8;          // 主动技可被震慑打断
  const rate = TRIGGER_RATE[sk.trigger ?? 'on_play'] ?? 0.8;
  return raw * rate;
}

/** 卡牌总价值 */
export function cardValue(
  card: CardDef,
  ctx: ValueCtx = {},
): { stats: number; keywords: number; skills: number; total: number } {
  // 场上有攻血的单位类型都要计属性——elite/token 是进化与召唤的产物，
  // 在 transform/summon 的「前后对比」里必须算数，否则 delta 恒为负（ADR-046）
  const isUnit = ['troop', 'general', 'strategist', 'elite', 'token'].includes(card.type);
  const stats = isUnit ? (card.attack ?? 0) + (card.health ?? 0) : 0;
  const keywords = (card.keywords ?? []).reduce((s, k) => s + (KEYWORD_VALUE[k] ?? 0), 0);
  // ⚠️ 卡里的 DSL 存在 skills[].dsl（翻译结果），必须摊平后才能计入技能价值
  const flatSkills: SkillDef[] = (card.skills ?? []).flatMap((sk) => {
    const nested = (sk as SkillDef & { dsl?: SkillDef[] }).dsl;
    return nested?.length ? nested : [sk];
  });
  const next: ValueCtx = { ...ctx, depth: (ctx.depth ?? 0) + 1 };
  const skills = flatSkills.reduce((s, sk) => s + skillValue(sk, next), 0)
    + (card.effects ?? []).reduce((s, e) => s + effectValue(e, withSiblings(card.effects ?? [], next)), 0);
  return { stats, keywords, skills, total: stats + keywords + skills };
}

/** 白板基准：属性点 ≈ 2 × 统率 + 1 */
export const budgetOf = (cost: number): number => 2 * cost + 1;

/* ---------- 检查 ---------- */

export interface Issue { level: 'error' | 'warn'; cardId: string; message: string }

export function validateCards(cards: CardDef[]): Issue[] {
  const issues: Issue[] = [];
  const ids = new Set(cards.map((c) => c.id));
  const byId = new Map(cards.map((c) => [c.id, c]));
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
        if (e.remove_kind && !['buff', 'debuff'].includes(e.remove_kind)) {
          add('error', c.id, `${where} remove_kind 只能是 buff / debuff，当前「${e.remove_kind}」`);
        }
        if (e.target?.filter?.keyword && !KEYWORDS[e.target.filter.keyword]) {
          add('error', c.id, `${where} 选择器引用了未注册的关键词：${e.target.filter.keyword}`);
        }
        if (e.target?.filter?.tag && !TAGS[e.target.filter.tag]) {
          add('error', c.id, `${where} 选择器引用了未注册的归属标签：${e.target.filter.tag}`);
        }
        // 性别筛选（ADR-071）：只认这三个值，写错会静默选不中任何人
        const g = e.target?.filter?.gender;
        if (g && !['male', 'female', 'unknown'].includes(g)) {
          add('error', c.id, `${where} 选择器使用了非法性别：${g}`);
        }
        if (e.target?.pick && ![1, 2].includes(e.target.pick)) {
          add('error', c.id, `${where} pick 只能是 1 或 2，当前「${e.target.pick}」`);
        }
        if (e.unit && !ids.has(e.unit)) add('error', c.id, `${where} 召唤了不存在的卡：${e.unit}`);
        /**
         * 效果**不可能产生任何结果**（ADR-073）
         *
         * 这是「静默空转」家族里最隐蔽的一种：动作注册了、实现也有，但数值恒为 0，
         * 于是跑完什么都不发生。空城计就是 `damage value: 0` —— 文案写着"对方一回合
         * 无法攻击主帅"，实际是一张纯白卡，`verify:dsl` 也照样"通过"。
         *
         * 判定：`damage` / `heal` / `modify` 既没有动态取值（`*_from` / `value_from_flag`
         * / `value_from_discarded`），也没有非零 `value`（modify 另看 `attack`/`health`）。
         * 报 warn 而不是 error：占位可能是"机制还没设计"，不该阻断构建，但必须看得见。
         */
        const dynValue = (['value_from', 'value_from_flag', 'value_from_discarded'] as const)
          .some((k) => e[k] !== undefined && e[k] !== null);
        if ((e.action === 'damage' || e.action === 'heal') && !dynValue && !e.value) {
          add('warn', c.id, `${where} 的「${e.action}」没有任何数值来源（值 ${String(e.value)}）—— 实际不会发生任何事，是不是占位没翻译完？`);
        }
        if (e.action === 'modify' && !dynValue && !e.value
          && e.attack === undefined && e.health === undefined
          && e.attack_from === undefined && e.health_from === undefined) {
          add('warn', c.id, `${where} 的「modify」既没有 attack/health 也没有数值来源 —— 实际不会发生任何事`);
        }
      }
    };
    scanEffects(c.effects, 'effects');
    for (const sk of c.skills ?? []) {
      scanEffects(sk.effects, `技能「${sk.name}」`);
      // 抉择分支里的效果同样要逐条核对（ADR-071）
      (sk.modes ?? []).forEach((m, i) => scanEffects(m.effects, `技能「${sk.name}」分支「${m.name || i}」`));
      if (sk.modes?.length && sk.effects?.length) {
        add('warn', c.id, `技能「${sk.name}」同时写了 modes 与 effects —— 有 modes 时 effects 被忽略`);
      }
      if (sk.modes?.some((m) => !(m.effects ?? []).length)) {
        add('error', c.id, `技能「${sk.name}」有空的抉择分支（玩家选中后会什么都没发生）`);
      }
      if (sk.modes?.length && !sk.modes.some((m) => m.name)) {
        add('warn', c.id, `技能「${sk.name}」的抉择分支缺少 name（UI 无法展示选项）`);
      }
    }
    // 性别字段本身（ADR-071）
    if (c.gender && !['male', 'female', 'unknown'].includes(c.gender)) {
      add('error', c.id, `非法性别：${c.gender}`);
    }
    // 具体人物卡没有性别 = 貂蝉「祸国倾城」之类按性别筛目标的选择器会静默落空
    if (['general', 'strategist'].includes(c.type) && !c.gender) {
      add('warn', c.id, '人物卡缺少 gender（ADR-071：默认 male，女性需显式登记）');
    }

    // ⑤ 谋臣攻击力上限 1（原规则「必须为 0」已于 ADR-015/018 放宽）
    const STRATEGIST_ATTACK_MAX = 1;
    if (c.type === 'strategist' && (c.attack ?? 0) > STRATEGIST_ATTACK_MAX) {
      add('error', c.id, `谋臣攻击力上限 ${STRATEGIST_ATTACK_MAX}，当前 ${c.attack}`);
    }
    /**
     * ⑤bis 类型定型（ADR-018 / ADR-072）
     *
     * ADR-018 的自动判定（攻击 > 1 → 武将；否则默认谋臣）是在**照片稿的攻击力**上跑的，
     * 而攻击力后来会被 `card_stats` 改 —— 于是出现「数值改了、类型没跟着改」的静默错误
     * （向宠就是：按 2 攻判成武将，改成 1 攻后类型仍是武将）。
     *
     * 所以：**1 攻的武将必须由设计者显式标注**（`card_type` 段的 `explicit: true` →
     * 卡片字段 `type_explicit`）。没标注的，数据里就应该是谋臣 ——
     * 这是设计者 2026-09-23 给的口径。
     */
    if (c.type === 'general' && (c.attack ?? 0) <= 1) {
      const explicit = (c as CardDef & { type_explicit?: boolean }).type_explicit === true;
      if (!explicit) {
        add('error', c.id,
          `武将但攻击力 ${c.attack ?? 0} ≤ 1 且未显式标注 —— 按 ADR-018 默认应为谋臣；`
          + '确需保留武将在 card_type 段标 explicit: true（ADR-072）');
      }
    }
    // 类型合法
    if (!(CARD_TYPES as readonly string[]).includes(c.type)) add('error', c.id, `未知卡牌类型：${c.type}`);

    // ①② 数值预算（仅人物卡）
    if (['troop', 'general', 'strategist'].includes(c.type)) {
      const v = cardValue(c, { cards: byId });
      const budget = budgetOf(c.cost);
      const diff = v.total - budget;
      // 精英卡（橙卡）允许强于预算 —— 设计者明确"有些卡稍强是预期的"（ADR-068）。
      // 这类卡的技能往往远超估值模型的表达能力（如"技能禁用""拼点弃牌"），
      // 强行按模型改数值反而会做坏设计，所以只提示、不报错。
      const elite = c.rarity === 'elite';
      if (elite) {
        if (Math.abs(diff) > 1.5) {
          add('warn', c.id, `精英卡总价值 ${v.total.toFixed(1)} 偏离预算 ${budget} 达 ${diff.toFixed(1)}（允许，仅提示）`);
        }
      } else if (Math.abs(diff) > 3) {
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

  // ⑦ter 技能文案与效果一致性：写了文案却没有任何效果 = 静默白板（与 `skills[].dsl` 同源的坑）
  //
  // 判定要点：
  //   · 非人物卡的效果挂在**卡级** effects 上，卡级有效果就不算白板
  //   · 条件费用规则 cost_rule 也算一种已实现的效果载体（如丁奉「奋勇」）
  //   · 纯**限制型**文案（不能/只能/才可…）当前 schema 无处承载 → 报 warn 作为待补字段
  const RESTRICTION = /不能|只能|才可|无法|不可/;
  for (const c of cards) {
    if (c.effects?.length || c.cost_rule) continue;
    for (const sk of c.skills ?? []) {
      const text = (sk.text ?? '').trim();
      if (!text || sk.effects?.length || sk.modes?.length || sk.dsl?.length || (c.keywords ?? []).length) continue;
      const where = `技能「${sk.name || '(无名)'}」`;
      if (RESTRICTION.test(text)) {
        add('warn', c.id, `${where} 是限制型文案「${text.slice(0, 20)}…」，尚无 restrict 字段承载（见 ADR-045）`);
      } else {
        add('error', c.id, `${where} 有文案「${text.slice(0, 20)}…」但无任何效果`);
      }
    }
  }

  // ⑦quater 动作是否真的实现了
  //
  // `ACTIONS` 只是**注册表**（DSL 里允许出现的名字），不等于引擎实现了它。
  // 两者不一致时，用该动作的卡会**静默空转**：文案在、事件不发、什么都没发生。
  // 华佗「青囊」的 remove_status 就这样空转了整整一轮才被发现（ADR-066）。
  // 这里逐卡核对，并直接报 error —— 空转的卡等同于坏卡，不该混进测试局。
  const NOT_IMPLEMENTED = [...ACTIONS].filter((a) => !IMPLEMENTED_ACTIONS.has(a));
  const collectActions = (list: CardEffect[] | undefined, out: string[]): void => {
    for (const eff of list ?? []) {
      if (eff.action) out.push(eff.action);
      // 条件里也可能嵌效果（condition / value_from 等）
      for (const v of Object.values(eff as unknown as Record<string, unknown>)) {
        if (Array.isArray(v)) collectActions(v as CardEffect[], out);
        else if (v && typeof v === 'object' && 'action' in (v as object)) collectActions([v as CardEffect], out);
      }
    }
  };
  for (const c of cards) {
    const used: string[] = [];
    for (const sk of c.skills ?? []) {
      collectActions(sk.effects as CardEffect[], used);
      for (const m of sk.modes ?? []) collectActions(m.effects as CardEffect[], used);
    }
    collectActions(c.effects as CardEffect[], used);
    for (const a of new Set(used)) {
      if (!ACTIONS.includes(a as (typeof ACTIONS)[number])) {
        add('error', c.id, `使用了未注册的动作「${a}」`);
      } else if (!IMPLEMENTED_ACTIONS.has(a)) {
        add('error', c.id, `动作「${a}」已在 ACTIONS 注册但引擎未实现 —— 该卡会静默空转`);
      }
    }
  }
  if (NOT_IMPLEMENTED.length) {
    add('warn', '-', `引擎未实现的动作（无卡使用则可以接受，但不要在新卡里用）：${NOT_IMPLEMENTED.join('、')}`);
  }

  // ⑥bis value 块新鲜度：data/cards.yaml 的 value 是派生数据，必须与实时计算一致
  // （改了效果/数值/度量后若忘记重跑 tools/build-cards.sh，这里会拦住）
  let stale = 0;
  for (const c of cards) {
    const rec = c as CardDef & { value?: { total?: number; budget?: number; diff?: number } | null };
    // 没有 value 键 = 测试用合成卡（真实数据里 promote-cards.py 一定会写这个键，缺值写 null）
    if (!('value' in rec)) continue;
    if (!rec.value) { stale += 1; continue; }
    const v = cardValue(c, { cards: byId });
    const budget = budgetOf(c.cost);
    if (Math.abs((rec.value.total ?? NaN) - v.total) > 0.01
      || Math.abs((rec.value.budget ?? NaN) - budget) > 0.01) {
      stale += 1;
    }
  }
  if (stale) {
    add('error', '-', `${stale} 张卡的 value 核算块已过期或缺失——请重跑 bash tools/build-cards.sh`);
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
    const byId = new Map(cards.map((c) => [c.id, c]));
    for (const c of cards) {
      if (!['troop', 'general', 'strategist'].includes(c.type)) continue;
      const v = cardValue(c, { cards: byId });
      console.log(`  ${c.name.padEnd(6)} ${c.cost}费  属性${v.stats} 关键词${v.keywords.toFixed(1)} 技能${v.skills.toFixed(1)} = ${v.total.toFixed(1)} / 预算 ${budgetOf(c.cost)}`);
    }
    console.log('');
  }

  process.exit(errors.length ? 1 : 0);
}

if (process.argv[1] && process.argv[1].endsWith('validate.ts')) main();
