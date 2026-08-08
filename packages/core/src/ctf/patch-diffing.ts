/**
 * Patch Diffing 引擎（Nday 核心方法论）
 * 
 * 对模块 git 仓库执行：git log v6.0..master → 扫描安全修复 commit
 * 输出候选修复（含 diff），供 hunt 命令定位漏洞。
 * 
 * 方法（从 CTF 解题日志提炼）：
 * 1. git fetch origin/master
 * 2. git log OpenHarmony-v6.0-Release..origin/master 找提交
 * 3. 按关键词筛选疑似安全修复（fix/security/CVE/UAF/overflow/permission...）
 * 4. git show 查看 diff，识别漏洞模式和修复位置
 */
import { spawnSync } from "node:child_process";

export interface FixCommit {
  hash: string;
  shortHash: string;
  message: string;
  date?: string;
  author?: string;
  score: number;
  matchedKeywords: string[];
}

export interface PatchDiffResult {
  module: string;
  totalCommits: number;
  candidates: FixCommit[];
  diffs: Map<string, string>;
}

/** 安全修复关键词 */
const FIX_KEYWORDS = [
  { re: /fix|修复|解决/g, score: 3 },
  { re: /security|安全/g, score: 5 },
  { re: /CVE-\d+/g, score: 8 },
  { re: /UAF|use[\s-]*after[\s-]*free/g, score: 6 },
  { re: /buffer|overflow|越界|溢出/g, score: 6 },
  { re: /permission|权限|bypass/g, score: 5 },
  { re: /race|竞争|TOCTOU/g, score: 5 },
  { re: /out[\s-]*of[\s-]*bounds|OOB/g, score: 6 },
  { re: /integer|整数/g, score: 4 },
  { re: /null|空指针/g, score: 3 },
  { re: /crash|崩溃/g, score: 4 },
  { re: /memory|内存/g, score: 3 },
  { re: /vuln|漏洞/g, score: 6 },
  { re: /invalid|非法/g, score: 2 },
  { re: /leak|泄露/g, score: 4 },
];

/** 在 WSL 中执行 git 命令（spawnSync 直接调 wsl.exe，绕开 Git Bash 路径转换） */
function gitCmd(wslRepo: string, args: string[]): string {
  const cmd = `cd ${JSON.stringify(wslRepo)} && git ${args.join(" ")} 2>&1`;
  const res = spawnSync("wsl.exe", ["-e", "bash", "-lc", cmd], {
    encoding: "utf8",
    maxBuffer: 32 * 1024 * 1024,
  });
  if (res.error) throw res.error;
  return res.stdout ?? "";
}

/**
 * 扫描模块的安全修复提交
 * @param wslRepo 模块 WSL 路径
 * @param baseTag 基准 tag（默认 OpenHarmony-v6.0-Release）
 * @param limit 最多扫描提交数
 */
export function scanSecurityFixes(wslRepo: string, baseTag = "OpenHarmony-v6.0-Release", limit = 150): PatchDiffResult {
  const module = wslRepo.split("/").pop() ?? "unknown";
  const logOut = gitCmd(wslRepo, ["log", "--format=%H%x09%ad%x09%an%x09%s", `--date=short`, `${baseTag}..origin/master`, "-n", String(limit)]);

  const commits: { hash: string; date: string; author: string; subject: string }[] = [];
  for (const line of logOut.split("\n")) {
    const parts = line.split("\t");
    if (parts.length >= 4) {
      commits.push({ hash: parts[0], date: parts[1], author: parts[2], subject: parts.slice(3).join("\t") });
    }
  }

  // 打分筛选安全修复
  const candidates: FixCommit[] = [];
  for (const c of commits) {
    let score = 0;
    const matched: string[] = [];
    const combined = `${c.subject} ${c.author}`;
    for (const { re, score: s } of FIX_KEYWORDS) {
      if (re.test(combined)) {
        score += s;
        matched.push(re.source.slice(0, 20));
      }
    }
    if (score >= 4) {
      candidates.push({
        hash: c.hash,
        shortHash: c.hash.slice(0, 9),
        message: c.subject,
        date: c.date,
        author: c.author,
        score,
        matchedKeywords: matched,
      });
    }
  }
  candidates.sort((a, b) => b.score - a.score);

  return { module, totalCommits: commits.length, candidates, diffs: new Map() };
}

/** 获取 commit 的 diff（支持 merge commit） */
export function getCommitDiff(wslRepo: string, hash: string, maxChars = 6000): string {
  try {
    // 先尝试 git show -p
    const showOut = gitCmd(wslRepo, ["show", hash, "--format=%H %s", "-p", "--no-renames"]);
    // merge commit 的 -p 不输出 diff，用 parent 对比
    const noDiff = showOut.includes("Merge:") && !showOut.includes("diff --git");
    if (!noDiff && showOut.includes("diff --git")) {
      return showOut.slice(0, maxChars);
    }
    // merge：找第一个 parent 做 diff
    const parents = gitCmd(wslRepo, ["rev-parse", `${hash}^1`]).trim();
    if (parents) {
      const diffOut = gitCmd(wslRepo, ["diff", parents, hash, "--no-renames"]);
      if (diffOut.trim()) return diffOut.slice(0, maxChars);
    }
    return showOut.slice(0, maxChars);
  } catch {
    return "";
  }
}

/** 从 diff 中提取被删除的行（漏洞代码特征） */
export function extractRemovedLines(diff: string): string[] {
  const removed: string[] = [];
  for (const line of diff.split("\n")) {
    if (line.startsWith("-") && !line.startsWith("---") && line.trim()) {
      removed.push(line.slice(1).trim());
    }
  }
  return removed.slice(0, 20);
}

/** 格式化修复候选列表 */
export function formatFixCandidates(result: PatchDiffResult, top = 10): string {
  if (result.candidates.length === 0) {
    return `${result.module}: v6.0..master 共 ${result.totalCommits} 提交，未发现明显安全修复`;
  }
  const lines = [`${result.module}: v6.0..master 共 ${result.totalCommits} 提交，识别 ${result.candidates.length} 个疑似安全修复:`];
  result.candidates.slice(0, top).forEach((c, i) => {
    lines.push(`${i + 1}. ${c.shortHash} [score=${c.score}] ${c.message}`);
    lines.push(`   ${c.date} ${c.author} | 关键词: ${c.matchedKeywords.join(",")}`);
  });
  return lines.join("\n");
}
