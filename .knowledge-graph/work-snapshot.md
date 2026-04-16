# 工作快照 (04/16 16:03)

## 活跃模块
- pipeline/patches/providers (r:13 w:10)
- pipeline (r:2 w:1)
- pipeline/patches (r:1 w:0)
- . (r:1 w:0)

## 修改的模块
- pipeline/patches/providers
- pipeline

## 未提交变更 (work in progress)
-  M .knowledge-graph/graph-events.jsonl
-  M .knowledge-graph/work-snapshot.md

## 遇到的问题
- Bash: Exit code 1
- Bash: Exit code 1   ci-upgrade upgraded KG event: PASS node:assert:95   throw new AssertionError(obj);   ^
- Bash: Exit code 1 2026-04-16T07-32-11-851Z-openai-request.json 2026-04-16T07-32-13-620Z-openai-request.jso

## 本次提交
- 04a9666 fix(base): extend empty-param filter to also strip null tool inputs
- d172fcb fix(patch): create vendor symlink in build dir so Glob/Grep find ripgrep
- 72785b7 fix(base): strip empty-string tool params from GPT responses
- 9fe69f5 refactor(base): tighten collectResponsesSse — capture ts once, fix [DONE] exit
- 344b867 fix(kg): consume work-snapshot once at startup to prevent conversation bleed
