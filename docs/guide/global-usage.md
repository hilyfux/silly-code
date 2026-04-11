# 全局使用（任意目录启动）

安装脚本会自动将命令链接到 `~/.local/bin/`。如果 PATH 已配置，可以在任意目录直接使用：

```bash
cd ~/your-project
sillyx                 # OpenAI Codex
sillyt                 # GitHub Copilot
sillye                 # Claude
silly status           # 查看状态
```

## 手动配置 PATH

如果安装脚本未自动配置 PATH，在 `~/.bashrc` 或 `~/.zshrc` 中添加：

```bash
export PATH="$HOME/.local/bin:$PATH"
```

然后重新加载：

```bash
source ~/.zshrc  # 或 source ~/.bashrc
```

## 验证

```bash
cd ~/any-project
sillyx
# 启动后询问「当前目录是什么？」，应显示 ~/any-project
```
