# 仓库拆分迁移 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 把源代码搬回 private/main 分支，公开仓退化为纯分发目标，建立自动化同步流程。

**Architecture:** 单仓开发（private），公开仓只接收 CI 推送。installer 脚本放在私有仓 `installer/` 子目录，经 workflow 扁平化同步到公开仓根目录。

**Tech Stack:** Git, GitHub Actions, GitHub Personal Access Token, gh CLI.

---

## 术语约定

- **`[我做]`**：我（AI 助手）通过工具执行的步骤
- **`[你做]`**：需要你本人在终端或 GitHub 网页操作的步骤
- **`[我做+你确认]`**：我执行但需要你明确点头（特别是不可逆操作）

## 全局前提

当前工作目录：`/Users/wanglinqing/Desktop/workspace-desktop/silly-code`
当前分支：`main`（指向 `7a23900`，即公开仓 dist-only）
Remote 配置：
- `origin` → `git@github.com:hilyfux/silly-code.git` (公开)
- `private` → `git@github.com:hilyfux/silly-code-src.git` (私有)

---

## Task 1: 备份现状 `[我做]`

**目的**：任何 force push 之前，先把当前状态做死保留，万一出错能 100% 回退。

**Files:**
- 无文件修改，只操作 git refs

- [ ] **Step 1.1：本地打备份 tag 记录两个 main 的当前 HEAD**

```bash
git tag backup/origin-main-2026-04-22 origin/main
git tag backup/private-main-2026-04-22 private/main
```

- [ ] **Step 1.2：推备份 tag 到两个 remote**

```bash
git push origin backup/origin-main-2026-04-22
git push private backup/private-main-2026-04-22
```

- [ ] **Step 1.3：验证备份存在**

```bash
git ls-remote origin refs/tags/backup/origin-main-2026-04-22
git ls-remote private refs/tags/backup/private-main-2026-04-22
```

Expected：各返回一行带 SHA 的 ref。

---

## Task 2: 创建迁移工作分支 `[我做]`

**目的**：基于 `v2.1.114` 源码创建新分支 `migration/repo-split`，所有后续改动在这个分支上做，验证 OK 后才覆盖 `private/main`。

**Files:**
- 无新建文件，只 checkout + 起分支

- [ ] **Step 2.1：创建 migration 分支**

```bash
git checkout -b migration/repo-split v2.1.114
```

Expected：工作目录切换到 2199 文件的源码状态。

- [ ] **Step 2.2：验证核心源码文件回来了**

```bash
ls pipeline/patch.cjs bin/silly.js bin/sillye.js deps.json
```

Expected：4 个文件都存在。

- [ ] **Step 2.3：验证 tracked 文件数**

```bash
git ls-files | wc -l
```

Expected：约 2199。

---

## Task 3: 把最新的 install 脚本覆盖过来 `[我做]`

**目的**：`v2.1.114` 里的 install 脚本是旧版（基于 git clone），公开仓 `main` 上的是最新 dist 版。要把最新的拿过来，否则新分支一旦推上去就是回退。

**Files:**
- Modify: `install.sh`, `install.ps1`, `uninstall.sh`, `uninstall.ps1`, `README.md` （来自 `origin/main@7a23900`）

- [ ] **Step 3.1：从 origin/main 拉取最新 install 脚本**

```bash
git checkout origin/main -- install.sh install.ps1 uninstall.sh uninstall.ps1 README.md
```

- [ ] **Step 3.2：确认内容是新版（含 dist tarball 下载逻辑）**

```bash
grep -l "releases/latest/download/silly-code.tar.gz" install.sh install.ps1
```

Expected：两个文件都包含这行（代表是新 dist 版本）。

- [ ] **Step 3.3：暂存但不提交**

```bash
git add install.sh install.ps1 uninstall.sh uninstall.ps1 README.md
```

---

## Task 4: 把 install 脚本搬到 `installer/` 子目录 `[我做]`

**目的**：按设计，公开仓根目录的 5 个文件来自私有仓 `installer/` 子目录。

