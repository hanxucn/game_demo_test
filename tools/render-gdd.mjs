#!/usr/bin/env node
/**
 * 把 docs/gdd/*.md 渲染成单页 HTML（零依赖）。
 *
 * 用法：
 *   node tools/render-gdd.mjs
 *   node tools/render-gdd.mjs --open
 *
 * 输出：docs/gdd/index.html
 *
 * 说明：Markdown 是唯一真源，本脚本只做只读渲染，绝不反向写回。
 * 支持的语法子集：标题、表格、代码块、列表、引用、分隔线、粗体、行内代码、链接。
 */

import { readFile, writeFile } from 'node:fs/promises';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';

const __dirname = dirname(fileURLToPath(import.meta.url));
const GDD_DIR = resolve(__dirname, '..', 'docs', 'gdd');
const OUT_FILE = join(GDD_DIR, 'index.html');

const FILES = [
  'README.md',
  '01-overview.md',
  '02-battlefield.md',
  '03-turn-flow.md',
  '04-resources.md',
  '05-cards.md',
  '06-keywords.md',
  '07-troops.md',
  '08-heroes.md',
  '09-bonds.md',
  '10-skills-statuses.md',
  '11-events-tactics-jiuling.md',
  '12-randomness.md',
  '13-balance-data-model.md',
  '14-open-questions.md',
  '15-card-visual.md',
];

// ---------- 工具函数 ----------

const esc = (s) =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

function inline(text) {
  let t = esc(text);
  t = t.replace(/`([^`]+)`/g, '<code>$1</code>');
  t = t.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
  t = t.replace(/\[([^\]]+)\]\(([^)\s]+)\)/g, '<a href="$2">$1</a>');
  return t;
}

const RE_HEADING = /^(#{1,6})\s+(.*)$/;
const RE_FENCE = /^\s*```/;
const RE_HR = /^\s*(---|\*\*\*|___)\s*$/;
const RE_QUOTE = /^\s*>\s?/;
const RE_LIST = /^\s*([-*]|\d+\.)\s+/;
const RE_ORDERED = /^\s*\d+\.\s+/;
const RE_TABLE_SEP = /^\s*\|?[\s:|-]+\|[\s:|-]*$/;

function isBlockStart(line) {
  return (
    RE_FENCE.test(line) ||
    RE_HEADING.test(line) ||
    RE_HR.test(line) ||
    RE_QUOTE.test(line) ||
    RE_LIST.test(line) ||
    /^\s*\|/.test(line)
  );
}

function splitRow(line) {
  return line
    .trim()
    .replace(/^\|/, '')
    .replace(/\|$/, '')
    .split('|')
    .map((c) => c.trim());
}

// ---------- Markdown → HTML ----------

function renderMarkdown(md) {
  const lines = md.split(/\r?\n/);
  const out = [];
  let i = 0;

  while (i < lines.length) {
    const line = lines[i];

    // 代码块
    if (RE_FENCE.test(line)) {
      i++;
      const buf = [];
      while (i < lines.length && !RE_FENCE.test(lines[i])) {
        buf.push(esc(lines[i]));
        i++;
      }
      i++; // 跳过结束围栏
      out.push(`<pre><code>${buf.join('\n')}</code></pre>`);
      continue;
    }

    // 标题
    const h = line.match(RE_HEADING);
    if (h) {
      const level = h[1].length;
      out.push(`<h${level}>${inline(h[2])}</h${level}>`);
      i++;
      continue;
    }

    // 分隔线
    if (RE_HR.test(line)) {
      out.push('<hr>');
      i++;
      continue;
    }

    // 表格
    if (
      /^\s*\|/.test(line) &&
      i + 1 < lines.length &&
      RE_TABLE_SEP.test(lines[i + 1])
    ) {
      const head = splitRow(lines[i]);
      i += 2;
      const rows = [];
      while (i < lines.length && /^\s*\|/.test(lines[i])) {
        rows.push(splitRow(lines[i]));
        i++;
      }
      const thead = `<thead><tr>${head
        .map((c) => `<th>${inline(c)}</th>`)
        .join('')}</tr></thead>`;
      const tbody = `<tbody>${rows
        .map(
          (r) =>
            `<tr>${r.map((c) => `<td>${inline(c)}</td>`).join('')}</tr>`,
        )
        .join('')}</tbody>`;
      out.push(`<div class="table-wrap"><table>${thead}${tbody}</table></div>`);
      continue;
    }

    // 引用
    if (RE_QUOTE.test(line)) {
      const buf = [];
      while (i < lines.length && RE_QUOTE.test(lines[i])) {
        buf.push(inline(lines[i].replace(RE_QUOTE, '')));
        i++;
      }
      out.push(`<blockquote>${buf.join('<br>')}</blockquote>`);
      continue;
    }

    // 列表
    if (RE_LIST.test(line)) {
      const ordered = RE_ORDERED.test(line);
      const items = [];
      while (i < lines.length && RE_LIST.test(lines[i])) {
        items.push(inline(lines[i].replace(RE_LIST, '')));
        i++;
      }
      const tag = ordered ? 'ol' : 'ul';
      out.push(
        `<${tag}>${items.map((x) => `<li>${x}</li>`).join('')}</${tag}>`,
      );
      continue;
    }

    // 空行
    if (/^\s*$/.test(line)) {
      i++;
      continue;
    }

    // 段落
    const buf = [];
    while (
      i < lines.length &&
      !/^\s*$/.test(lines[i]) &&
      !isBlockStart(lines[i])
    ) {
      buf.push(inline(lines[i]));
      i++;
    }
    if (buf.length) out.push(`<p>${buf.join('<br>')}</p>`);
  }

  return out.join('\n');
}

