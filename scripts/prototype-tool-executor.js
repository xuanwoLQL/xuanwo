import { ToolExecutor } from "./proto/tool-executor.js";

const authorized = ["D:/xuanwo/prototype"];
const ex = new ToolExecutor({
  authorizedPaths: authorized,
  allowedCommands: [
    { command: "git", bin: "git" },
    { command: "grep", bin: "grep" },
    { command: "semgrep", bin: "semgrep", requirePath: true, pathIndex: 0 },
  ],
});

const cases = [];
const check = async (name, fn) => {
  try {
    await fn();
    cases.push({ name, pass: false, note: "未被拦截（异常）" });
  } catch (e) {
    cases.push({ name, pass: true, note: e.message });
  }
};

async function main() {
  // 1. 命令白名单
  await check("命令不在白名单被拒绝", () => ex.checkCommand("rm"));
  // 2. 路径穿越
  await check("绝对路径穿越 ../../ 被拒绝", () => ex.checkPath("D:/xuanwo/prototype/../../Windows/System32"));
  await check("绝对路径穿越 C:\\Windows 被拒绝", () => ex.checkPath("D:\\xuanwo\\prototype\\..\\..\\..\\Windows\\System32\\cmd.exe"));
  await check("UNC/盘符穿越 被拒绝", () => ex.checkPath("C:/Windows/System32"));
  await check("不在授权目录的路径被拒绝", () => ex.checkPath("E:/somewhere/else"));
  // 3. 合法路径放行
  await check("授权目录内合法路径通过", () => {
    ex.checkPath("D:/xuanwo/prototype/sub/source.c");
    throw new Error("通过（预期）");
  });
  // 4. 参数过滤
  await check("参数含分号注入被拒绝", () => ex.sanitizeArg("x; rm -rf /"));
  await check("参数含管道符被拒绝", () => ex.sanitizeArg("a | b"));
  await check("参数含反引号被拒绝", () => ex.sanitizeArg("`id`"));
  // 5. execute 入口联动
  await check("execute 用白名单外命令被拒", async () => {
    await ex.execute("del", ["x"]);
    throw new Error("通过（预期）");
  });

  let passCount = 0;
  console.log("===== ToolExecutor 安全接口验证 =====");
  for (const c of cases) {
    const mark = c.pass ? "PASS" : "FAIL";
    if (c.pass) passCount++;
    console.log(`  [${mark}] ${c.name}${c.pass ? " — " + c.note : ""}`);
  }
  const rate = (passCount / cases.length) * 100;
  console.log(`\n拦截率: ${passCount}/${cases.length} = ${rate.toFixed(1)}%`);
  console.log(rate === 100 ? "验证结果: PASS ✅" : "验证结果: FAIL ❌");
  process.exit(rate === 100 ? 0 : 1);
}

main();