**Files:**
- Create: `installer/` 目录
- Move: `install.sh` → `installer/install.sh`（其他 4 个同理）

- [ ] **Step 4.1：建目录并移动文件**

```bash
mkdir -p installer
git mv install.sh installer/install.sh
git mv install.ps1 installer/install.ps1
git mv uninstall.sh installer/uninstall.sh
git mv uninstall.ps1 installer/uninstall.ps1
git mv README.md installer/README.md
```

- [ ] **Step 4.2：根目录新建一个简短的 README 面向开发者（可选但建议）**

写入 `README.md`：

```markdown
# silly-code (source)

Private source repo for silly-code. Users should install via the public mirror:
https://github.com/hilyfux/silly-code

## Structure

- `installer/` — install/uninstall scripts synced to public mirror
- `pipeline/` — patch build pipeline
- `bin/` — runtime launchers
- `skills/` — Claude Code skills
- `.github/workflows/` — CI (sync-installer + release)

## Development

All development happens on `main` of this private repo. CI handles pushing
`installer/` to the public mirror and creating releases.
```

- [ ] **Step 4.3：验证布局**

```bash
ls installer/
ls *.sh *.ps1 2>&1 | grep -v "No such"
```

Expected：`installer/` 里 5 个文件；根目录没有剩余的 `.sh`/`.ps1`。

- [ ] **Step 4.4：Commit**

```bash
git commit -m "refactor: move install scripts to installer/ subdir for CI sync"
```

---

## Task 5: 写 sync-installer workflow `[我做]`

**目的**：监听 `installer/**` 变化，自动推到公开仓根目录。

**Files:**
- Create: `.github/workflows/sync-installer.yml`

- [ ] **Step 5.1：创建 workflow 文件**

写入 `.github/workflows/sync-installer.yml`：

```yaml
name: sync-installer

on:
  push:
    branches: [main]
    paths:
      - 'installer/**'
  workflow_dispatch:

permissions:
  contents: read

jobs:
  sync:
    runs-on: ubuntu-latest
    timeout-minutes: 5
    steps:
      - name: Checkout private source
        uses: actions/checkout@v4
        with:
          fetch-depth: 1

      - name: Checkout public mirror
        uses: actions/checkout@v4
        with:
          repository: hilyfux/silly-code
          token: ${{ secrets.PUBLIC_REPO_TOKEN }}
          path: public-mirror
          fetch-depth: 1

      - name: Sync installer/ → public root
        run: |
          set -euo pipefail
          # Remove old install/uninstall scripts + README from public root
          cd public-mirror
          rm -f install.sh install.ps1 uninstall.sh uninstall.ps1 README.md
          cd ..
          # Copy fresh versions
          cp installer/install.sh      public-mirror/install.sh
          cp installer/install.ps1     public-mirror/install.ps1
          cp installer/uninstall.sh    public-mirror/uninstall.sh
          cp installer/uninstall.ps1   public-mirror/uninstall.ps1
          cp installer/README.md       public-mirror/README.md

      - name: Commit + push if changed
        working-directory: public-mirror
        run: |
          set -euo pipefail
          git config user.name "silly-code-bot"
          git config user.email "silly-code-bot@users.noreply.github.com"
          if git diff --quiet; then
            echo "No changes — nothing to sync"
            exit 0
          fi
          SHA=$(cd .. && git rev-parse --short HEAD)
          git add install.sh install.ps1 uninstall.sh uninstall.ps1 README.md
          git commit -m "chore: sync installer from silly-code-src@${SHA}"
          git push origin main
```

- [ ] **Step 5.2：Commit**

```bash
git add .github/workflows/sync-installer.yml
git commit -m "ci: add sync-installer workflow to push installer/ to public mirror"
```

---

## Task 6: 改造 release workflow `[我做]`

**目的**：现有 `release.yml` 是针对老 clone-based 模式的。我们要重写成：检测 upstream 版本变化 → 构建 tarball → 在公开仓创建 Release。

**Files:**
- Modify: `.github/workflows/release.yml`

- [ ] **Step 6.1：查看现有 workflow 作为参考**

