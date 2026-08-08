# xuanwo

OpenHarmony AI 漏洞挖掘命令行工具（基于 OpenCode 架构定制）

> **想体验？** 请看 [docs/experience-guide.md](docs/experience-guide.md)（分发指南 · 三步上手 · 常用命令 · 常见问题）

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

## 第五阶段：TUI + 快捷命令 + 会话持久化（已完成）

### 轻量 TUI（零重型依赖）
- 基于 readline + ANSI 转义，跨平台（含 Windows）可靠
- 状态栏：模式 / 子智能体 / 可疑点计数 / 已分析文件数
- 快捷键：`Ctrl+P` 命令面板、`Ctrl+T` 变体切换、`Tab` 智能体切换、`Esc`
- 启动：`xuanwo tui`

### 快捷命令
| 命令 | 功能 |
|:---|:---|
| `/scan <path>` | 主控智能体扫描源码目录 |
| `/analyze <file>` | 深度分析单个文件（调度子智能体） |
| `/nday` | Nday 学习模式（知识库统计） |
| `/report` | 审计报告 |
| `/knowledge <q>` | RAG 检索知识库 |
| `/session list` | 会话管理 |
| `/status` | 查看状态（模式/知识库/智能体） |

### 会话持久化
- `~/.xuanwo/sessions/*.json`（跨平台 homedir）
- CLI：`xuanwo session list|save|load`、`xuanwo resume <id>`
- 断点续扫：resume 打印上下文（已分析文件/可疑点/分析链），可继续 agent 任务

### 关键技术决策
- **放弃 ink TUI**：依赖 top-level await + react-devtools-core，CJS 打包失败、体积大、Windows 兼容风险 → 改用 readline + ANSI 轻量方案

## 第六阶段：OpenHarmony 专项功能（已完成）

### 0day 自动挖掘引擎（`xuanwo scan <path>`）
1. 收集源码文件（.c/.cpp/.h/.java/.ets 等，跳过 .git/build/node_modules）
2. 快速特征扫描（无 LLM）：napi_get_value_string / memcpy / napi_ref / CheckPermission 等 8 类高风险信号排序
3. 并发深度分析（默认 3 并发）：主控智能体结合知识库模式挖掘
4. 实时进度条 + 汇总报告（Markdown 存 ~/.xuanwo/reports/）

### 其他专项命令
- `xuanwo analyze <file>` — 单文件深度分析（自动调度子智能体）
- `xuanwo report [file]` — 查看/生成审计报告
- `packages/resources/knowledge/high-risk-modules.md` — 高风险模块清单（Top 12，从知识库统计）

### 状态进度追踪
- scan 过程实时进度条（文件数 / 百分比 / 当前文件）
- 高风险文件优先分析

### 关键修复记录
- ReAct 工具循环不收敛 → 增加**工具结果缓存**（同 tool+参数只执行一次）
- moduleOf 基于文件路径而非 location 字符串提取模块
- analyze 提高迭代上限至 15

### 端到端验证（测试源码树）
- TOCTOU 文件 → 主控调度 race-checker，识别权限绕过 + 条件竞争 + 内存泄漏
- 整数溢出 / memcpy 越界 / napi_ref 引用 → 均被正确识别并给出 file:line

## 第七阶段：技能系统（已完成）

### 技能架构
```
packages/resources/skills/
├── napi-audit/SKILL.md     # NAPI 接口审计指南
├── ipc-security/SKILL.md   # 鸿蒙 IPC 通信安全分析
└── token-check/SKILL.md    # Ability Token 鉴权机制检查
```
- 每个技能：YAML frontmatter（id/name/description/tools）+ 审计指南主体
- **工具白名单校验**：加载时校验 `tools` 声明是否在全局白名单（grep/git/read），非法技能拒绝加载
- **SkillExecutor**：技能通过 ToolExecutor 安全接口执行外部命令，双层校验（技能声明 + 全局白名单）

### 技能作为可发现资源
- `SkillRegistry` 将技能注册为可发现资源，摘要注入智能体提示词（`{{AVAILABLE_SKILLS}}`）
- **`load_skill` 工具**：模型运行时按需加载技能详情（审计指南），驱动针对性审计
- CLI：`xuanwo skill list | validate | <skill-id>`

### 端到端验证
- `skill list` → 3 个技能加载，工具声明正确
- `skill validate` → 白名单校验 PASS
- 智能体审计时先 `load_skill napi-audit` 加载指南 → 应用指南识别 argc 未校验等问题

