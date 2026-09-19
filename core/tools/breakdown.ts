import { readFileSync } from 'node:fs';
import { cardValue, budgetOf } from '../tools/validate.ts';
import type { CardDef } from '../src/types.ts';

const cards: CardDef[] = JSON.parse(readFileSync('data/cards.json', 'utf8'));
const byId = new Map(cards.map((c) => [c.id, c]));
const ids = process.argv.slice(2);
for (const id of ids) {
  const c = byId.get(id)!;
  const v = cardValue(c, { cards: byId });
  const flat = (c.skills ?? []).flatMap((sk) => (sk as any).dsl?.length ? (sk as any).dsl : [sk]);
  console.log(`\n${c.name} ${c.id} ${c.cost}费 ${c.attack ?? 0}/${c.health ?? 0}  属性${v.stats} 技能${v.skills.toFixed(2)} 总${v.total.toFixed(2)} 预算${budgetOf(c.cost)} 偏差${(v.total - budgetOf(c.cost)).toFixed(2)}`);
  for (const sk of flat) {
    const effs = sk.effects ?? [];
    const rate = sk.kind === 'active' ? 0.8 : ({ on_play: 1.0, on_death: 0.6, turn_start: 0.7, turn_end: 0.7, on_damaged: 0.6 } as Record<string, number>)[sk.trigger ?? 'on_play'] ?? 0.8;
    let sum = 0;
    const parts: string[] = [];
    for (const e of effs) {
      const one = cardValue({ ...c, skills: undefined, effects: undefined, keywords: [] } as CardDef).stats;
      void one;
      parts.push(`${e.action}(${e.target?.count === 'all' ? 'AOE' : e.count ?? 1})`);
    }
    // 逐效果单独估值
    for (const e of effs) {
      const solo = cardValue({ id: 'x', name: 'x', faction: 'shu', type: 'general', cost: 0, skills: [{ id: '', name: '', kind: sk.kind, trigger: sk.trigger, effects: [e] }] } as CardDef, { cards: byId });
      sum += solo.skills;
      console.log(`   ${sk.name || '(无名)'} [${sk.kind}/${sk.trigger ?? '-'} rate${rate}] ${e.action} ×${e.count ?? 1}${e.target?.count === 'all' ? ' AOE' : ''}${e.chance ? ` chance${e.chance}` : ''} → 折后 ${solo.skills.toFixed(2)}`);
    }
    console.log(`   小计(折后) ${sum.toFixed(2)}`);
  }
  for (const e of c.effects ?? []) {
    const solo = cardValue({ id: 'x', name: 'x', faction: 'shu', type: 'general', cost: 0, effects: [e] } as CardDef, { cards: byId });
    console.log(`   卡级 ${e.action} ×${e.count ?? 1} → ${solo.skills.toFixed(2)}`);
  }
}
