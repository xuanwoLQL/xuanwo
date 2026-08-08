// Node.js SEA (Single Executable Application) 打包脚本
// 用法: node scripts/build-sea.js
// 前置: 已在 scripts/sea-test 下 npm install 好依赖
import { execSync } from "node:child_process";
import { rmSync, copyFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const seaDir = join(__dirname, "sea-test");

function sh(cmd) {
  console.log(`> ${cmd}`);
  execSync(cmd, { cwd: seaDir, stdio: "inherit", shell: true });
}

// 1. 打包为单文件 CJS bundle（内嵌 openai 等依赖）
sh(`npx esbuild sea-entry.js --bundle --platform=node --format=cjs --outfile=bundle.cjs --log-level=warning`);

// 2. 生成 SEA blob
sh(`node --experimental-sea-config sea-config.json`);

// 3. 复制 node.exe 作为基底
const nodeBin = execSync("where node", { shell: true }).toString().trim().split("\r\n")[0];
copyFileSync(nodeBin, join(seaDir, "node-copy.exe"));
console.log(`> 基底 node.exe: ${nodeBin}`);

// 4. postject 注入 blob
sh(
  `npx postject node-copy.exe NODE_SEA_BLOB xuanwo-sea.exe --sentinel-fuse NODE_SEA_FUSE_fce680ab2cc467b6e072b8b5df1996b2`
);

// 5. 产出
copyFileSync(join(seaDir, "node-copy.exe"), join(seaDir, "xuanwo-sea-final.exe"));
console.log("\n✅ SEA 打包完成: scripts/sea-test/xuanwo-sea-final.exe");

// 6. 清理中间产物
for (const f of ["bundle.cjs", "node-copy.exe", "xuanwo-sea.exe"]) {
  rmSync(join(seaDir, f), { force: true });
}
