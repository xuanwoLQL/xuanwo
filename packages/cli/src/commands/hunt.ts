/**
 * 竞赛 hunt 命令：Nday 自动挖洞
 * xuanwo hunt <模块WSL路径> --module <名>
 * 
 * 流程：
 * 1. Patch Diffing 扫描安全修复 commit
 * 2. 对高置信度修复：读取 diff，分析漏洞位置（L1 file:line）
 * 3. 提取 commit hash（L2）
 * 4. 判定 CWE（L3）
 * 5. 可选：提交到平台
 */
import { AgentRuntime, scanSecurityFixes, getCommitDiff, extractRemovedLines, formatFixCandidates } from "@xuanwo/core";
import { spawnSync } from "node:child_process";

function wslGit(repo: string, args: string[]): string {
  const cmd = `cd ${JSON.stringify(repo)} && git ${args.join(" ")} 2>&1`;
  const res = spawnSync("wsl.exe", ["-e", "bash", "-lc", cmd], { encoding: "utf8", maxBuffer: 32 * 1024 * 1024 });
  if (res.error) throw res.error;
  return res.stdout ?? "";
}

/** 还原被 MSYS 转换的 WSL 路径（C:/Program Files/Git/home/xuanwo → /home/xuanwo） */
function restoreWslPath(p: string): string {
  const markers = [
    { win: "C:/Program Files/Git/", fix: "" },
    { win: "C:\\Program Files\\Git\\", fix: "" },
  ];
  let out = p;
  for (const m of markers) {
    if (out.startsWith(m.win)) {
      out = out.slice(m.win.length);
      break;
    }
  }
  return out.startsWith("/") ? out : "/" + out.replace(/\\/g, "/").replace(/^\/+/, "");
}

