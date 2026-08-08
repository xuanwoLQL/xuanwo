// 正式 SEA 打包：将 dist/xuanwo.cjs 注入 node.exe 生成 xuanwo.exe
import { execSync, spawn } from "node:child_process";
import { copyFileSync, rmSync, writeFileSync, existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = join(__dirname, "..");
const dist = join(root, "dist");

function sh(cmd, cwd = root) {
  console.log(`> ${cmd}`);
  execSync(cmd, { cwd, stdio: "inherit", shell: true });
}

// 1. 前置：确保已执行 scripts/build.js 生成 dist/xuanwo.cjs
if (!existsSync(join(dist, "xuanwo.cjs"))) {
  console.error("缺少 dist/xuanwo.cjs，请先运行: node scripts/build.js");
  process.exit(1);
}

// 2. SEA 配置
const seaConfig = {
  main: join(dist, "xuanwo.cjs"),
  output: join(dist, "xuanwo-sea.exe"),
  disableExperimentalSEAWarning: true,
  useSnapshot: false,
  useCodeCache: true,
};
writeFileSync(join(dist, "sea-config.json"), JSON.stringify(seaConfig, null, 2));
sh(`node --experimental-sea-config sea-config.json`, dist);

// 3. 复制 node.exe 基底 + postject 注入
const nodeBin = execSync("where node", { shell: true }).toString().trim().split("\r\n")[0];
const base = join(dist, "node-copy.exe");
copyFileSync(nodeBin, base);
sh(`npx postject node-copy.exe NODE_SEA_BLOB xuanwo-sea.exe --sentinel-fuse NODE_SEA_FUSE_fce680ab2cc467b6e072b8b5df1996b2`, dist);

// 4. 产出
const finalExe = join(dist, "xuanwo.exe");
copyFileSync(base, finalExe);

// 5. 自定义图标（rcedit）
const icoPath = join(dist, "xuanwo.ico");
if (!existsSync(icoPath)) {
  sh(`node scripts/gen-icon.js`);
}
const rceditBin = join(root, "node_modules", "rcedit", "bin", "rcedit-x64.exe");
try {
  // rcedit 不退出进程，用 detach + 短等待
  const child = spawn(rceditBin, [finalExe, "--set-icon", icoPath], { detached: true, stdio: "ignore" });
  child.unref();
  await new Promise((r) => setTimeout(r, 5000));
  console.log("> 图标已注入 (rcedit)");
} catch (e) {
  console.log("> 图标注入跳过:", e.message);
}

// 6. 清理中间产物
for (const f of ["node-copy.exe", "xuanwo-sea.exe", "sea-config.json"]) {
  rmSync(join(dist, f), { force: true });
}

console.log(`\n✅ xuanwo.exe 已生成: ${finalExe}`);
console.log("分发需附带: dist/resources/ 与 dist/node_modules/keytar/");
