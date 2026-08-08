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
}

export class AgentRuntime {
  readonly orchestrator: AgentOrchestrator;
  readonly knowledge: KnowledgeBase;
  readonly config: ConfigManager;

  private constructor(
    llm: LlmClient,
    agents: AgentConfig[],
    toolExecutor: ToolExecutor,
    config: ConfigManager,
    knowledge: KnowledgeBase
  ) {
    this.config = config;
    this.knowledge = knowledge;
    this.orchestrator = new AgentOrchestrator(llm, agents, createBuiltinTools(toolExecutor));
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

    // 加载知识库
    const knowledge = new KnowledgeBase(knowledgeDir);
    knowledge.load();

    // 生成模板上下文
    const knowledgeSummary = buildKnowledgeSummary(knowledge.all(), cfg.authorizedTarget ?? "");
    const templateCtx = {
      DEFAULT_MODEL: cfg.defaultModel || "deepseek-v4-flash",
      KNOWLEDGE_SUMMARY: knowledgeSummary,
    };

    // 加载智能体
    const agents = [...loadAgentsFromDir(agentsDir, templateCtx).values()];

    // ToolExecutor（仅授权目录）
    const toolExecutor = new ToolExecutor({
      authorizedPaths: cfg.authorizedPaths,
      allowedCommands: [
        { command: "grep", bin: process.platform === "win32" ? "rg" : "grep" },
        { command: "git", bin: "git" },
        { command: "read", bin: "read" },
      ],
    });

    return new AgentRuntime(llm, agents, toolExecutor, config, knowledge);
  }

  runTask(task: string, context?: Partial<AuditContext>, onStep?: (step: import("./agent/orchestrator.js").OrchestratorStep) => void) {
    return this.orchestrator.run(task, context, onStep);
  }

  availableAgents(): { id: string; name: string; role: string; description: string }[] {
    return this.orchestrator.listAgents();
  }
}