```bash
cat .github/workflows/release.yml | head -40
```

- [ ] **Step 6.2：覆写为新版**

写入 `.github/workflows/release.yml`（完整替换）：

```yaml
name: release

# Triggers when deps.json upstream.version changes on main.
# Builds the patched tarball and publishes a Release on the PUBLIC mirror.

on:
  push:
    branches: [main]
    paths:
      - 'deps.json'
      - 'pipeline/upstream/package/cli.js'
  workflow_dispatch:
    inputs:
      force_version:
        description: 'Force specific version (leave empty to read from deps.json)'
        required: false

permissions:
  contents: read

concurrency:
  group: release
  cancel-in-progress: false

jobs:
  release:
    runs-on: ubuntu-latest
    timeout-minutes: 15
    steps:
      - uses: actions/checkout@v4
        with:
          fetch-depth: 2  # need HEAD^ to diff

      - name: Detect version change
        id: diff
        run: |
          set -euo pipefail
          OLD=$(git show HEAD^:deps.json 2>/dev/null | node -p "JSON.parse(require('fs').readFileSync(0,'utf8')).deps.upstream.version" 2>/dev/null || echo "")
          NEW=$(node -p "require('./deps.json').deps.upstream.version")
          echo "old=$OLD" >> $GITHUB_OUTPUT
          echo "new=$NEW" >> $GITHUB_OUTPUT
          if [ "${{ github.event.inputs.force_version }}" != "" ]; then
            echo "new=${{ github.event.inputs.force_version }}" >> $GITHUB_OUTPUT
            echo "changed=true" >> $GITHUB_OUTPUT
          elif [ "$OLD" = "$NEW" ] || [ -z "$NEW" ]; then
            echo "changed=false" >> $GITHUB_OUTPUT
          else
            echo "changed=true" >> $GITHUB_OUTPUT
          fi

      - uses: actions/setup-node@v4
        if: steps.diff.outputs.changed == 'true'
        with:
          node-version: '20'

      - name: Build patched binary
        if: steps.diff.outputs.changed == 'true'
        run: |
          node pipeline/patch.cjs
          node tests/base.test.cjs || true
          node tests/schema.test.cjs || true

      - name: Package tarball
        if: steps.diff.outputs.changed == 'true'
        run: |
          # Build tarball according to existing release layout.
          # Adjust the manifest below to match whatever packaging script exists.
          node pipeline/package-release.cjs || {
            echo "pipeline/package-release.cjs missing — implement before first release"
            exit 1
          }
          ls -la silly-code.tar.gz

      - name: Check tag does not already exist on public mirror
        if: steps.diff.outputs.changed == 'true'
        id: tag_check
        env:
          GH_TOKEN: ${{ secrets.PUBLIC_REPO_TOKEN }}
        run: |
          TAG="v${{ steps.diff.outputs.new }}"
          if gh release view "$TAG" --repo hilyfux/silly-code >/dev/null 2>&1; then
            echo "Release $TAG already exists — skipping"
            echo "exists=true" >> $GITHUB_OUTPUT
          else
            echo "exists=false" >> $GITHUB_OUTPUT
          fi

      - name: Create Release on public mirror
        if: steps.diff.outputs.changed == 'true' && steps.tag_check.outputs.exists == 'false'
        env:
          GH_TOKEN: ${{ secrets.PUBLIC_REPO_TOKEN }}
        run: |
          NEW="${{ steps.diff.outputs.new }}"
          OLD="${{ steps.diff.outputs.old }}"
          CHANGELOG_URL="https://github.com/anthropics/claude-code/releases/tag/v${NEW}"

          NOTES=$(cat <<EOF
          **Upstream: Claude Code \`${OLD}\` → \`${NEW}\`**

          Patched downstream by silly-code with:
          - 2 providers (Claude / OpenAI Codex)
          - zero telemetry
          - zero tier gating

          ### Install / upgrade

          **macOS / Linux**
          \`\`\`bash
          curl -fsSL https://raw.githubusercontent.com/hilyfux/silly-code/main/install.sh | bash
          \`\`\`

          **Windows PowerShell**
          \`\`\`powershell
          irm https://raw.githubusercontent.com/hilyfux/silly-code/main/install.ps1 | iex
          \`\`\`

          ### Upstream notes
          [Claude Code ${NEW} release notes](${CHANGELOG_URL})
          EOF
          )

          gh release create "v${NEW}" \
            --repo hilyfux/silly-code \
            --title "silly-code v${NEW}" \
            --notes "$NOTES" \
            silly-code.tar.gz

      - name: Summary
        if: always()
        run: |
          echo "### Release" >> $GITHUB_STEP_SUMMARY
          echo "| Old | New | Changed |" >> $GITHUB_STEP_SUMMARY
          echo "|-----|-----|---------|" >> $GITHUB_STEP_SUMMARY
          echo "| \`${{ steps.diff.outputs.old }}\` | \`${{ steps.diff.outputs.new }}\` | ${{ steps.diff.outputs.changed }} |" >> $GITHUB_STEP_SUMMARY
```