// ---------- 组装页面 ----------

function slugify(name) {
  return name
    .replace(/\.md$/, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');
}

function firstHeading(md, fallback) {
  for (const line of md.split(/\r?\n/)) {
    const m = line.match(/^#\s+(.*)$/);
    if (m) return m[1].trim();
  }
  return fallback;
}

const CSS = `
:root {
  --bg: #14110e;
  --panel: #1d1915;
  --panel-2: #241f19;
  --ink: #e9e2d5;
  --ink-dim: #b6ac9c;
  --gold: #c8a15a;
  --red: #a8402f;
  --green: #4e7a4a;
  --blue: #3f6b93;
  --line: #3a3229;
}
* { box-sizing: border-box; }
html, body { margin: 0; padding: 0; }
body {
  background: var(--bg);
  color: var(--ink);
  font-family: "PingFang SC", "Hiragino Sans GB", "Microsoft YaHei", system-ui, sans-serif;
  line-height: 1.75;
  font-size: 15px;
}
a { color: var(--gold); text-decoration: none; }
a:hover { text-decoration: underline; }
code {
  background: #2c261f;
  border: 1px solid var(--line);
  border-radius: 4px;
  padding: 1px 5px;
  font-size: 0.9em;
  font-family: "SFMono-Regular", Menlo, Consolas, monospace;
  color: #e6c98d;
}
pre {
  background: #191510;
  border: 1px solid var(--line);
  border-left: 3px solid var(--gold);
  border-radius: 6px;
  padding: 14px 16px;
  overflow-x: auto;
}
pre code { background: none; border: none; padding: 0; color: #d8cdb8; }
.layout { display: flex; align-items: flex-start; }
nav {
  position: sticky;
  top: 0;
  flex: 0 0 250px;
  height: 100vh;
  overflow-y: auto;
  padding: 26px 16px;
  background: var(--panel);
  border-right: 1px solid var(--line);
}
nav .brand { font-size: 17px; color: var(--gold); font-weight: 700; letter-spacing: 1px; }
nav .sub { font-size: 12px; color: var(--ink-dim); margin: 4px 0 18px; }
nav a {
  display: block;
  padding: 6px 9px;
  border-radius: 5px;
  color: var(--ink-dim);
  font-size: 13.5px;
}
nav a:hover { background: var(--panel-2); color: var(--ink); text-decoration: none; }
main { flex: 1 1 auto; min-width: 0; padding: 34px 46px 120px; max-width: 1080px; }
section { margin-bottom: 76px; padding-bottom: 12px; border-bottom: 1px dashed var(--line); }
section:last-child { border-bottom: none; }
h1 { font-size: 26px; color: var(--gold); border-bottom: 2px solid var(--line); padding-bottom: 10px; margin-top: 0; }
h2 { font-size: 20px; color: #e0c489; margin-top: 38px; }
h3 { font-size: 16.5px; color: #d9c9a6; margin-top: 26px; }
h4 { font-size: 15px; color: var(--ink-dim); margin-top: 20px; }
blockquote {
  margin: 16px 0;
  padding: 10px 16px;
  background: #221c16;
  border-left: 3px solid var(--red);
  border-radius: 0 6px 6px 0;
  color: #ddd2c0;
}
.table-wrap { overflow-x: auto; margin: 16px 0; }
table { border-collapse: collapse; width: 100%; font-size: 13.5px; }
th, td { border: 1px solid var(--line); padding: 8px 11px; text-align: left; vertical-align: top; }
th { background: #2a231c; color: var(--gold); font-weight: 600; white-space: nowrap; }
tr:nth-child(even) td { background: #1a1611; }
ul, ol { padding-left: 22px; }
li { margin: 4px 0; }
hr { border: none; border-top: 1px solid var(--line); margin: 26px 0; }
strong { color: #f0e6d2; }
@media (max-width: 900px) {
  .layout { flex-direction: column; }
  nav { position: static; height: auto; width: 100%; flex: none; border-right: none; border-bottom: 1px solid var(--line); }
  main { padding: 22px 18px 80px; }
}
`;

async function main() {
  const sections = [];
  const navItems = [];

  for (const file of FILES) {
    let md;
    try {
      md = await readFile(join(GDD_DIR, file), 'utf8');
    } catch {
      console.warn(`[skip] 未找到 ${file}`);
      continue;
    }
    const title = firstHeading(md, file);
    const id = slugify(file);
    navItems.push(`<a href="#${id}">${esc(title)}</a>`);
    sections.push(
      `<section id="${id}">\n${renderMarkdown(md)}\n</section>`,
    );
  }

  const html = `<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>《酒话三国》机制设计文档</title>
<style>${CSS}</style>
</head>
<body>
<div class="layout">
  <nav>
    <div class="brand">酒话三国</div>
    <div class="sub">机制设计文档 · 单页阅读版</div>
    ${navItems.join('\n    ')}
  </nav>
  <main>
${sections.join('\n')}
  </main>
</div>
</body>
</html>
`;

  await writeFile(OUT_FILE, html, 'utf8');
  console.log(`✓ 已生成 ${OUT_FILE}`);
  console.log(`  ${FILES.length} 个文档，${(html.length / 1024).toFixed(1)} KB`);

  if (process.argv.includes('--open')) {
    const cmd =
      process.platform === 'darwin'
        ? 'open'
        : process.platform === 'win32'
          ? 'start'
          : 'xdg-open';
    spawn(cmd, [OUT_FILE], { detached: true, stdio: 'ignore' }).unref();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
