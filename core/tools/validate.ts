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

/**
 * `data/cards.yaml` 允许出现的字段（ADR-091）。
 *
 * 与退役的 `promote-cards.py` 的 `KEEP` 名单一一对应 —— 那时它决定"哪些字段能进正式数据"，
 * 现在是**校验**：写了名单外的字段直接报 error，而不是被静默丢弃
 * （`rarity`/`gender` 历史上都这样丢过）。
 * ⚠️ ADR-092：`value`（预算核算块）已整个删除，**不再是合法字段** —— 再写它会被这里拦下。
 */
const CARD_FIELDS = new Set([
  'id', 'name', 'faction', 'type', 'cost', 'attack', 'health', 'troopKind',
  'keywords', 'tags', 'memo', 'flavor', 'cost_rule', 'rarity', 'gender',
  'type_explicit', 'note', 'skills', 'effects',
]);

/* ---------- 数值模型（docs/gdd/13-balance-data-model.md） ---------- */

/** 校验结论：error 会让 `npm run validate` 退出码非 0；warn 只提示 */
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

    // ⑤-0 字段白名单（ADR-091）：cards.yaml 现在是手写真源，字段名写错没人替你发现
    for (const k of Object.keys(c)) {
      if (!CARD_FIELDS.has(k)) {
        add('error', c.id,
          `未知字段 \`${k}\` —— 写错的字段不会生效，允许的字段见 data/cards.yaml 文件头`);
      }
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

  process.exit(errors.length ? 1 : 0);
}

if (process.argv[1] && process.argv[1].endsWith('validate.ts')) main();
