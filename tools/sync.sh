#!/usr/bin/env bash
# ============================================================
# 把最新的 main 合进当前分支（**可选**的引导版）
#
#   bash tools/sync.sh
#
# ⚠️ 不是必须的：普通 `git pull origin main` 已经能正确处理生成物（见 .gitattributes 的
#    merge=ours 与 .githooks/ 里的 pre-merge-commit / post-merge / pre-push）。
#    它只是把过程讲给你听，并在**手写文件**冲突时给出逐步指引。
#
# 流程：工作区不干净就拒绝 → 列出要合进来什么 → merge → 重建生成物并并进合并提交；
#       有冲突时：生成物自动占位重建，手写文件停下交给你。
# ============================================================
set -uo pipefail
cd "$(git rev-parse --show-toplevel)" 2>/dev/null || { echo "✗ 不在 git 仓库里"; exit 1; }

# 生成物 = 由 tools/ 脚本产出、且当前入库的那些（与 .gitattributes 一致）
GEN='^(prototype/(core|data)\.bundle\.js|core/data/.*\.json)$'
GEN_PATHS=(core/data prototype/core.bundle.js prototype/data.bundle.js)

# 重建生成物；有变化就 git add 并把清单打到 stdout
rebuild_generated() {
  local out changed
  if ! out=$(bash tools/build-cards.sh 2>&1); then
    echo "  ⚠ 产物重建失败 —— 手动跑一次看原因： bash tools/build-cards.sh" >&2
    return 0
  fi
  node tools/render-gdd.mjs >/dev/null 2>&1 || true
  changed=$(git diff --name-only -- "${GEN_PATHS[@]}")
  if [ -n "$changed" ]; then
    printf '%s\n' "$changed" | while IFS= read -r f; do [ -n "$f" ] && git add -- "$f"; done
    printf '%s\n' "$changed"
  fi
}

# ---------- 前提：merge=ours 得配好，否则合并没有自动兜底 ----------
if [ "$(git config merge.ours.driver 2>/dev/null || true)" != "true" ]; then
  git config merge.ours.driver true
  echo "▸ 已补上本地配置 merge.ours.driver（.gitattributes 的 merge=ours 需要它才生效）"
fi

# ---------- 在 main 上就直接 pull ----------
branch=$(git rev-parse --abbrev-ref HEAD)
if [ "$branch" = "main" ]; then
  echo "▸ 你已经在 main 上，直接拉取："
  exec git pull --ff-only origin main
fi

# ---------- ① 工作区必须干净 ----------
if ! git diff --quiet || ! git diff --cached --quiet; then
  echo "✗ 工作区有未提交的改动 —— 先提交（或 git stash）再同步。"
  echo "  理由：同步会引入别人的改动，和你的未提交改动混在一起就没法分辨谁改的了。"
  echo
  git status --short | sed 's/^/    /'
  exit 1
fi

# ---------- ② fetch + 看要合什么 ----------
echo "▸ 拉取远端…"
if ! git fetch origin -q 2>/dev/null; then
  echo "✗ fetch 失败（网络或远端不可达）"; exit 1
fi
if ! git rev-parse --verify -q origin/main >/dev/null; then
  echo "✗ 找不到 origin/main"; exit 1
fi

incoming=$(git log --oneline HEAD..origin/main)
if [ -z "$incoming" ]; then
  echo "✓ 当前分支已经包含 main 的全部提交，无需同步"
  exit 0
fi
echo "▸ main 上有这些新提交，将合入当前分支（${branch}）："
printf '%s\n' "$incoming" | sed 's/^/    /'
echo

# ---------- ③ merge ----------
echo "▸ 合并 origin/main…"
if git merge origin/main --no-edit >/dev/null 2>&1; then
  # 注意：`git merge` 会触发 .githooks/post-merge，它已经把重建结果**暂存**了。
  # 所以这里不能看"刚重建出什么变化"（那样永远是空的），要看**暂存区里有没有东西**。
  rebuild_generated >/dev/null
  staged=$(git diff --cached --name-only -- "${GEN_PATHS[@]}")
  if [ -n "$staged" ]; then
    echo "▸ 生成物与合并后的源不同步 —— 已重建并并入本次合并提交："
    printf '%s\n' "$staged" | sed 's/^/    /'
    git commit --amend --no-edit >/dev/null 2>&1 \
      || echo "  ⚠ 并入失败（可能被 pre-commit 拦下），改动仍在暂存区，下次提交会带上"
  fi
  echo "✓ 合并完成"
  exit 0
fi

# ---------- ④ 有冲突：分开处理 ----------
conflicts=$(git diff --name-only --diff-filter=U)
gen=$(printf '%s\n' "$conflicts" | grep -E "$GEN" || true)
src=$(printf '%s\n' "$conflicts" | grep -vE "$GEN" | grep -v '^$' || true)

if [ -n "$gen" ]; then
  echo "▸ 生成物冲突 —— 自动处理（选当前分支那份占位，随后由源码重建）："
  printf '%s\n' "$gen" | sed 's/^/    /'
  printf '%s\n' "$gen" | while IFS= read -r f; do
    [ -n "$f" ] && git checkout --ours -- "$f" 2>/dev/null
  done
fi

if [ -n "$src" ]; then
  echo
  echo "✗ 这些是**手写文件**的冲突，需要你来决定保留哪边（脚本不替你猜）："
  printf '%s\n' "$src" | sed 's/^/    /'
  echo
  echo "  做法：打开这些文件，把 <<<<<<< ======= >>>>>>> 三段整理成你要的样子"
  echo "        （连标记行一起删掉），然后："
  echo "          git add <文件>"
  echo "          git commit        # 生成物会由 pre-commit 钩子自动重建，不用你管"
  echo "  没装钩子的话，提交前先自己跑一次： bash tools/build-cards.sh"
  echo "  （装钩子： cd core && npm install）"
  echo "  放弃这次合并： git merge --abort"
  exit 1
fi

# 只有生成物冲突 → 重建 + 完成合并
echo "▸ 只有生成物冲突，重建后完成合并："
rebuilt=$(rebuild_generated)
[ -n "$rebuilt" ] && printf '%s\n' "$rebuilt" | sed 's/^/    /'
git commit --no-edit >/dev/null 2>&1 && echo "✓ 合并提交已创建（生成物已重建）" \
  || { echo "⚠ 合并提交失败，请运行 git status 查看"; exit 1; }
