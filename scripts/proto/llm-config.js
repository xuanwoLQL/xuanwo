import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

export function resolveConfig() {
  const envKey = process.env.DEEPSEEK_API_KEY;
  const model = process.env.XUANWO_EXTRACT_MODEL || "deepseek-v4-flash";
  if (envKey) {
    return { apiKey: envKey, baseUrl: "https://api.deepseek.com", model };
  }
  const authPath = join(homedir(), ".local", "share", "opencode", "auth.json");
  try {
    const auth = JSON.parse(readFileSync(authPath, "utf8"));
    if (auth.deepseek?.key) {
      return { apiKey: auth.deepseek.key, baseUrl: "https://api.deepseek.com", model };
    }
  } catch {
    /* fallthrough */
  }
  throw new Error(
    "未找到 DeepSeek API Key。请设置环境变量 DEEPSEEK_API_KEY，或确认 opencode auth.json 存在。"
  );
}
