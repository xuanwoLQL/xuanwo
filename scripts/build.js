// 打包脚本：esbuild 打包 CLI + 复制资源 + SEA 生成 xuanwo.exe
import { execSync } from "node:child_process";
import { cpSync, rmSync, mkdirSync, copyFileSync, existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = join(__dirname, "..");
const dist = join(root, "dist");

function sh(cmd) {
  console.log(`> ${cmd}`);
  execSync(cmd, { cwd: root, stdio: "inherit", shell: true });
}

// 1. esbuild 打包 CLI 为单文件 CJS（keytar external）
sh(
  `npx esbuild packages/cli/src/index.ts --bundle --platform=node --format=cjs --outfile=dist/xuanwo.cjs --external:keytar --alias:@xuanwo/core=./packages/core/src/index.ts --tsconfig=tsconfig.json`
);

// 2. 复制资源目录到 dist/resources（SEA 外置资源）
rmSync(join(dist, "resources"), { recursive: true, force: true });
mkdirSync(join(dist, "resources"), { recursive: true });
cpSync(join(root, "packages", "resources"), join(dist, "resources"), { recursive: true });
console.log("> 资源已复制到 dist/resources");

// 3. 复制 node_modules 中 keytar（native 模块，SEA 无法内嵌）
rmSync(join(dist, "node_modules"), { recursive: true, force: true });
mkdirSync(join(dist, "node_modules"), { recursive: true });
cpSync(join(root, "node_modules", "keytar"), join(dist, "node_modules", "keytar"), { recursive: true });
console.log("> keytar 已复制到 dist/node_modules");

console.log("\n✅ dist 目录就绪：");
console.log(`  - dist/xuanwo.cjs (主程序)`);
console.log(`  - dist/resources/ (智能体/技能/知识库)`);
console.log(`  - dist/node_modules/keytar/ (原生凭据模块)`);
