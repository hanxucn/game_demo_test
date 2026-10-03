import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';

test('手牌卡面保留完整名称，并正确转义 HTML', () => {
  const window = { Core: { KEYWORDS: {} }, CardRender: undefined as unknown };
  const document = {
    createElement: () => ({ className: '', dataset: {} as Record<string, string>, innerHTML: '' }),
  };
  const source = readFileSync(new URL('../../prototype/card-render.js', import.meta.url), 'utf8');
  runInNewContext(source, { window, document });

  const renderer = window.CardRender as { big: (card: object) => { innerHTML: string } };
  const card = renderer.big({
    id: 'test_name', name: '兵种（先攻）<测试>', faction: 'shu', type: 'troop', cost: 2,
  });
  assert.match(card.innerHTML, /兵种（先攻）&lt;测试&gt;/);
  assert.match(card.innerHTML, /title="兵种（先攻）&lt;测试&gt;"/);
});

/* ========================================================================
 * 「披坚」的炉石「圣盾」式光圈
 *
 * 披坚是**一次性资源**（免疫下一次伤害）—— 只用 8px 的状态徽章提示，
 * 玩家会照常打上去白亏一次攻击。所以卡面必须有**一眼可见**的护罩。
 * 挨打消耗后 sheng_dun_status 消失 → 渲染时不再挂类 → 光圈自然不见。
 * ===================================================================== */

function renderMini(opts: Record<string, unknown>) {
  const window = { Core: { KEYWORDS: {} }, CardRender: undefined as unknown };
  const document = {
    createElement: () => ({ className: '', dataset: {} as Record<string, string>, innerHTML: '' }),
  };
  const source = readFileSync(new URL('../../prototype/card-render.js', import.meta.url), 'utf8');
  runInNewContext(source, { window, document });
  const R = window.CardRender as {
    mini: (c: object, o?: object) => { className: string; innerHTML: string };
  };
  const unit = { id: 'u1', name: '宿卫虎士', faction: 'wei', type: 'troop',
                 cost: 2, atk: 2, hp: 3, maxHp: 3, kw: [] };
  return R.mini(unit, opts);
}

test('披坚：卡面挂出光圈，被消耗后自然消失', () => {
  const withShield = renderMini({ statuses: [{ id: 'sheng_dun_status', name: '披坚', stacks: 1 }] });
  assert.match(withShield.className, /has-pijian/, '带披坚时应挂 has-pijian');
  assert.match(withShield.innerHTML, /cr-shield-glass/, '应渲染护罩元素');

  const without = renderMini({ statuses: [] });
  assert.doesNotMatch(without.className, /has-pijian/, '无披坚时不应挂类');
  assert.doesNotMatch(without.innerHTML, /cr-shield-glass/, '无披坚时不应有护罩');

  // 消耗后的状态：只有别的状态、没有披坚 → 护罩必须消失（无需额外清理逻辑）
  const consumed = renderMini({ statuses: [{ id: 'jia_dun_status', name: '架盾', stacks: 1 }] });
  assert.doesNotMatch(consumed.innerHTML, /cr-shield-glass/, '披坚被消耗后护罩应消失');
});

test('披坚：护罩是**空心盾形描边**，绝不能糊住卡面', () => {
  const css = readFileSync(new URL('../../prototype/card-render.css', import.meta.url), 'utf8');
  assert.match(css, /\.cr-shield-glass\s*\{/, 'CSS 必须定义 .cr-shield-glass');
  assert.match(css, /prefers-reduced-motion/, '应尊重系统的减少动态效果设置');

  // 前四版教训：盾形必须 fill='none' 的描边、不得有不透明底、不得有盾徽方块，
  // 否则名字/立绘/攻血会被糊住（或压上一个难看的米黄色方块）。
  assert.match(css, /fill='none'/, "盾形必须是空心描边（fill='none'）");
  assert.doesNotMatch(css, /cr-shield-glass::after/,
    '不得有 ::after 盾徽方块 —— 已被否决（丑且压住卡面）');

  const body = css.slice(css.indexOf('.cr-shield-glass {'), css.indexOf('@keyframes cr-pijian-pulse'));
  assert.doesNotMatch(body, /background:[^;]*#[0-9a-f]{3,6}/i,
    '护罩不得有不透明实色底 —— 会糊住卡面');

  // 第七版改成双层描边（外暗金厚 + 内亮金高光）撑起"护盾壁"厚度感。
  assert.match(body, /stroke-width='7'/, '应保留外层暗金厚边');
  assert.match(css, /\.cr-shield-glass::before\s*\{/, '应有内层亮金高光（::before）');
  assert.match(css, /stroke-width='3'/, '内层应保留亮金细边');

  // ⚠️ 踩过最坑的一次：护罩 URL 写成 `url(&quot;data:...&quot;)` —— HTML 实体在 CSS 里
  // 是**字面量**、不是引号，整个 url() 解析失败 → background-image 变成 `none`，
  // 护罩**完全不可见**，而 grep 类名 / 看 DOM 都查不出来（元素在，只是没画出来）。
  // 只有浏览器实测 getComputedStyle(el).backgroundImage 才发现是 none。
  // 这里锁死：URL 必须用真引号。
  assert.doesNotMatch(css, /url\(&quot;/, 'CSS 的 url() 必须用真引号；&quot; 会让整条 background 失效');
  assert.match(css, /url\("data:image\/svg\+xml,/, '护罩 SVG 必须用 url("...") 真引号');

  // 盾形路径：顶部应是**平缓的拱**（Q 曲线），不能是向上凸的尖角 ——
  // 尖角会看起来像"倒过来的盾牌"，不完整。
  assert.match(css, /d='M6 12 Q30 6 54 12/, '盾形顶部应为拱形 Q 曲线，不是尖角');
});
