/**
 * AgentRuntime：组装 LLM + 知识库 + 工具 + 编排器的运行时
 * CLI 通过它执行 agent 任务。
 */
import { join } from "node:path";
import { homedir } from "node:os";
import { readFileSync } from "node:fs";
import type { LlmConfig, LlmClient } from "./llm/client.js";
import { createLlmClient } from "./llm/client.js";
import type { AgentConfig } from "./agent/config.js";
import { loadAgentsFromDir } from "./agent/config.js";
import { AgentOrchestrator } from "./agent/orchestrator.js";
import { createBuiltinTools } from "./tools/builtin-tools.js";
import { ToolExecutor } from "./tools/ToolExecutor.js";
import { KnowledgeBase } from "./knowledge/knowledge.js";
import { buildKnowledgeSummary } from "./knowledge/summary.js";
import { ConfigManager } from "./security/config.js";
import { CredentialManager } from "./security/credentials.js";
import { SessionManager } from "./session/session.js";
import { loadSkillsFromDir, type SkillConfig } from "./skills/loader.js";
import { SkillRegistry } from "./skills/registry.js";
import { SkillExecutor } from "./skills/executor.js";
import { McpManager } from "./mcp/client.js";
import { loadMcpConfig } from "./mcp/config.js";
import { resolveResourcePaths } from "./resources.js";
import { TaintTracer } from "./scan/taint-tracer.js";
import { buildAttackChain } from "./attackchain/builder.js";
import { createEmptyContext, type AuditContext } from "./agent/audit-context.js";

/**
 * 解析 API Key：优先级
 * 1. keytar 系统凭据（setup 向导存储）
 * 2. 环境变量 <PROVIDER>_API_KEY
 * 3. opencode auth.json（DeepSeek 等）
 */
async function resolveApiKey(provider: string): Promise<string | undefined> {
  const cred = new CredentialManager();
  const fromVault = await cred.getApiKey(provider);
  if (fromVault) return fromVault;

  const fromEnv = process.env[`${provider.toUpperCase()}_API_KEY`];
  if (fromEnv) return fromEnv;

  try {
    const authPath = join(homedir(), ".local", "share", "opencode", "auth.json");
    const auth = JSON.parse(readFileSync(authPath, "utf8"));
    if (auth[provider]?.key) return auth[provider].key;
    if (provider === "openai" && auth.openai?.key) return auth.openai.key;
  } catch {
    /* fallthrough */
  }
  return undefined;
}

export interface RuntimeResources {
  knowledgeDir: string;
  agentsDir: string;
  skillsDir: string;
}

export class AgentRuntime {
  readonly orchestrator: AgentOrchestrator;
  readonly knowledge: KnowledgeBase;
  readonly config: ConfigManager;
  readonly skills: SkillRegistry;
  readonly skillExecutor: SkillExecutor;
  readonly mcpManager: McpManager | null;
  private readonly llm: LlmClient;

  private constructor(
    llm: LlmClient,
    agents: AgentConfig[],
    toolExecutor: ToolExecutor,
    config: ConfigManager,
    knowledge: KnowledgeBase,
    skills: SkillRegistry,
    skillExecutor: SkillExecutor,
    mcpManager: McpManager | null
  ) {
    this.config = config;
    this.knowledge = knowledge;
    this.skills = skills;
    this.skillExecutor = skillExecutor;
    this.mcpManager = mcpManager;
    this.llm = llm;
    const builtinTools = createBuiltinTools(
      toolExecutor,
      skills,
      {
        getContext: () => createEmptyContext(),
        setContext: () => {},
      }
    );
    this.orchestrator = new AgentOrchestrator(llm, agents, builtinTools);
    // 注册 MCP 工具
    if (mcpManager) {
      for (const t of mcpManager.allTools()) {
        this.orchestrator.addTool(t);
      }
    }
  }