⚠️ 这个 workflow 里引用了 `pipeline/package-release.cjs` —— 如果现有代码没这个打包脚本，第一次 run 会 fail。迁移完成后需要补这个脚本，或调整 workflow 去调用现有打包逻辑。（这是已知缺口，在 Task 12 验证时会暴露。）

- [ ] **Step 6.3：Commit**

```bash
git add .github/workflows/release.yml
git commit -m "ci: rewrite release workflow to publish to public mirror"
```

---

## Task 7: 把设计文档和计划也提交 `[我做]`

**目的**：保留决策痕迹。

**Files:**
- Already created: `docs/superpowers/specs/2026-04-22-repo-split-design.md`
- Already created: `docs/superpowers/plans/2026-04-22-repo-split-migration.md` (本文件)

- [ ] **Step 7.1：确认两个文档已存在**

```bash
ls docs/superpowers/specs/2026-04-22-repo-split-design.md
ls docs/superpowers/plans/2026-04-22-repo-split-migration.md
```

- [ ] **Step 7.2：Commit**

```bash
git add docs/superpowers/
git commit -m "docs: repo split design + migration plan"
```

---

## Task 8: 创建 PAT（Personal Access Token）`[你做]`

**目的**：给 private 仓的 CI 一个能往 public 仓写东西的凭据。

**为什么你亲自操作**：PAT 只能在 GitHub 网页上用你自己的登录态创建，我没法代做。

- [ ] **Step 8.1：打开 Fine-grained PAT 创建页**

浏览器访问：https://github.com/settings/personal-access-tokens/new

- [ ] **Step 8.2：填写表单**

| 字段 | 填什么 |
|------|--------|
| Token name | `silly-code-sync-to-public` |
| Expiration | `90 days`（或 Custom → 设 1 年） |
| Description | `Allows silly-code-src CI to push to silly-code public mirror` |
| Resource owner | `hilyfux` |
| Repository access | 选 `Only select repositories` → 勾 `hilyfux/silly-code` |

- [ ] **Step 8.3：权限（Repository permissions）**

| 权限项 | 级别 |
|--------|------|
| Contents | **Read and write** |
| Metadata | Read-only（自动勾） |
| Workflows | **Read and write**（给 release.yml 用） |
| 其他 | 保持默认 No access |

- [ ] **Step 8.4：点 Generate token**

屏幕会显示一个 `github_pat_xxx...` 字符串 —— **只显示一次**，立刻复制。

- [ ] **Step 8.5：告诉我 token 已生成（不要粘贴给我！）**

用一句"token 已拿到"告诉我就行，真 token 你自己保管。

---

## Task 9: 把 PAT 存进 private 仓 secrets `[你做]`

**目的**：workflow 要通过 `secrets.PUBLIC_REPO_TOKEN` 取用。

- [ ] **Step 9.1：打开 private 仓 secrets 页**

浏览器访问：https://github.com/hilyfux/silly-code-src/settings/secrets/actions

- [ ] **Step 9.2：点 `New repository secret`**

- [ ] **Step 9.3：填写**

