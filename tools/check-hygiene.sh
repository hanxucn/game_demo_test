#!/usr/bin/env bash
# ============================================================
# 仓库卫生检查：6 条通用规则，全部「从索引实算」，不维护文件清单
#
# ① .gitignore 非注释行不得含 #（gitignore 不支持行尾注释，写了整行**静默失效**）
# ② 已跟踪的文件不得被 .gitignore 命中（命中说明规则形同虚设）
# ③ 文件类型白名单 —— 不看目录、只看扩展名，兜住编译产物 / 二进制 / 压缩包
# ④ 不得出现依赖安装特征（*.dist-info/、site-packages/、__pycache__/、node_modules/ …）
# ⑤ 顶层目录白名单（只有 .githooks core data docs prototype server tools 七个）
#    —— 补 ③④ 都漏掉的那类：纯源码被装进了一个新目录
# ⑥ .githooks/ 下的钩子必须有可执行权限 —— git 对没执行位的钩子是**静默跳过**的，
#    一个不跑的钩子比没有钩子更糟：它让人以为防线还在（2026-10-02 实测踩过）
#
# 用法：bash tools/check-hygiene.sh　　退出码：0 = 通过，1 = 有问题（消息里给出修法）
# 由 .githooks/pre-commit 调用。
# ============================================================
set -uo pipefail
cd "$(git rev-parse --show-toplevel)" 2>/dev/null || { echo "✗ 不在 git 仓库里"; exit 1; }

fail=0
hint() { printf '%s\n' "$@"; }

# ---------- ① .gitignore 不得有行尾注释 ----------
n=0
while IFS= read -r line || [ -n "$line" ]; do
  n=$((n + 1))
  [ -z "$line" ] && continue                      # 空行
  [ "${line#\#}" != "$line" ] && continue          # 以 # 开头 = 纯注释行
  if [ "${line#*\#}" != "$line" ]; then            # 含 #
    echo "✗ .gitignore 第 $n 行含 '#'（行尾注释）—— 这一行会整条失效："
    echo "      $line"
    fail=1
  fi
done < .gitignore
[ "$fail" != 0 ] && hint "    修法：说明文字移到**单独一行**的 # 注释里（要匹配含 # 的文件名才用 \\# 转义）。"

# ---------- ② 已跟踪 且 被 .gitignore 命中 ----------
# 唯一需要"例外"的：**故意保持入库**的浏览器产物与引擎数据（见 .gitignore 末尾的说明）。
ALLOW='^(prototype/(core|data)\.bundle\.js|core/data/[^/]+\.json)$'
bad=$(git ls-files -z | git check-ignore --no-index -z --stdin 2>/dev/null \
      | tr '\0' '\n' | grep -vE "$ALLOW" || true)
if [ -n "$bad" ]; then
  n_bad=$(printf '%s\n' "$bad" | wc -l | tr -d ' ')
  echo "✗ 有 $n_bad 个文件「已被跟踪」却「被 .gitignore 命中」—— 规则对它们不起作用，照样可能被提交："
  printf '%s\n' "$bad" | head -8 | sed 's/^/      /'
  [ "$n_bad" -gt 8 ] && echo "      …（还有 $((n_bad - 8)) 个）"
  echo "    修法：取消跟踪（文件保留在磁盘）："
  # 若同属一个顶层目录，直接给出可粘贴的命令，省得手工拼几十个路径
  tops=$(printf '%s\n' "$bad" | awk -F/ '{print $1}' | sort -u)
  if [ "$(printf '%s\n' "$tops" | wc -l | tr -d ' ')" = 1 ]; then
    echo "      git rm -r --cached -- $tops"
  else
    echo "      git rm -r --cached -- <上面每个文件或目录>"
  fi
  echo "    若它本来就该入库，则应删掉 .gitignore 里那条规则。"
  fail=1
fi

# ---------- ③ 文件类型白名单 ----------
# 本仓库实际用到的类型。**加新类型时在这里补一项**（这是唯一需要维护的地方，
# 而且漏了会立刻报错、不会静默放行）。
ALLOWED_EXT='ts|mjs|cjs|js|json|yaml|yml|md|html|css|sh|py|sql|txt|gitignore|gitattributes|editorconfig'
# 无扩展名的合法文件（LICENSE、Makefile 等）
ALLOWED_NOEXT='LICENSE|Makefile|Dockerfile'
# `.githooks/` 下的一切都放行：git 的钩子按约定就是无扩展名的脚本（pre-commit / post-merge …）。
# 逐个枚举钩子名会变成"每加一个新钩子就被拦一次"的维护负担。
suspect=$(git ls-files \
  | grep -vE "\.($ALLOWED_EXT)$" \
  | grep -vE "(^|/)($ALLOWED_NOEXT)$" \
  | grep -vE '^\.githooks/[^/]+$' || true)
