// SEA 打包验证空壳：验证可执行文件启动 + openai SDK 正常加载
import OpenAI from "openai";

console.log("[sea-test] xuanwo SEA 打包验证启动");
console.log("[sea-test] node:", process.version);
console.log("[sea-test] SEA 检测:", typeof process.getBuiltinModule === "function" ? "getBuiltinModule 可用" : "不可用");

// 验证 openai SDK 能被 SEA 加载
const client = new OpenAI({ apiKey: "test-key-for-load-check", baseURL: "https://api.deepseek.com" });
console.log("[sea-test] openai SDK 加载成功, 版本类可用:", typeof client.chat.completions.create === "function");

// 验证 ES 模块 / 内置模块
console.log("[sea-test] __dirname:", typeof __dirname === "undefined" ? "N/A (ESM)" : __dirname);
console.log("[sea-test] sea 打包验证通过");
