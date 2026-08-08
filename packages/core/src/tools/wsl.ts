/**
 * WSL 路径通道
 * 允许 xuanwo 通过 `wsl:` 前缀访问 WSL 内的 OpenHarmony 源码。
 * Windows 侧无法直接 UNC 访问 WSL 文件系统时，通过 `wsl -e bash -lc` 读写。
 * 支持两种形式：
 * - `wsl:/home/xxx/file.cpp`   WSL 内绝对路径
 * - 本地路径（自动转换为 WSL 路径，如 D:/xuanwo → /mnt/d/xuanwo）
 */
import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { resolve } from "node:path";

const WSL_PREFIX = "wsl:";

export interface WslFile {
  path: string; // WSL 路径
  content: string;
  truncated: boolean;
}

/** 判断是否 WSL 路径 */
export function isWslPath(p: string): boolean {
  const s = p.trim();
  return /^wsl:/i.test(s) || s.startsWith("/home/") || s.startsWith("/mnt/") || s.startsWith("/root/");
}

/** 规范化 WSL 路径 */
export function toWslPath(p: string): string {
  const s = p.trim();
  if (/^wsl:/i.test(s)) return s.replace(/^wsl:/i, "");
  if (s.startsWith("/")) return s; // 已是 WSL 绝对路径
  // Windows 路径 → WSL 路径（D:/xuanwo → /mnt/d/xuanwo）
  const norm = resolve(s).replace(/\\/g, "/");
  const m = norm.match(/^([A-Za-z]):\/(.*)$/);
  if (m) {
    return `/mnt/${m[1].toLowerCase()}/${m[2]}`;
  }
  return norm;
}

/**
 * 在 WSL 中执行命令（spawn 避免 shell 引号/路径转换问题）
 * 用 wsl -e 直接执行，不经 Windows shell。
 */
function wslExec(cmd: string): string {
  const res = spawnSync("wsl.exe", ["-e", "bash", "-lc", cmd], {
    encoding: "utf8",
    maxBuffer: 64 * 1024 * 1024,
  });
  if (res.error) {
    throw new Error(`WSL 命令失败: ${res.error.message.slice(0, 200)}`);
  }
  if (res.status !== 0) {
    throw new Error(`WSL 命令失败(status ${res.status}): ${(res.stderr || "").slice(0, 200)}`);
  }
  return res.stdout ?? "";
}

/** 读取 WSL 文件 */
export function wslReadFile(wslPath: string, maxChars = 20000): WslFile {
  const content = wslExec(`cat ${JSON.stringify(wslPath)}`);
  return {
    path: wslPath,
    content: content.slice(0, maxChars),
    truncated: content.length > maxChars,
  };
}

/** WSL 递归 grep */
export function wslGrep(wslPath: string, pattern: string, include?: string, maxMatches = 50): string[] {
  const inc = include ? `--include="${include}"` : "";
  const out = wslExec(
    `grep -rn ${inc} -E ${JSON.stringify(pattern)} ${JSON.stringify(wslPath)} 2>/dev/null | grep -v Binary | head -${maxMatches}`
  );
  return out.split("\n").filter((l) => l.trim());
}

/** 列出 WSL 目录 */
export function wslLs(dir: string): string[] {
  return wslExec(`ls -1 ${JSON.stringify(dir)} 2>/dev/null`).split("\n").filter((l) => l.trim());
}

/** 检查 WSL 文件/目录是否存在 */
export function wslExists(p: string): boolean {
  try {
    wslExec(`test -e ${JSON.stringify(p)} && echo yes`);
    return true;
  } catch {
    return false;
  }
}

void existsSync; // 保留引用
