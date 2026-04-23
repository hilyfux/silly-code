# 仓库拆分设计：源码私有 / 安装公开

**日期**：2026-04-22
**目标**：源代码不开源，安装脚本开源。单一开发工作台。

---

## 背景与问题

当前状态：

- `origin` (silly-code) 公开仓：只有 5 个 install/uninstall 脚本
- `private` (silly-code-src) 私有仓：**也只有同样 5 个脚本**（空壳，失去源码仓作用）
- 源代码（2199 个文件）只存在于 tag `v2.1.114` 等发布标签上，没有任何分支指向

痛点：

- 没有分支承载源码，开发无从下手
- 两个远程仓库内容一致，失去分工
- 开发者（用户）需要在多处切换工作目录

## 目标

1. **源代码私有**：完整 2199 文件的源码只在 `private` 仓，且有 `main` 分支承载
2. **安装脚本公开**：`curl raw.githubusercontent.com/hilyfux/silly-code/main/install.sh` 行为不变
3. **单一工作台**：开发者只在一个仓库（`private`）工作，IDE 只打开一个目录
4. **对外无感知**：用户安装命令 / tarball 下载链接都不变

## 最终架构

### 仓库分工

| 仓库 | 角色 | 写入者 |
|------|------|--------|
| `silly-code-src` (private) | 开发主仓 — 全部源码 + installer/ 子目录 | 人类 |
| `silly-code` (public) | 对外分发 — install 脚本 + Release 资产 | 仅 CI |

### 私有仓目录结构

```
silly-code-src/
├── installer/                      # 对外发布的脚本（公开仓的源）
│   ├── install.sh
│   ├── install.ps1
│   ├── uninstall.sh
│   ├── uninstall.ps1
│   └── README.md
├── pipeline/                       # patch 构建管线
├── bin/                            # 运行时启动器
├── skills/                         # Claude Code skills
├── .github/workflows/
│   ├── sync-installer.yml         # installer/ 变更 → 推公开仓根目录
│   └── release.yml                # deps.json 版本变更 → 构建 tarball + Release
└── ...（其它源码）
```

### 公开仓目录结构

```
silly-code/
├── install.sh          ← 来自私有仓 installer/install.sh（机器人同步）
├── install.ps1
├── uninstall.sh
├── uninstall.ps1
└── README.md
```

公开仓 Releases 承载 `silly-code-<version>.tar.gz`。

## 工作流

### 开发流程（人类）

所有 commit 发生在 private 仓。

| 场景 | 操作 | 触发的自动化 |
|------|------|-------------|
| 改 Windows 安装 bug | 编辑 `installer/install.ps1` → commit → push private/main | `sync-installer.yml` → 推到公开仓 |
| 升级 upstream 2.1.114→2.1.116 | 改 `pipeline/` + `deps.json` → commit → push | `release.yml` → 构建 tarball + Release |
| 安装脚本 + pipeline 同时改 | 一次 commit 同时覆盖两边 → push | 两个 workflow 都触发 |

### 发布流程（机器人）

**sync-installer.yml**：

- 触发：push 到 `private/main`，路径匹配 `installer/**`
- 动作：
  1. checkout private 仓
  2. 用 PAT 作为凭据，push `installer/` 的内容到 `public/main` 根目录
  3. commit message：`chore: sync installer from silly-code-src@<sha>`

**release.yml**：

- 触发：push 到 `private/main`，路径匹配 `deps.json` 或 upstream 包变化
- 动作：
  1. 检测 `deps.json` upstream.version 是否变化
  2. 构建 patched binary + tarball
  3. 在 **public 仓** 创建 tag `v<version>` + Release + 上传 `silly-code.tar.gz`

### 用户流程（无变化）

```bash
# macOS / Linux
curl -fsSL https://raw.githubusercontent.com/hilyfux/silly-code/main/install.sh | bash

# Windows
irm https://raw.githubusercontent.com/hilyfux/silly-code/main/install.ps1 | iex
```

Tarball 下载：`https://github.com/hilyfux/silly-code/releases/latest/download/silly-code.tar.gz`

## 跨仓权限

机器人从 private 写 public 需要 PAT：

- 在 GitHub → Settings → Developer settings → Personal Access Tokens → Fine-grained token
- 权限：Repository access = `silly-code`（公开仓），Contents + Metadata = Read/Write，Releases = Read/Write
- Token 存入 private 仓：Settings → Secrets → `PUBLIC_REPO_TOKEN`
- 两个 workflow 都用 `${{ secrets.PUBLIC_REPO_TOKEN }}` 而非默认 `GITHUB_TOKEN`

## 迁移步骤

1. **源码落到 private/main**
   - 本地：`git checkout -b source v2.1.114`
   - Cherry-pick 最近 6 个 Windows 修复 commit
   - `git push private source:main --force-with-lease`

2. **重组目录**
   - 新建 `installer/`，把根目录的 5 个 install 脚本移进去
   - 调整 `installer/install.sh` 和 `install.ps1` 里对自身路径的引用（如有）
   - Commit + push

3. **新增两个 workflow**
   - 写 `.github/workflows/sync-installer.yml`
   - 重写 `.github/workflows/release.yml`（现有的针对 origin 的要改成针对 public）
   - 本设计文档（本文件）一并提交

4. **配置 PAT**
   - 用户手动创建 PAT
   - 粘到 private 仓 secrets

5. **验证**
   - 改 `installer/README.md` 测试一次 → 观察公开仓是否刷新
   - 假升 upstream 版本测试一次 → 观察公开仓 Release 是否产生

6. **清理**
   - 公开仓现有本地分支 `dist-only`、worktree 分支 → 删除
   - 本地 `main` 切到 `private/main` 作为真实主分支

## 风险与对策

| 风险 | 对策 |
|------|------|
| PAT 泄漏 → 公开仓被污染 | 用 fine-grained token 限定到单一仓库，定期轮换 |
| CI 失败 → 公开仓脚本版本滞后 | sync-installer 失败时发 issue 提醒；用户影响可控（还能装旧版） |
| `installer/install.sh` 引用相对路径错位 | 审阅脚本，确保 `installer/install.sh` 能独立运行，不依赖同仓其他文件 |
| 历史丢失：force push private/main | 迁移前先 `git branch backup-old-main private/main` 留档 |
| 用户误推公开仓覆盖 CI 结果 | 公开仓 main 分支加保护规则：只允许 CI 机器人推 |

## 非目标（明确不做）

- 不做 monorepo（不把公开仓作为私有仓的 subtree 引入）
- 不做 submodule（4 步提交地狱）
- 不做手动同步（忘了就出问题）
- 不迁移到其他 Git 托管平台

## 成功标准

- [x] 开发者日常只 `cd silly-code-src/` 一个目录
- [x] 改 `installer/install.ps1` 推到 private 后，30 秒内公开仓 main 有新 commit
- [x] 改 `deps.json` upstream 版本推到 private 后，5 分钟内公开仓有新 Release + tarball
- [x] 用户现有安装命令完全不需要改动