## 第八阶段：MCP Client（已完成）

### MCP 集成
- 官方 SDK `@modelcontextprotocol/sdk`（v1.30）
- `McpClient`：连接本地 stdio server，工具发现 + 调用
- `McpManager`：多 server 连接池，工具收集
- MCP 工具自动注册为 Agent 工具（前缀 `mcp_`），智能体可调用
- 配置：`~/.xuanwo/mcp.json`（servers: name/command/args）
- CLI：`xuanwo mcp list|add|test|use`

### 验证
- `scripts/test-mcp-server.js`：测试 server（file_info/file_head 两个工具，Zod schema）
- `mcp test` → 连接 OK，2 工具
- 智能体调用 `mcp_file_head` 读取文件 → 正确返回内容

### 关键修复记录
- MCP SDK 1.30 的 `inputSchema` 必须用 **Zod schema**（普通 JSON object 抛错）
- MCP server 的 stdio 与 console.log 冲突 → server 端不打印到 stdout

## 第九阶段：打包与分发（已完成）

### SEA 打包
- `npm run package` → esbuild 单文件 + Node SEA + postject 注入 → `dist/xuanwo.exe`（约 90MB，无需安装 Node）
- 资源外置策略：`dist/resources/`（智能体/技能/知识库）+ `dist/node_modules/keytar/`（原生模块）
- 资源路径自动探测：exe 同目录 → 环境变量 → 当前目录（`core/src/resources.ts`）

### 自定义图标
- `scripts/gen-icon.js`：纯 Node 生成盾牌风格 ICO
- rcedit 注入 PE 图标资源（进程 detach 避免阻塞）

### 分发文档
- `docs/user-guide.md`：安装结构、快速上手、授权机制、外部依赖（Semgrep/ArkAnalyzer/HapTest 经 MCP 接入）

### 验证结果
- `xuanwo.exe --version / agent list / knowledge / skill / session / mcp` 全部正常
- exe 内调用真实 LLM（deepseek-v4-flash）成功
- keytar（Windows Vault）与 MCP server 连接在 SEA 中均可用

## OpenCode 风格 TUI 增强（Ink + Bun）

### 技术决策：用 Bun 打包解决 Ink + 单文件 exe 矛盾
- **Node SEA + Ink** ❌ 不可行：CJS 被 yoga-layout 的 top-level await 堵死；ESM 入口在 SEA 中 loader 切换失败
- **Bun compile + Ink** ✅ 可行：`bun build --compile` 生成单文件 exe（118MB，含 React/ink/yoga），知识库/技能/智能体/keytar 全部正常
- 打包命令：`npm run package`（build.js 复制资源 → bun build --compile）

### 对话式 TUI（Ink 实现，OpenCode 风格）
- **启动画面**：彩虹渐变 ASCII Logo（`ui/splash.ts`）+ 版本号，1.2s 后进入对话
- **底部三行状态栏**（`ui/components/StatusBar.tsx`）：
  - 行1: `● 模型 | 智能体 | 会话 | 消息数`
  - 行2: 工具调用进度条（🔧 执行中 / ✅ 完成）
  - 行3: 输入区 + 历史索引
- **消息列表**：用户(AI/工具/错误/系统)不同颜色，代码块边框缩进，支持 PgUp/PgDn 滚动
- **命令面板**：`Ctrl+P` 弹出 10 条命令列表，Esc 关闭
- **快捷键**：`Ctrl+P` 面板、`Ctrl+T` 切换智能体、`PgUp/PgDn` 滚动、`Ctrl+C` 二次确认退出
- **透明背景**：工具不强制背景色，由终端模拟器（Windows Terminal/WezTerm）设置透明度
- **组件结构**：`ui/App.tsx` + `components/` + `hooks/` + `styles/theme.ts`
- 自动路由：TTY 终端用 Ink，管道/无 TTY 自动降级轻量 TUI（`tui --legacy`）

### 关键实现
- `react-devtools-core` stub（ink 可选依赖，Node 环境不可用）
- Ink TUI 组件：`packages/cli/src/ui/` 目录下完整组件树

## 成熟化：借鉴 IVAgent 污点分析引擎（已完成）

### 污点预扫描引擎（`scan/taint.ts`）
- 借鉴 IVAgent 的 `taint_sources` + `dangerous_apis` 机制
- 技能 SKILL.md 结构化声明污点源/危险API/入口点（块状 YAML 列表解析）
- 纯静态扫描：在源码中定位"污点源→危险API"共现路径，零 LLM 调用
- 输出候选 {file, line, source, sink, distance, sameScope}
- scan 流程：污点预扫描命中 → 候选喂给 LLM 深度确认 → 高置信度可疑点