  static async create(options: Partial<RuntimeResources> = {}): Promise<AgentRuntime> {
    const home = homedir();
    const config = new ConfigManager();
    const cfg = config.get();

    // 解析 LLM 配置
    const provider = (cfg.provider ?? "deepseek") as LlmConfig["provider"];
    const apiKey = await resolveApiKey(provider);
    const llmConfig: LlmConfig = {
      provider,
      apiKey: apiKey ?? undefined,
      baseURL: cfg.baseUrl,
      model: cfg.defaultModel || "deepseek-v4-flash",
    };
    const llm = createLlmClient(llmConfig);

    // 资源路径（支持覆盖 + 自动探测）
    const res = resolveResourcePaths();
    const agentsDir = options.agentsDir ?? res.agentsDir;
    const knowledgeDir = options.knowledgeDir ?? res.knowledgeDir;
    const skillsDir = options.skillsDir ?? res.skillsDir;

    // 加载知识库
    const knowledge = new KnowledgeBase(knowledgeDir);
    knowledge.load();

    // 加载技能（工具白名单 = ToolExecutor 命令 + 内置 read）
    const toolExecutor = new ToolExecutor({
      authorizedPaths: cfg.authorizedPaths,
      allowedCommands: [
        { command: "grep", bin: process.platform === "win32" ? "rg" : "grep" },
        { command: "git", bin: "git" },
        { command: "read", bin: "read" },
      ],
    });
    const allowedTools = new Set<string>(["grep", "git", "read"]);
    const skillLoad = loadSkillsFromDir(skillsDir, { DEFAULT_MODEL: cfg.defaultModel || "deepseek-v4-flash", KNOWLEDGE_SUMMARY: "" }, allowedTools);
    const skills = new SkillRegistry(skillLoad.skills, skillLoad.rejected);
    const skillExecutor = new SkillExecutor(toolExecutor, allowedTools);

    // 生成模板上下文（含技能摘要，作为可发现资源）
    const knowledgeSummary = buildKnowledgeSummary(knowledge.all(), cfg.authorizedTarget ?? "");
    const baseCtx = {
      DEFAULT_MODEL: cfg.defaultModel || "deepseek-v4-flash",
      KNOWLEDGE_SUMMARY: knowledgeSummary,
      AVAILABLE_SKILLS: skills.summaryText(),
      SKILL_CONTENT: skills.fullContentText(8000),
    };

    // 加载智能体（第一遍：基础 ctx）
    let agents = [...loadAgentsFromDir(agentsDir, baseCtx).values()];

    // 第二遍：注入 SUBAGENT_ROSTER（各子智能体 whenToUse 调度依据）后重载
    const roster = agents
      .filter((a) => a.id !== "openharmony-hunter")
      .map((a) => `- ${a.id}: ${a.description}${a.whenToUse ? ` 何时使用: ${a.whenToUse}` : ""}`)
      .join("\n");
    const fullCtx = { ...baseCtx, SUBAGENT_ROSTER: roster };
    agents = [...loadAgentsFromDir(agentsDir, fullCtx).values()];

    // 连接 MCP servers（可选，失败不阻塞）
    let mcpManager: McpManager | null = null;
    const mcpServers = loadMcpConfig();
    if (mcpServers.length > 0) {
      mcpManager = new McpManager(mcpServers);
      try {
        await mcpManager.connectAll();
      } catch {
        /* 忽略单个 MCP 连接失败 */
      }
    }

    return new AgentRuntime(llm, agents, toolExecutor, config, knowledge, skills, skillExecutor, mcpManager);
  }

  runTask(
    task: string,
    context?: Partial<AuditContext>,
    onStep?: (step: import("./agent/orchestrator.js").OrchestratorStep) => void,
    runOptions?: import("./agent/react.js").AgentRunOptions
  ) {
    return this.orchestrator.run(task, context, onStep, runOptions);
  }

  /** 跨函数污点追踪（借鉴 IVAgent 调用链深度 3-5 层） */
  traceTaint(
    startFunction: string,
    startFile: string,
    taintedVars: string[],
    sinkHint?: string,
    options?: import("./scan/taint-tracer.js").TaintTracerOptions
  ) {
    const tracer = new TaintTracer(this.llm, this.orchestrator.getTools(), options);
    return tracer.trace(startFunction, startFile, taintedVars, sinkHint);
  }

  /** 从审计结果构建攻击链（借鉴 CyberStrikeAI attackchain） */
  buildChain(input: import("./attackchain/builder.js").ChainBuildInput) {
    return buildAttackChain(this.llm, input);
  }

  availableAgents(): { id: string; name: string; role: string; description: string; whenToUse?: string }[] {
    return this.orchestrator.listAgents();
  }

  private sessionMgr = new SessionManager();

  sessionList() {
    return this.sessionMgr.list();
  }

  createSession(title: string, agentId: string) {
    return this.sessionMgr.create(title, agentId);
  }
}