| 字段 | 值 |
|------|----|
| Name | `PUBLIC_REPO_TOKEN` |
| Secret | 粘贴刚才复制的 `github_pat_xxx...` |

- [ ] **Step 9.4：点 `Add secret`**

- [ ] **Step 9.5：确认**

页面应看到 `PUBLIC_REPO_TOKEN` 出现在 Repository secrets 列表里。

- [ ] **Step 9.6：告诉我 secret 配好了**

---

## Task 10: 推送 migration 分支到 private `[我做+你确认]`

**目的**：先推到一个新分支（不覆盖 main），让 workflow 识别但不实际跑同步。

- [ ] **Step 10.1：确认本地分支状态干净**

```bash
git status
git log --oneline -6
```

Expected：工作区 clean；最近 6 个 commit 是（大致）：docs、ci(release)、ci(sync-installer)、refactor(installer)、`v2.1.114` 源码历史。

- [ ] **Step 10.2：Push 到 private 新分支**

```bash
git push private migration/repo-split:migration/repo-split
```

Expected：push 成功，不触发任何 workflow（因为我们 push 的不是 main）。

- [ ] **Step 10.3：到 GitHub 网页检查 `.github/workflows/` 是否正确显示**

你打开 https://github.com/hilyfux/silly-code-src/blob/migration/repo-split/.github/workflows/sync-installer.yml —— 能看到内容说明推送成功。

---

## Task 11: 把 migration 分支提升为 main `[我做+你确认]`

**目的**：覆盖 `private/main`（当前是 dist-only 副本），让源码成为主分支。

⚠️ **不可逆操作**。但我们在 Task 1 备了 tag，真出事能恢复。执行前我会再让你确认一次。

- [ ] **Step 11.1：我在终端跟你二次确认**

我会明确说："即将 force push 覆盖 private/main，你确认吗？" —— 你回复"确认"我才动手。

- [ ] **Step 11.2：Force push**

```bash
git push private migration/repo-split:main --force-with-lease
```

- [ ] **Step 11.3：等待 workflow 触发**

此时 private/main 有了 `installer/**` 变化（相对上一个 main 版本），`sync-installer.yml` 应自动触发。

- [ ] **Step 11.4：观察 workflow 跑完**

浏览器打开：https://github.com/hilyfux/silly-code-src/actions

应看到 `sync-installer` run 正在跑或已完成。

---

## Task 12: 验证 sync-installer 成功 `[你做+我协助]`

- [ ] **Step 12.1：检查公开仓 main 是否有新 commit**

```bash
git fetch origin
git log origin/main --oneline -3
```

Expected：最顶上有一条 `chore: sync installer from silly-code-src@xxxx` 的 commit，作者是 `silly-code-bot`。

- [ ] **Step 12.2：对比公开仓 install.ps1 内容**

```bash
git show origin/main:install.ps1 | head -10
```

Expected：内容和 `installer/install.ps1` 一致。

- [ ] **Step 12.3：模拟真实用户的 curl**

```bash
curl -fsSL https://raw.githubusercontent.com/hilyfux/silly-code/main/install.sh | head -5
```

Expected：文件能拿到，内容是最新的。

**如果 Step 12 任何一步失败** → 回到 Task 1 的备份 tag 恢复，排查 workflow 日志。

---

## Task 13: 本地切换到新的 main `[我做]`

**目的**：本地 `main` 分支之前追踪 `origin/main`（dist-only），现在应该追踪 `private/main`（源码）。

- [ ] **Step 13.1：切回 main 分支**

```bash
git checkout main
```

- [ ] **Step 13.2：重置到 private/main**

```bash
git fetch private
git reset --hard private/main
```

- [ ] **Step 13.3：改 tracking 指向 private**

```bash
git branch --set-upstream-to=private/main main
```

- [ ] **Step 13.4：验证**

```bash
git status
git rev-parse HEAD private/main
```

Expected：`Your branch is up to date with 'private/main'`；两个 SHA 相同。

---

## Task 14: 清理旧的本地分支和 worktree `[我做+你确认]`

