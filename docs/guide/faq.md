# 常见问题


## Q: `undefined is not an object (evaluating 'usage.input_tokens')`

**原因**：`ANTHROPIC_BASE_URL` 配置不正确，API 端点返回的不是 Anthropic 协议格式的 JSON，而是 HTML 页面或其他格式。

本项目使用 **Anthropic Messages API 协议**，`ANTHROPIC_BASE_URL` 必须指向一个兼容 Anthropic `/v1/messages` 接口的端点。Anthropic SDK 会自动在 base URL 后面拼接 `/v1/messages`，所以：

- MiniMax：`ANTHROPIC_BASE_URL=https://api.minimaxi.com/anthropic` ✅
- OpenRouter：`ANTHROPIC_BASE_URL=https://openrouter.ai/api` ✅
- OpenRouter 错误写法：`ANTHROPIC_BASE_URL=https://openrouter.ai/anthropic` ❌（返回 HTML）

如果你的模型供应商只支持 OpenAI 协议，需要通过 LiteLLM 等代理做协议转换，详见 [第三方模型使用指南](./third-party-models.md)。

## Q: 怎么接入 OpenAI / DeepSeek / Ollama 等非 Anthropic 模型？

本项目内置了 OpenAI 和 Copilot 的原生支持（通过 `sillyx` 和 `sillyt`）。对于其他模型，可以用 [LiteLLM](https://github.com/BerriAI/litellm) 等代理做协议转换。

详细配置步骤请参考：[第三方模型使用指南](./third-party-models.md)

## Q: 提示 "no auth token" 怎么办？

运行对应的登录命令：

```bash
silly login codex      # OpenAI Codex
silly login copilot    # GitHub Copilot
silly login claude     # Claude
```

## Q: 如何切换模型/提供商？

使用不同的启动命令：

```bash
sillyx                 # OpenAI Codex (GPT-5.4)
sillyt                 # GitHub Copilot (GPT-4o)
sillye                 # Claude (claude-opus-4-6)
```