### OpenHarmony 污点技能（`ohos-taint`）
- 移植 IVAgent harmony_entry + arkts_ability_hijack 的污点源：
  - C++ 层：want 参数、IPC ReadString/ReadBuffer、OnRemoteRequest
  - ArkTS 层：router.getParams、want.parameters、AppStorage/PersistentStorage
- 危险汇点：memcpy/strcpy/sprintf、权限校验、startAbility/router.pushUrl

### 代码探索工具（借鉴 IVAgent get_function_def/get_callee）
- `find_function_def`：定位函数定义
- `find_callers`：查找函数调用者
- 支持本地 + WSL 路径

### 关键验证
- 测试文件污点预扫描：`getStringParam → strcpy` 3行距离同作用域命中（零 LLM）
- 端到端 scan：确认 2 个高置信度可疑点（栈溢出 conf=0.95、越界写 conf=0.95）
- 污点规则：napi-audit(4源6汇) + ohos-taint(18源10汇)

### 跨函数污点追踪（`scan/taint-tracer.ts`）
- 借鉴 IVAgent 调用链深度 3-5 层策略
- LLM 驱动逐层分析：识别污点传播 → find_function_def/find_callers 跨函数跳转
- 特性：循环检测、深度限制、污点变量状态追踪、汇点识别
- CLI：`xuanwo trace <file> <func> [--var <污点>] [--sink <汇点>] [--depth <n>]`

### 验证（真实 OpenHarmony 源码）
- 3 层测试链：`handle_external → process_data → final_write(strcpy)` 完整追踪
- **WSL 真实源码**：`CmdSetProcSysNet`（netmanager）IPC 污点 → `/proc/sys/net` 写入汇点，识别真实攻击面
- 与知识库 16 条 netmanager 模式可交叉验证

### 攻击链建模（`attackchain/builder.ts`，借鉴 CyberStrikeAI）
- LLM 从审计结果（可疑点+情报+目标）单次生成**树状攻击链**
- 节点类型：target（目标）/ action（攻击步骤）/ vulnerability（漏洞）
- 因果边：leads-to / discovers / exploits / enables，支持分支汇聚
- risk_score 标注（critical=10 / high=8 / medium=5 / low=2）
- CLI：`xuanwo chain <file> [--module <m>]`，ASCII 可视化 + JSON 保存
- 验证：8 节点 7 边攻击链，从 JS 入口 → 命令注入 + 缓冲区溢出双分支

### ReAct 证据前置强化（借鉴 AutoYara locator_agent）
- 不得在未读取代码前输出 final（证据前置）
- suspiciousPoint 必须带 evidence：codeSnippet / callChain / triggerCondition / severity
- 无代码证据的结论 confidence ≤ 0.5
- 每次只调用一个工具，观察后再决策
- CLI scan/analyze/report 展示调用链与触发条件

### 函数索引 + 受限探索（借鉴 SCOUT function_index）
- tree-sitter 解析 C/C++：函数名/签名/行范围/函数体/文件内调用关系
- 受限探索工具：`view_index`（函数索引）/ `view_function`（函数详情+调用者）
- 解决 19 万文件规模问题——LLM 按函数精确浏览而非整文件读

### 证据门控（借鉴 T3MP3ST gateLiveFinding）
- tool：完整证据（代码片段+调用链+触发条件）→ 置信度保留
- context：部分证据 → 置信度 ×0.6
- none：无证据 → 置信度上限 0.3
- 杜绝"无证据高置信度"的假阳性

### 验证闭环（`scan/verify.ts`）
- 对可疑点生成最小复现程序（LLM）→ WSL gcc `-fsanitize=address` 编译运行
- ASAN 崩溃检测：stack/heap-buffer-overflow / use-after-free / SEGV
- 结果分级：verified（确认漏洞）/ no-crash（可能误报）/ compile-error / skipped
- 已确认漏洞自动保存 PoC 到 `~/.xuanwo/pocs/`
- CLI：`xuanwo verify <file> [--type <类型>]`
- 验证：栈溢出复现捕获 `WRITE of size 49`（stack-buffer-overflow）；安全代码正确判定无可疑点

## 免责声明

本工具仅用于授权的安全测试与研究。使用者必须确认：
1. 已获得目标系统的合法授权
2. 仅对授权范围内系统进行测试
3. 对使用本工具产生的后果负责
