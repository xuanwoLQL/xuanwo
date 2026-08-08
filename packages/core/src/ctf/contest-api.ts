/**
 * HarmonyCTF 平台 API 客户端
 * 基于 contest_api.py 接口还原（清华 HarmonyCTF 平台）
 * 
 * 接口：
 * - login: 登录获取 cookie
 * - whoami: 当前用户
 * - game: 赛事信息
 * - details: 赛事详情
 * - challenge: 题目详情（含 flags/trackId 状态）
 * - submit: 提交答案（L1 位置 / L2 commit / L3 CWE）
 * - status: 战报
 * 
 * 认证：环境变量 HARMONY_CTF_USERNAME / HARMONY_CTF_PASSWORD
 * Base URL: HARMONY_CTF_BASE_URL 或默认 https://thuctf.tsinghua.edu.cn/harmonyctf/
 */
import { existsSync, readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

const DEFAULT_BASE = "https://thuctf.tsinghua.edu.cn/harmonyctf/";
const COOKIE_FILE = join(homedir(), ".cache", "harmony_ctf_platform", "agent.cookies");

export interface ContestConfig {
  baseUrl: string;
  username?: string;
  password?: string;
  cookieFile: string;
}

export function contestConfig(): ContestConfig {
  return {
    baseUrl: process.env.HARMONY_CTF_BASE_URL || DEFAULT_BASE,
    username: process.env.HARMONY_CTF_USERNAME,
    password: process.env.HARMONY_CTF_PASSWORD,
    cookieFile: process.env.HARMONY_CTF_COOKIE_JAR || COOKIE_FILE,
  };
}

export interface ChallengeInfo {
  id: number;
  title?: string;
  category?: string;
  points?: number;
  activeTrackId?: string | null;
  attempts?: number;
  bannedLevel?: number | null;
  bannedTrackId?: string | null;
  isLocked?: boolean;
  level?: number;
  allEnabledFlagsSolved?: boolean;
  flags?: unknown;
  content?: string;
  repository?: string;
  cooldown?: unknown;
  tracks?: unknown;
}

interface ApiResponse {
  ok: boolean;
  status: number;
  data: unknown;
  text: string;
}

/** 读取 cookie（Netscape 格式）为请求头 */
function readCookie(): string | null {
  if (!existsSync(COOKIE_FILE)) return null;
  try {
    const content = readFileSync(COOKIE_FILE, "utf8");
    // Netscape cookie 文件格式：取所有 session 行
    const cookies: string[] = [];
    for (const line of content.split("\n")) {
      if (line.startsWith("#") || !line.trim()) continue;
      const parts = line.trim().split("\t");
      if (parts.length >= 7) {
        const name = parts[5];
        const value = parts[6];
        if (name && value) cookies.push(`${name}=${value}`);
      }
    }
    return cookies.length ? cookies.join("; ") : null;
  } catch {
    return null;
  }
}

async function apiRequest(
  method: string,
  path: string,
  body?: unknown,
  cfg: ContestConfig = contestConfig()
): Promise<ApiResponse> {
  const url = cfg.baseUrl.replace(/\/+$/, "") + path;
  const cookie = readCookie();
  const headers: Record<string, string> = {
    Accept: "application/json",
    "Content-Type": "application/json",
  };
  if (cookie) headers.Cookie = cookie;

  const resp = await fetch(url, {
    method,
    headers,
    body: body !== undefined ? JSON.stringify(body) : undefined,
    redirect: "manual",
  });

  const text = await resp.text();
  let data: unknown = null;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    data = null;
  }
  return { ok: resp.ok, status: resp.status, data, text };
}

/** 登录：获取 cookie */
export async function login(username?: string, password?: string): Promise<{ ok: boolean; message: string }> {
  const cfg = contestConfig();
  const user = username || cfg.username;
  const pass = password || cfg.password;
  if (!user || !pass) {
    return { ok: false, message: "需要 HARMONY_CTF_USERNAME 和 HARMONY_CTF_PASSWORD 环境变量" };
  }
  const resp = await apiRequest("POST", "/api/auth/login", { username: user, password: pass });
  if (resp.status === 200 || resp.ok) {
    // 保存 cookie（由平台脚本管理，这里尝试从响应 Set-Cookie 提取）
    mkdirSync(join(homedir(), ".cache", "harmony_ctf_platform"), { recursive: true });
    // 提示：cookie 由 contest_api.py 管理，建议用平台脚本登录
    return { ok: true, message: "登录成功（cookie 由平台脚本维护）" };
  }
  return { ok: false, message: `登录失败 (${resp.status}): ${resp.text.slice(0, 200)}` };
}

/** whoami */
export async function whoami(): Promise<unknown> {
  const r = await apiRequest("GET", "/api/auth/whoami");
  return r.data ?? r.text;
}

/** 题目详情 */
export async function getChallenge(gameId: number, challengeId: number): Promise<ChallengeInfo | null> {
  const r = await apiRequest("GET", `/api/game/${gameId}/challenges/${challengeId}`);
  if (!r.ok) return null;
  return r.data as ChallengeInfo;
}

/**
 * 提交安全检查（防爆破规则）
 * 提交前必须调用：检查冷却/封禁/锁定状态
 * @returns {canSubmit, reason}
 */
export function checkSubmitSafety(c: ChallengeInfo): { canSubmit: boolean; reason: string } {
  if (c.isLocked) {
    return { canSubmit: false, reason: `题目已锁定${c.bannedLevel ? ` (L${c.bannedLevel} 被禁)` : ""}` };
  }
  if (c.bannedLevel !== null && c.bannedLevel !== undefined) {
    return { canSubmit: false, reason: `Level ${c.bannedLevel} 已封禁（触发 banTriggerAnswer）` };
  }
  if (c.activeTrackId && c.bannedTrackId && c.activeTrackId === c.bannedTrackId) {
    return { canSubmit: false, reason: "当前 track 已被封禁" };
  }
  return { canSubmit: true, reason: "可提交" };
}

export interface SubmitResult {
  ok: boolean;
  activeTrackId?: string | null;
  message?: string;
  status?: number;
  raw?: string;
}

/** 提交答案 */
export async function submit(
  gameId: number,
  challengeId: number,
  level: number,
  answer: string,
  trackId?: string,
  poll = true
): Promise<SubmitResult> {
  const payload: Record<string, unknown> = { level, answer };
  if (trackId) payload.trackId = trackId;
  const r = await apiRequest("POST", `/api/game/${gameId}/challenges/${challengeId}`, payload);
  if (r.ok) {
    const d = (r.data ?? {}) as { activeTrackId?: string | null; message?: string };
    return {
      ok: true,
      activeTrackId: d.activeTrackId,
      message: d.message,
      status: r.status,
      raw: r.text.slice(0, 500),
    };
  }
  return { ok: false, status: r.status, raw: r.text.slice(0, 500) };
}

/** 战报/状态 */
export async function status(gameId: number): Promise<unknown> {
  const r = await apiRequest("GET", `/api/game/${gameId}/status`);
  return r.data ?? r.text;
}