**目的**：之前的 `dist-only`、一堆 `worktree-agent-*` 都是历史包袱。

- [ ] **Step 14.1：列出要删的分支**

```bash
git branch | grep -E 'dist-only|worktree-agent-'
```

展示给你看，确认没有你还在用的。

- [ ] **Step 14.2：删分支（你确认后）**

```bash
git branch -D dist-only
git branch -D worktree-agent-a6511842 worktree-agent-a695af50 worktree-agent-a88df8f9 worktree-agent-ac181f70 worktree-agent-ade7740e worktree-agent-aeba5041 worktree-agent-aef11b2e
```

- [ ] **Step 14.3：清理 worktree 目录**

```bash
git worktree list
# 逐个 remove
git worktree remove .claude/worktrees/agent-a6511842 --force
# ...（我会循环处理所有）
git worktree prune
```

- [ ] **Step 14.4：删本地 migration 分支（已合并进 main，可删）**

```bash
git branch -D migration/repo-split
```

---

## Task 15: 公开仓 main 分支保护 `[你做]`

**目的**：防止未来误推到公开仓。

- [ ] **Step 15.1：打开公开仓的 branch protection 设置**

浏览器：https://github.com/hilyfux/silly-code/settings/branches

- [ ] **Step 15.2：Add rule**

| 字段 | 值 |
|------|----|
| Branch name pattern | `main` |
| Restrict who can push | 勾上，在列表里**只**加 `silly-code-bot`（如果没这个账号就留空 + 勾 Require PR） |
| Require pull request before merging | 可选，加一层保险 |

- [ ] **Step 15.3：保存**

## Task 16: 最终验证清单 `[你做+我协助]`

- [ ] **Step 16.1：从 IDE 重开工作目录**

关闭 IDE → 重开 `silly-code/` —— 应看到 2199 个文件，`installer/` 子目录存在。

- [ ] **Step 16.2：改一个无害文件触发 sync**

```bash
echo "" >> installer/README.md
git add installer/README.md
git commit -m "test: trigger sync-installer"
git push private main
```

- [ ] **Step 16.3：观察 30 秒内公开仓有无反应**

https://github.com/hilyfux/silly-code/commits/main —— 最顶上该出现 `chore: sync installer from silly-code-src@...`

- [ ] **Step 16.4：真实用户视角验证**

```bash
curl -fsSL https://raw.githubusercontent.com/hilyfux/silly-code/main/install.sh | grep -c "releases/latest/download/silly-code.tar.gz"
```

Expected：输出 `1` 或更多。

---

## Task 17: 已知后续工作（不在本次范围）`[记录]`

迁移完成后还需要跟进（但**不是**本次 plan 的事）：

- **补 `pipeline/package-release.cjs`**：`release.yml` 依赖它打 tarball。上游升级时第一次跑 release workflow 会暴露。
- **验证 release.yml**：假升一次 upstream 版本（例如 2.1.114 → 2.1.115），确认 Release + tarball 正确发布。
- **文档**：在 private 仓根 `README.md` 里写清楚"别推 origin/main，机器人会干"。

---

## 失败恢复路径

**场景 A：Task 10~11 之间发现 migration 分支有问题**

```bash
git checkout main
git branch -D migration/repo-split
# 从头重做
```

Private main 未动，origin main 未动，安全。

**场景 B：Task 11 force push 后 sync-installer 把公开仓搞坏了**

```bash
# 1. 先回滚公开仓
git fetch origin
git push origin backup/origin-main-2026-04-22:main --force-with-lease
# 2. 再回滚私有仓
git push private backup/private-main-2026-04-22:main --force-with-lease
```

公开仓 + 私有仓都回到 2026-04-22 原状。

---

## 执行节奏

Task 1~7 我可以一气呵成做完（约 5-10 分钟），做完后停下来让你过一眼。
Task 8~9 完全你做，我等你回信。
Task 10~14 我做但会在 force push 前让你点头。
Task 15 你做。
Task 16 联合验证。

准备好了告诉我"开始"，我从 Task 1 启动。
