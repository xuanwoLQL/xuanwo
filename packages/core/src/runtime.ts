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
import type { AuditContext } from "./agent/audit-context.js";

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

  private constructor(
    llm: LlmClient,
    agents: AgentConfig[],
    toolExecutor: ToolExecutor,
    config: ConfigManager,
    knowledge: KnowledgeBase,
    skills: SkillRegistry,
    skillExecutor: SkillExecutor
  ) {
    this.config = config;
    this.knowledge = knowledge;
    this.skills = skills;
    this.skillExecutor = skillExecutor;
    this.orchestrator = new AgentOrchestrator(llm, agents, createBuiltinTools(toolExecutor, skills));
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

    // 资源路径（支持覆盖）
    const agentsDir = options.agentsDir ?? join(process.cwd(), "packages", "resources", "agents");
    const knowledgeDir = options.knowledgeDir ?? join(process.cwd(), "packages", "resources", "knowledge");
    const skillsDir = options.skillsDir ?? join(process.cwd(), "packages", "resources", "skills");

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
    const templateCtx = {
      DEFAULT_MODEL: cfg.defaultModel || "deepseek-v4-flash",
      KNOWLEDGE_SUMMARY: knowledgeSummary,
      AVAILABLE_SKILLS: skills.summaryText(),
    };

    // 加载智能体
    const agents = [...loadAgentsFromDir(agentsDir, templateCtx).values()];

    return new AgentRuntime(llm, agents, toolExecutor, config, knowledge, skills, skillExecutor);
  }

  runTask(
    task: string,
    context?: Partial<AuditContext>,
    onStep?: (step: import("./agent/orchestrator.js").OrchestratorStep) => void,
    runOptions?: import("./agent/react.js").AgentRunOptions
  ) {
    return this.orchestrator.run(task, context, onStep, runOptions);
  }

  availableAgents(): { id: string; name: string; role: string; description: string }[] {
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