if [ -n "$suspect" ]; then
  n_s=$(printf '%s\n' "$suspect" | wc -l | tr -d ' ')
  echo "✗ 有 $n_s 个文件的类型不在白名单里 —— 编译产物/二进制/压缩包不该进仓库："
  printf '%s\n' "$suspect" | head -8 | sed 's/^/      /'
  [ "$n_s" -gt 8 ] && echo "      …（还有 $((n_s - 8)) 个）"
  hint "    修法：取消跟踪  git rm -r --cached -- <上面每个文件或目录>" \
       "    若这个类型确实该入库（例如将来要放图片素材），就在 tools/check-hygiene.sh" \
       "    的 ALLOWED_EXT 里补上它 —— 补完即通过，不会静默放行。"
  fail=1
fi

# ---------- ④ 依赖安装特征 ----------
DEP_SIG='(^|/)(site-packages|__pycache__|node_modules)/|\.(dist-info|egg-info)/|(^|/)(INSTALLER|RECORD|METADATA|WHEEL)$'
deps=$(git ls-files | grep -E "$DEP_SIG" || true)
if [ -n "$deps" ]; then
  n_d=$(printf '%s\n' "$deps" | wc -l | tr -d ' ')
  echo "✗ 有 $n_d 个路径带「依赖安装特征」—— 依赖不该装进仓库："
  printf '%s\n' "$deps" | head -8 | sed 's/^/      /'
  [ "$n_d" -gt 8 ] && echo "      …（还有 $((n_d - 8)) 个）"
  tops=$(printf '%s\n' "$deps" | awk -F/ '{print $1}' | sort -u)
  hint "    修法：取消跟踪  git rm -r --cached -- $tops" \
       "    本地缺依赖就装到环境里：Python 用 pip install <包名>，Node 用 npm install。"
  fail=1
fi

# ---------- ⑤ 顶层目录白名单 ----------
# 仓库只允许这 7 个顶层目录。新冒出来的顶层目录几乎一定是「有东西被装进来了」——
# 2026-09-30 的 .codex-pyyaml/ 是这个形状，把它改名成 mydeps/ 也一样能拦。
# 加新的顶层目录时在这里补一项（这是本脚本第二处、也是最后一处需要维护的地方）。
ALLOWED_TOP='\.githooks|core|data|docs|prototype|server|tools'
bad_top=$(git ls-files | awk -F/ 'NF>1{print $1}' | sort -u | grep -vE "^($ALLOWED_TOP)$" || true)
if [ -n "$bad_top" ]; then
  n_t=$(printf '%s\n' "$bad_top" | wc -l | tr -d ' ')
  echo "✗ 出现了 $n_t 个白名单外的顶层目录 —— 基本可以肯定是误装进来的东西："
  printf '%s\n' "$bad_top" | sed 's/^/      /'
  hint "    修法：取消跟踪  git rm -r --cached -- <上面每个目录>" \
       "    若确实要新增顶层目录，就在 tools/check-hygiene.sh 的 ALLOWED_TOP 里补上它。"
  fail=1
fi

# ---------- ⑥ .githooks/ 下的钩子必须可执行 ----------
# git 对**没有可执行位**的钩子是**静默跳过**的（顶多给一句 hint，而且只在某些时机给）。
# 2026-10-02 实测：新加的 pre-push 与 pre-merge-commit 忘了 chmod +x，
# 结果「零主动命令」那套机制在真实仓库里根本没生效，而 lab 测试因为跑过 chmod +x 而测不出来。
noexec=$(git ls-files -s .githooks | awk '$1 != "100755" {print $4}' || true)
if [ -n "$noexec" ]; then
  n_x=$(printf '%s\n' "$noexec" | wc -l | tr -d ' ')
  echo "✗ 有 $n_x 个钩子没有可执行权限 —— git 会**静默跳过**它们："
  printf '%s\n' "$noexec" | sed 's/^/      /'
  hint "    修法： chmod +x <上面每个文件>  然后 git add -- <上面每个文件>"
  fail=1
fi

exit "$fail"
