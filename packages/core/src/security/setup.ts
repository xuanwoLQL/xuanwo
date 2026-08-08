/**
 * 设置向导
 * 首次启动引导：免责声明 → API Key → 默认模型 → 授权目录
 */
import { createInterface } from "node:readline/promises";
import { stdin as input, stdout as output } from "node:process";
import type { Interface as ReadlineInterface } from "node:readline/promises";
import { DISCLAIMER } from "./disclaimer.js";
import { ConfigManager } from "./config.js";
import { CredentialManager } from "./credentials.js";

const PROVIDERS = [
  { id: "deepseek", label: "DeepSeek（默认，deepseek-v4-flash）", defaultModel: "deepseek-v4-flash" },
  { id: "openai", label: "OpenAI（GPT-4o 等）", defaultModel: "gpt-4o" },
  { id: "anthropic", label: "Anthropic（Claude 3.5 Sonnet 等）", defaultModel: "claude-sonnet-4-5" },
  { id: "ollama", label: "本地模型（Ollama / vLLM）", defaultModel: "qwen2.5-coder:7b", needsBaseUrl: true },
];

export interface SetupResult {
  provider: string;
  model: string;
  baseUrl?: string;
  authorizedPaths: string[];
  accepted: boolean;
}

export interface SetupIO {
  rl?: ReadlineInterface;
  stdin?: NodeJS.ReadableStream;
  stdout?: NodeJS.WritableStream;
}

export async function runSetup(io: SetupIO = {}): Promise<SetupResult> {
  const rl =
    io.rl ??
    createInterface({
      input: (io.stdin ?? input) as never,
      output: (io.stdout ?? output) as never,
    });

  const ask = async (q: string, def?: string): Promise<string> => {
    const suffix = def ? ` [${def}]` : "";
    const ans = (await rl.question(`${q}${suffix}: `)).trim();
    return ans === "" && def !== undefined ? def : ans;
  };

  const result: SetupResult = { provider: "", model: "", authorizedPaths: [], accepted: false };

  try {
    // 1. 免责声明
    console.log(DISCLAIMER);
    let confirmed = "";
    while (confirmed.toUpperCase() !== "YES") {
      confirmed = await rl.question("请输入 YES 以确认接受免责声明: ");
      if (confirmed.toUpperCase() !== "YES") {
        console.log("必须输入 YES 才能继续。输入 q 退出。");
        if (confirmed.toLowerCase() === "q") return result;
      }
    }
    result.accepted = true;

    // 2. 选择提供商
    console.log("\n选择 LLM 提供商：");
    PROVIDERS.forEach((p, i) => console.log(`  ${i + 1}. ${p.label}`));
    const pChoice = Number((await ask("输入序号", "1")) || "1");
    const provider = PROVIDERS[pChoice - 1] ?? PROVIDERS[0];
    result.provider = provider.id;

    // 3. API Key（ollama 本地不需要）
    if (!provider.needsBaseUrl) {
      const key = await ask("输入 API Key（将安全存储到系统凭据管理器）");
      if (key) {
        await new CredentialManager().setApiKey(provider.id, key);
        console.log("API Key 已安全存储。");
      } else {
        console.log("警告：未设置 API Key，可使用环境变量 DEEPSEEK_API_KEY 等替代。");
      }
    }

    // 4. 自定义 baseUrl（可选）
    if (provider.needsBaseUrl) {
      result.baseUrl = await ask("输入 Ollama 地址", "http://localhost:11434/v1");
    }

    // 5. 默认模型
    const model = await ask("默认模型", provider.defaultModel);
    result.model = model;

    // 6. 授权目录（可多个，逗号分隔）
    const paths = await ask("授权审计目录（多个用逗号分隔，如 D:/openharmony,E:/src）");
    result.authorizedPaths = paths.split(",").map((s) => s.trim()).filter(Boolean);

    // 保存
    const cfg = new ConfigManager();
    cfg.setAccepted();
    cfg.get().defaultModel = model;
    cfg.get().provider = provider.id;
    if (result.baseUrl) cfg.get().baseUrl = result.baseUrl;
    result.authorizedPaths.forEach((p) => cfg.addAuthorizedPath(p));
    cfg.save();

    console.log("\n✅ 设置完成。配置已保存到 ~/.xuanwo/config.json");
  } finally {
    if (!io.rl) rl.close();
  }
  return result;
}
