// 打包脚本：Bun 打包 CLI 为单文件 exe + 复制资源（Ink TUI 需 ESM/yoga，Bun compile 是唯一可靠路径）
import { execSync } from "node:child_process";
import { cpSync, rmSync, mkdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = join(__dirname, "..");
const dist = join(root, "dist");

function sh(cmd) {
  console.log(`> ${cmd}`);
  execSync(cmd, { cwd: root, stdio: "inherit", shell: true });
}

// 0. 恢复 react-devtools-core stub（ink 可选依赖，Node 环境不可用，npm install 可能覆盖）
mkdirSync(join(root, "node_modules", "react-devtools-core"), { recursive: true });
cpSync(join(root, "scripts", "stubs", "react-devtools-core"), join(root, "node_modules", "react-devtools-core"), { recursive: true });
console.log("> react-devtools-core stub 已就绪");

// 1. Bun 打包 CLI 为单文件 exe（含 Ink/react/yoga 全依赖内嵌）
sh(
  `bun build packages/cli/src/index.ts --compile --outfile dist/xuanwo.exe --tsconfig=tsconfig.json`
);

// 2. 复制资源目录到 dist/resources（exe 同目录外置资源）
rmSync(join(dist, "resources"), { recursive: true, force: true });
mkdirSync(join(dist, "resources"), { recursive: true });
cpSync(join(root, "packages", "resources"), join(dist, "resources"), { recursive: true });
console.log("> 资源已复制到 dist/resources");

console.log("\n✅ dist 目录就绪：");
console.log(`  - dist/xuanwo.exe (主程序，含 Ink TUI)`);
console.log(`  - dist/resources/ (智能体/技能/知识库)`);
