# 快速开始

## 1. 一键安装

```bash
curl -fsSL https://raw.githubusercontent.com/hilyfux/silly-code/main/install.sh | bash
```

需要 **Node.js >= 20** 和 **git**。安装脚本会自动克隆代码、获取上游二进制、构建补丁。

## 2. 登录

```bash
silly login codex      # ChatGPT Pro / Codex (推荐)
silly login copilot    # GitHub Copilot
silly login claude     # Claude Pro/Max
```

## 3. 启动

```bash
sillyx                 # OpenAI Codex
sillyt                 # GitHub Copilot
sillye                 # Claude
```

## 4. 管理

```bash
silly status           # 查看登录状态
silly models           # 查看可用模型
silly doctor           # 检查环境
silly update           # 检查更新
silly update apply     # 应用更新
silly uninstall        # 完全卸载
```

## 5. 降级模式

如果 TUI 出现问题：

```bash
CLAUDE_CODE_FORCE_RECOVERY_CLI=1 sillyx
```
