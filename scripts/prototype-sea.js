// 验证 0.2：SEA 打包原型验证入口
// 用法: node scripts/prototype-sea.js
// 执行 build-sea.js 全流程后运行 .exe 验证启动 + openai SDK 加载
import { execSync } from "node:child_process";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { existsSync } from "node:fs";

const __dirname = dirname(fileURLToPath(import.meta.url));

async function main() {
  console.log("===== 验证 0.2: SEA 打包 =====");
  console.log("步骤1: 执行完整打包流程...\n");
  execSync(`node "${join(__dirname, "build-sea.js")}"`, { stdio: "inherit", shell: true });

  const exe = join(__dirname, "sea-test", "xuanwo-sea-final.exe");
  if (!existsSync(exe)) {
    console.error("❌ .exe 未生成");
    process.exit(1);
  }

  console.log("\n步骤2: 运行 .exe 验证启动 + openai SDK 加载...\n");
  const out = execSync(`"${exe}"`, { encoding: "utf8", shell: true });
  console.log(out);

  const ok = out.includes("sea 打包验证通过") && out.includes("openai SDK 加载成功");
  console.log(ok ? "\n验证结果: PASS ✅" : "\n验证结果: FAIL ❌");
  process.exit(ok ? 0 : 1);
}

main().catch((e) => {
  console.error("验证失败:", e.message);
  process.exit(1);
});
