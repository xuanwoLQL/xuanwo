# xuanwo

OpenHarmony AI 漏洞挖掘命令行工具（基于 OpenCode 架构定制）

## 第零阶段：原型验证结果

| 验证项 | 方法 | 结果 | 通过标准 | 结论 |
|:---|:---|:---|:---|:---|
| 0.1 日志提取链路 | `scripts/extract-knowledge.js` 用 deepseek-v4-flash 解析前 10 个 SESSION | 成功率 100%（10/10），提取 103 条模式，token 约 9.5 万 | ≥80% | ✅ PASS |
| 0.2 SEA 打包 | esbuild 单文件 + Node SEA + postject 注入 | 92MB 自包含 .exe 独立运行成功，openai SDK 正常加载 | .exe 可启动并调用 LLM | ✅ PASS |
| 0.3 ToolExecutor 安全接口 | 白名单 + 路径穿越 + 参数过滤 | 拦截率 100%（10/10） | 拦截非法路径 | ✅ PASS |

### 0.1 关键发现
- **openai v7 只认 `baseURL`（大写），不认 `baseUrl`（小写）**——不显式传入时默认请求 `api.openai.com` 导致超时
- 机械截断前 N tokens 会截到任务描述区；需按关键词（CWE/Accepted/commit/漏洞）权重筛选高价值行
- 模型会输出 `CWE-787: Out-of-bounds Write` 这类非枚举类型，需用 CWE→枚举归一化（`scripts/proto/schema.js`）
- tiktoken 用 gpt-4o 编码计数与 DeepSeek 实际用量基本一致

### 0.3 关键设计
- 命令白名单 + 路径校验（`resolve()` 后前缀匹配）+ 参数 shell 元字符过滤
- 所有外部工具调用必须经 `ToolExecutor.execute()`，禁止直接 `child_process`

## 环境变量

- `DEEPSEEK_API_KEY` — DeepSeek API Key（或复用 `~/.local/share/opencode/auth.json`）
- `XUANWO_EXTRACT_MODEL` — 提取模型（默认 `deepseek-v4-flash`）
- `XUANWO_LOG_PATH` — 日志路径（默认指向原始运行日志）
- `XUANWO_LIMIT_SESSIONS` / `XUANWO_MAX_TOKENS` / `XUANWO_CONCURRENCY` — 提取参数

## 第二阶段：设置向导 + 凭据安全存储（已完成）

### 功能
- `xuanwo setup` — 交互式设置向导：
  - 免责声明全文，必须输入 `YES` 确认（拒绝则退出）
  - 选择 LLM 提供商（DeepSeek / OpenAI / Anthropic / Ollama）
  - API Key 安全存储到系统凭据管理器
  - 默认模型、授权目录配置
- `xuanwo config --accept|--authorize <path>|--check <path>|--show` — 配置管理
- 启动审计命令（如 `scan`）前自动检查免责声明 + 授权目录

### 凭据安全存储（CredentialManager）
- 优先 **keytar**（Windows Credential Vault / macOS Keychain / Linux libsecret）
- keytar 不可用时**自动降级**为 AES-256-GCM 加密文件（密钥绑定机器特征，拷走无法解密）
- 关键结论：keytar 是原生模块，esbuild 需 `--external:keytar`；bundle 内 `require("keytar")` 依赖 node_modules 可解析（bundle 须在项目目录内运行）

### 关键修复记录
- 管道 stdin 下 readline/promises 在 Windows 会中途停止消费 → setup 交互留给真实终端
- keytar 的 try/catch 降级逻辑经探针验证在 bundle 内正确回退

## 第三阶段：智能体核心 + AuditContext 协议（已完成）

### 多智能体协作架构
| 智能体 | 角色 | 职责 |
|:---|:---|:---|
| `openharmony-hunter` | 主控 | 分解任务、ReAct 分析、dispatch 调度子智能体、汇总 |
| `napi-auditor` | 子智能体 | NAPI 接口静态审计 + 数据流追踪 |
| `ipc-analyzer` | 子智能体 | IPC/Binder/RPC 通信安全分析 |
| `race-checker` | 子智能体 | 条件竞争 / TOCTOU 检测 |
| `poc-generator` | 子智能体 | 为确认漏洞生成 PoC |

