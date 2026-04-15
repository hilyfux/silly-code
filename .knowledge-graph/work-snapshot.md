# 工作快照 (04/15 19:04)

## 活跃模块
- pipeline (r:12 w:16)
- bin (r:6 w:12)
- tests (r:3 w:5)
- .github/workflows (r:1 w:3)
- . (r:2 w:1)
- skills (r:0 w:2)
- src/utils/plugins (r:1 w:0)
- src/cli (r:1 w:0)

## 修改的模块
- bin
- tests
- .
- skills
- pipeline
- .github/workflows

## 未提交变更 (work in progress)
-  M .github/workflows/upstream-upgrade.yml
-  M .gitignore
-  M bin/upgrade-check.sh
-  M pipeline/ci-upgrade.cjs
- ?? .knowledge-graph/
- ?? skills/
- ?? tests/ci-upgrade-kg.test.cjs
- ?? tests/upgrade-check.test.cjs

## 遇到的问题
- Bash: Exit code 1   ci-upgrade upgraded KG event: PASS node:assert:95   throw new AssertionError(obj);   ^
- Bash: Exit code 1 ls: /Users/wanglinqing/Desktop/workspace-desktop/silly-code/.claude/worktrees/agent-a30a
- Bash: Exit code 1 ls: /Users/wanglinqing/Desktop/workspace-desktop/silly-code/.claude/worktrees/agent-a422

## 本次提交
- 573675d refactor(bin): tighten auth exports and fix fragile string checks
- 12f0991 fix(cost): default to Sonnet 4.6 without giving up tier unlocks
- a569373 docs(kg): track src/ as legacy reference
- dd24e3a refactor: extract auth state helper and tighten Windows launcher
- c7e061c feat(privacy): silence auth-conflict and JetBrains banners
