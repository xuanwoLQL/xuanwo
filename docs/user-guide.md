# xuanwo 使用文档

OpenHarmony AI 漏洞挖掘命令行工具

## 一、安装与分发

### 分发包结构
`xuanwo.exe` 是独立可执行文件（Node.js SEA 打包，约 90MB），分发时需附带：

```
xuanwo/
├── xuanwo.exe              # 主程序（SEA，无需安装 Node.js）
├── resources/              # 智能体配置、技能、知识库（外置）
│   ├── agents/             # 5 个智能体 (.md)
│   ├── skills/             # 3 个技能 (SKILL.md)
│   └── knowledge/          # nday-patterns.json (214 条) + 高风险模块清单
└── node_modules/
    └── keytar/             # 原生凭据模块（Windows Credential Vault）
```

### 使用方式
- 直接双击 `xuanwo.exe` 启动 TUI，或在命令行运行 `xuanwo.exe <command>`
- 资源目录自动探测：exe 同目录 `resources/` → 环境变量 `XUANWO_RESOURCES_DIR` → 当前目录 `packages/resources/`

## 二、快速上手

### 首次配置
```
xuanwo.exe setup
```
1. 阅读免责声明，输入 `YES`
2. 选择 LLM 提供商（DeepSeek 默认）
3. 输入 API Key（存入 Windows Credential Vault）
4. 配置默认模型与授权目录

### 常用命令
| 命令 | 说明 |
|:---|:---|
| `xuanwo.exe tui` | 交互式界面（/scan /analyze /knowledge 等） |
| `xuanwo.exe setup` | 设置向导 |
| `xuanwo.exe scan <path>` | 0day 源码扫描 |
| `xuanwo.exe analyze <file>` | 单文件深度分析 |
| `xuanwo.exe agent <id> <task>` | 运行指定智能体 |
| `xuanwo.exe knowledge --search <q>` | RAG 检索知识库 |
| `xuanwo.exe skill list` | 技能列表 |
| `xuanwo.exe mcp test` | 测试 MCP 连接 |
| `xuanwo.exe session list` | 会话管理 |
| `xuanwo.exe report` | 查看审计报告 |

## 三、授权机制（合规要求）

- 所有审计路径必须在授权列表内（`xuanwo.exe config --authorize <path>`）
- 环境变量 `XUANWO_AUTHORIZED_TARGET` 也可指定授权目标
- 未授权路径会被 ToolExecutor 拒绝执行
- 所有外部工具调用经过白名单 + 路径校验 + 参数过滤

## 四、外部依赖（可选）

| 工具 | 用途 | 说明 |
|:---|:---|:---|
| Semgrep | 静态分析 | 通过 MCP 接入（`~/.xuanwo/mcp.json`） |
| ArkAnalyzer | ArkTS 静态分析 | 通过 MCP 接入 |
| HapTest | 动态模糊测试 | 通过 MCP 接入 |

MCP 配置示例（`~/.xuanwo/mcp.json`）：
```json
{
  "servers": [
    { "name": "semgrep", "command": "semgrep", "args": ["mcp"] }
  ]
}
```

## 五、自定义

- 智能体提示词：编辑 `resources/agents/*.md`
- 技能指南：编辑 `resources/skills/*/SKILL.md`
- 知识库：`resources/knowledge/nday-patterns.json`（可用 `scripts/extract-knowledge.js` 从日志重新提取）
- API Key 也可通过环境变量 `<PROVIDER>_API_KEY` 或 opencode auth.json 提供

## 六、安全声明

本工具仅用于授权的安全测试与研究。使用者必须确认已获授权，仅对授权范围内系统测试，并对后果负责。所有 AI 生成的结论与 PoC 需人工复核。
