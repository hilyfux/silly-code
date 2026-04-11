# 项目结构

```
bin/
├── silly                # 管理 CLI (status/login/logout/doctor/update)
├── sillyx               # OpenAI Codex 启动器
├── sillyt               # GitHub Copilot 启动器
├── sillye               # Claude 启动器
└── silly-common.sh      # 共享函数 (日志, 构建检查)

pipeline/
├── patch.cjs            # 补丁编排器 (入口)
├── login.mjs            # OAuth 登录流程
├── patches/
│   ├── branding.cjs     # 品牌替换 (URL, 名称, 颜色)
│   ├── provider-engine.cjs  # 提供商系统 (核心)
│   ├── equality.cjs     # 订阅绕过
│   ├── privacy.cjs      # 遥测屏蔽
│   └── providers/
│       ├── _base.cjs    # 共享协议 (mapModel, SSE 流, 消息转换)
│       ├── claude.cjs   # Claude 配置 (默认/回退)
│       ├── openai.cjs   # OpenAI Codex 适配器
│       └── copilot.cjs  # GitHub Copilot 适配器
├── upstream/package/    # 上游二进制 (gitignored)
└── build/               # 补丁输出 (gitignored)

tests/
├── base.test.cjs        # 协议函数单元测试
└── schema.test.cjs      # 提供商 schema 验证

src/                     # v1 源码 (仅供参考, 非运行时)
docs/                    # 文档
skills/                  # 项目技能 (upstream-upgrade)
```

## 运行时流程

```
upstream cli.js → patch.cjs → cli-patched.js → sillyx/sillyt/sillye
```

项目不是源码 fork，而是通过补丁管道修改上游编译后的二进制。