### 核心实现
- **Agent 配置**：`packages/resources/agents/*.md`，YAML frontmatter + 提示词主体 + `{{KNOWLEDGE_SUMMARY}}` 模板变量
- **ReAct 循环**：`agent/react.ts`，思考→工具→观察→结论，JSON 模式强制结构化输出（final 含 conclusion/dispatch/suspiciousPoints）
- **多智能体编排**：`agent/orchestrator.ts`，主控 final 的 dispatch 指令驱动子智能体执行，结果 mergeContext 汇总
- **AuditContext 协议**：`agent/audit-context.ts`，含 suspiciousPoints 去重（location+type）、analysisStack 决策链、knowledgeMatches
- **内置工具**：`tools/builtin-tools.ts`，read + 纯 JS grep（递归，无外部命令依赖），均经 ToolExecutor.checkPath 授权校验

### 关键修复记录
- Windows 无 `rg` → grep 改为纯 JS 递归实现
- sanitizeArg 拒绝 `|` 会误伤 grep 正则 → grep 不走 shell，改用 JS 实现
- 主控 final 需保留原始 JSON（rawFinal）才能解析 dispatch 调度指令
- 模型偶发输出缺 action 字段 → 防御性校验 + 重试提示

### 端到端验证
- `xuanwo agent napi-auditor "审计 <file>"` → 子智能体直跑 ReAct，正确识别未初始化参数访问、纠正缓冲区溢出误报
- `xuanwo agent openharmony-hunter "全面审计 <file>"` → 主控调度 napi-auditor 子智能体，汇总结构化结论 + suspiciousPoints

## 第四阶段：知识提取 + 渐进式 RAG（已完成）

### 全量知识提取
- `scripts/extract-knowledge.js` 处理全量 35 个 SESSION（原始日志 11.7MB / 18 万行）
- **结果**：提取成功率 100%（35/35），消耗约 39 万 token，生成 **214 条去重模式**
- 成本控制：并发 5 + 每 SESSION 按关键词权重截取高价值行（CWE/Accepted/commit/漏洞），tiktoken 计数
- 增量合并：按稳定 id（modulePath+type+函数链 hash）去重，保留高置信度版本
- 质量标注：平均置信度 0.74，104 条 `needsReview: true` 需人工复核

### 知识库内容分布
| 漏洞类型 | 数量 | 模块 | 数量 |
|:---|:---|:---|:---|
| 缓冲区溢出 | 104 | arkcompiler/ets_runtime | 75 |
| 其他 | 37 | foundation/web | 28 |
| 条件竞争 | 34 | foundation/communication | 26 |
| UAF | 27 | foundation/filemanagement | 19 |
| 权限绕过 | 7 | drivers/peripheral | 18 |
| 整数溢出 | 5 | foundation/multimedia | 17 |

### 渐进式 RAG
- **V1 规则分组**：modulePath 前缀匹配，按目标模块加载对应组（零依赖）
- **V2 全文索引**：minisearch 索引 vulnerabilityType/functionChain/tags/fixDescription，模糊+前缀检索
- **V3 向量检索**：`searchVector()` 预留接口（后续接入 Chroma/LanceDB）
- CLI：`xuanwo knowledge --stats|--list|--search <q> --module <path>`

### 模块路径规范化
- `scripts/normalize-knowledge.js`：仓库名→标准前缀（web_webview→foundation/web/web_webview）
- 文件归属映射（process.cpp→arkcompiler/ets_runtime）、ecmascript→arkcompiler 等
- `scripts/rebuild-knowledge.js`：规范化后重建稳定 id + 去重

## 免责声明

本工具仅用于授权的安全测试与研究。使用者必须确认：
1. 已获得目标系统的合法授权
2. 仅对授权范围内系统进行测试
3. 对使用本工具产生的后果负责
