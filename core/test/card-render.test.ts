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