/** 从 diff 定位漏洞文件 */
function vulnFileFromDiff(diff: string): string | null {
  const m = diff.match(/diff --git a\/([^\s]+) b\//);
  return m ? m[1] : null;
}

/** 从 diff 提取漏洞行号（被删除行的行号） */
function vulnLineFromDiff(diff: string): number | null {
  const hunk = diff.match(/@@ -(\d+),?\d* \+(\d+),?\d* @@/);
  return hunk ? Number(hunk[1]) : null;
}

/** 用 LLM 分析 diff 判定漏洞类型和 CWE */
async function analyzeDiff(runtime: AgentRuntime, diff: string, module: string, commitHash: string): Promise<{
  vulnType: string;
  cwe: string;
  file: string;
  line: number | null;
  description: string;
}> {
  const task = `分析以下 OpenHarmony ${module} 模块的安全修复 diff（commit ${commitHash}），回答：
1. 修复了什么漏洞（vulnerabilityType: UAF/缓冲区溢出/权限绕过/条件竞争/整数溢出/其他）
2. 对应 CWE 编号（如 CWE-787）
3. 漏洞所在文件路径（源码根相对路径，如 foundation/xxx/...）
4. 漏洞代码大致行号（被删除/修改的关键行）
5. 漏洞描述（修复前后差异）

diff:
${diff.slice(0, 6000)}`;

  const { conclusion } = await runtime.runAgent("coder", task, {}, (step) => {
    if (step.type === "tool") process.stdout.write(`  🛠 ${step.agentId}: ${String(step.content).slice(0, 50)}...\n`);
  });

  // 解析结论（宽松提取关键字段）
  const cweMatch = conclusion.match(/CWE-\d+/);
  const typeMatch = conclusion.match(/(UAF|缓冲区溢出|权限绕过|条件竞争|整数溢出)/);
  return {
    vulnType: typeMatch?.[1] ?? "其他",
    cwe: cweMatch?.[0] ?? "CWE-OTHER",
    file: vulnFileFromDiff(diff) ?? "",
    line: vulnLineFromDiff(diff),
    description: conclusion.slice(0, 400),
  };
}

export async function runHuntCommand(rawRepo: string, opts: { module?: string; submit?: boolean; top?: string }) {
  const runtime = await AgentRuntime.create();
  const wslRepo = restoreWslPath(rawRepo);
  const module = opts.module ?? wslRepo.split("/").pop() ?? "unknown";
  const top = opts.top ? Number(opts.top) : 5;

  console.log(`🎯 Nday 挖洞: ${module}`);
  console.log(`仓库: ${wslRepo}\n`);

  // 1. Patch Diffing
  console.log("阶段1: 扫描安全修复提交...");
  const fixes = scanSecurityFixes(wslRepo);
  console.log(formatFixCandidates(fixes, 10));

  const candidates = fixes.candidates.slice(0, top);
  if (candidates.length === 0) {
    console.log("\n未发现疑似安全修复。");
    return;
  }

  // 2. 分析每个候选
  console.log(`\n阶段2: 分析 ${candidates.length} 个候选修复...`);
  const results: { commit: string; file: string; line: number | null; vulnType: string; cwe: string; description: string }[] = [];

  for (const c of candidates) {
    console.log(`\n--- 分析 ${c.shortHash} ${c.message.slice(0, 40)} ---`);
    const diff = getCommitDiff(wslRepo, c.hash);
    if (!diff) {
      console.log("  diff 为空，跳过");
      continue;
    }
    const analysis = await analyzeDiff(runtime, diff, module, c.hash);
    results.push({ commit: c.hash, ...analysis });
    console.log(`  类型: ${analysis.vulnType}`);
    console.log(`  CWE: ${analysis.cwe}`);
    console.log(`  文件: ${analysis.file}${analysis.line ? `:${analysis.line}` : ""}`);
  }

  // 3. 输出结果
  console.log("\n===== 挖洞结果 =====");
  results.forEach((r, i) => {
    console.log(`\n${i + 1}. [${r.vulnType}] ${r.cwe}`);
    console.log(`   L1: ${r.file}${r.line ? `:${r.line}` : ""}`);
    console.log(`   L2: ${r.commit}`);
    console.log(`   ${r.description.slice(0, 200)}`);
  });

  // 4. 安全智能提交（防爆破规则：只提交有 diff 依据的最高置信度候选，且单次）
  if (opts.submit) {
    await safeSubmit(runtime, results, wslRepo, module);
  }
}

/**
 * 安全提交（遵守防爆破规则）
 * 1. 只提交能解释漏洞语义的候选（有 file+line+type 依据）
 * 2. 提交前 challenge 查状态（冷却/封禁/锁定）
 * 3. 只提交 1 次，不枚举行号
 */
async function safeSubmit(
  runtime: AgentRuntime,
  results: { commit: string; file: string; line: number | null; vulnType: string; cwe: string; description: string }[],
  wslRepo: string,
  module: string
): Promise<void> {
  const { getChallenge, checkSubmitSafety, submit, contestConfig } = await import("@xuanwo/core");
  const cfg = contestConfig();
  if (!cfg.username || !cfg.password) {
    console.log("\n⚠️  未设置 HARMONY_CTF_USERNAME/PASSWORD，跳过提交（先设置环境变量）。");
    return;
  }

  // 选出有完整依据的候选（file + line + 非"其他"类型）
  const strong = results.filter((r) => r.file && r.line && r.vulnType !== "其他");
  if (strong.length === 0) {
    console.log("\n⚠️  没有高置信度候选（需要 file+line+明确类型），不提交以避免爆破风险。");
    return;
  }
  const best = strong[0];
  const gameId = 2;
  const challengeId = Number(process.env.HARMONY_CTF_CHALLENGE_ID || "0");

  if (!challengeId) {
    console.log("\n⚠️  需要 HARMONY_CTF_CHALLENGE_ID 指定题目编号才能提交。");
    console.log(`   本次最佳候选: ${best.file}:${best.line} [${best.vulnType}] ${best.cwe}`);
    console.log(`   L2: ${best.commit}`);
    return;
  }

  // 提交前检查状态
  console.log(`\n提交前检查题目 ${challengeId} 状态...`);
  const c = await getChallenge(gameId, challengeId);
  if (!c) {
    console.log("❌ 无法获取题目状态，跳过提交。");
    return;
  }
  const safety = checkSubmitSafety(c);
  if (!safety.canSubmit) {
    console.log(`❌ 禁止提交: ${safety.reason}`);
    return;
  }
  console.log(`✅ 状态安全（attempts=${c.attempts ?? 0}）`);

  // 单次提交 L1
  const answer = `${best.file}:${best.line}`;
  console.log(`\n提交 L1: ${answer}`);
  const r = await submit(gameId, challengeId, 1, answer);
  if (r.ok) {
    console.log(`✅ Accepted! trackId=${r.activeTrackId ?? "?"}`);
    if (best.cwe !== "CWE-OTHER") {
      console.log(`   可继续提交 L2: ${best.commit}`);
      console.log(`   可继续提交 L3: ${best.cwe}`);
    }
  } else {
    console.log(`❌ 提交失败: ${r.raw ?? ""}`);
    console.log("   遵守防爆破规则：不连续重试，请人工分析候选是否准确。");
  }
}
