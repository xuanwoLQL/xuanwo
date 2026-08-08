import { readFileSync } from "node:fs";
import OpenAI from "openai";
import { resolveConfig } from "./proto/llm-config.js";
import { parseLog, countTokens } from "./proto/log-parser.js";
import { validatePatterns, normalizePatterns } from "./proto/schema.js";

const LOG_PATH =
  process.env.XUANWO_LOG_PATH ||
  "D:\\opencode提示词\\opencode日志\\OpenHarmonyCTF_Nday_Agent_原始运行日志.txt";
const LIMIT_SESSIONS = Number(process.env.XUANWO_LIMIT_SESSIONS || 10);
const MAX_TOKENS_PER_SESSION = Number(process.env.XUANWO_MAX_TOKENS || 6000);

const SYSTEM_PROMPT = `你是一个安全研究员，负责从 OpenHarmony CTF 解题日志中提取 Nday 漏洞模式。
请分析给定的一段 Agent 运行日志（包含 CMD 命令、OUT 输出、>> 分析文本），提取其中体现的漏洞模式。
提取规则：
1. 只提取日志中真实涉及的安全漏洞模式（如 UAF、缓冲区溢出、权限绕过、条件竞争、整数溢出等），不要臆造
2. 每条模式需要：id(唯一，如 "p1")、cveId(若有)、vulnerabilityType、modulePath(源码路径)、
   functionChain(调用链数组)、fixDescription(修复描述)、severity、codeSnippet(关键代码片段)、
   tags(标签)、confidence(0-1)、needsReview(低置信度时 true)
3. 若该段没有明确漏洞模式，返回空数组 []
4. 输出必须是合法的 JSON 数组，不要包含其他文字`;

const KEYWORDS = [
  /CWE-\d+/i,
  /Accepted/,
  /UAF|use[- ]?after[- ]?free/i,
  /越界|溢出|OOB|overflow/i,
  /漏洞|修复|commit/i,
  /race|竞争|TOCTOU/i,
  /权限|bypass/i,
];

/** 从会话行中挑选高价值片段，控制输入 token。返回 {body, droppedLines} */
function selectValuableBody(lines, maxTokens) {
  const scored = lines.map((l, i) => {
    let score = 0;
    for (const re of KEYWORDS) if (re.test(l.text)) score += 1;
    if (l.type === "think") score += 0.5;
    return { l, i, score };
  });
  const picked = scored
    .filter((x) => x.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, 60);
  picked.sort((a, b) => a.i - b.i);
  let body = picked.map((x) => x.l.text).join("\n");
  if (countTokens(body) > maxTokens) {
    body = body.slice(0, Math.floor(body.length * (maxTokens / countTokens(body))));
  }
  return { body, selected: picked.length, total: lines.length };
}

function buildUserPrompt(sessionIndex, title, body) {
  return `SESSION [${sessionIndex}] ${title}
以下是该会话的日志片段（截取前 ${MAX_TOKENS_PER_SESSION} tokens 以内）：
${body}`;
}

async function extractOne(client, model, session) {
  const resp = await client.chat.completions.create({
    model,
    response_format: { type: "json_object" },
    messages: [
      { role: "system", content: SYSTEM_PROMPT },
      { role: "user", content: buildUserPrompt(session.index, session.title, session.body) },
    ],
  });
  const raw = resp.choices[0]?.message?.content ?? "";
  const usage = resp.usage;
  let tokensIn = 0;
  let tokensOut = 0;
  if (usage) {
    tokensIn = usage.prompt_tokens ?? 0;
    tokensOut = usage.completion_tokens ?? 0;
  } else {
    tokensIn = countTokens(SYSTEM_PROMPT + buildUserPrompt(session.index, session.title, session.body));
    tokensOut = countTokens(raw);
  }
  return { patterns: JSON.parse(raw), tokensIn, tokensOut, raw };
}

const CONCURRENCY = Number(process.env.XUANWO_CONCURRENCY || 4);

async function mapLimit(items, limit, fn) {
  const results = new Array(items.length);
  let idx = 0;
  async function worker() {
    while (idx < items.length) {
      const i = idx++;
      results[i] = await fn(items[i], i);
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return results;
}
async function main() {
  const cfg = resolveConfig();
  console.log(`[xuanwo] 提取模型锁定: ${cfg.model} (base: ${cfg.baseUrl})`);
  console.log(`[xuanwo] 日志: ${LOG_PATH}`);

  const raw = readFileSync(LOG_PATH, "utf8");
  const sessions = parseLog(raw).slice(0, LIMIT_SESSIONS);
  console.log(`[xuanwo] 解析到 SESSION: ${sessions.length} 个（截取前 ${LIMIT_SESSIONS}）`);

  const client = new OpenAI({ apiKey: cfg.apiKey, baseURL: cfg.baseUrl, timeout: 120000 });
  const allPatterns = [];
  const stats = { ok: 0, fail: 0, tokensIn: 0, tokensOut: 0, sessions: sessions.length };
  const report = [];

  await mapLimit(sessions, CONCURRENCY, async (s) => {
    let body = s.body;
    let selected = 0;
    const tok = countTokens(body);
    if (tok > MAX_TOKENS_PER_SESSION) {
      const sel = selectValuableBody(s.lines, MAX_TOKENS_PER_SESSION);
      body = sel.body;
      selected = sel.selected;
    }
    try {
      const { patterns, tokensIn, tokensOut } = await extractOne(client, cfg.model, { ...s, body });
      stats.tokensIn += tokensIn;
      stats.tokensOut += tokensOut;
      const normalized = normalizePatterns(patterns);
      const v = validatePatterns(normalized);
      if (v.ok) {
        stats.ok++;
        allPatterns.push(...normalized);
        report.push({ session: s.index, ok: true, patterns: normalized.length, tokensIn, tokensOut, errors: [], selected });
      } else {
        stats.fail++;
        report.push({ session: s.index, ok: false, patterns: 0, tokensIn, tokensOut, errors: v.errors, selected });
      }
    } catch (e) {
      stats.fail++;
      report.push({ session: s.index, ok: false, patterns: 0, tokensIn: 0, tokensOut: 0, errors: [e.message], selected });
    }
  });

  const successRate = stats.sessions ? (stats.ok / stats.sessions) * 100 : 0;
  console.log("\n===== 验证报告 =====");
  console.log(`提取成功率: ${stats.ok}/${stats.sessions} = ${successRate.toFixed(1)}% (目标 ≥80%)`);
  console.log(`总 token 消耗: in=${stats.tokensIn} out=${stats.tokensOut} 合计=${stats.tokensIn + stats.tokensOut}`);
  console.log(`有效模式条目: ${allPatterns.length}`);
  report.forEach((r) =>
    console.log(`  SESSION[${r.session}]: ${r.ok ? "OK" : "FAIL"} patterns=${r.patterns} tok=${r.tokensIn}+${r.tokensOut} selected=${r.selected}${r.errors.length ? " err=" + r.errors.join(";") : ""}`)
  );

  const passed = successRate >= 80;
  console.log(`\n验证结果: ${passed ? "PASS ✅（可进入第一阶段）" : "FAIL ❌（需调整提取策略）"}`);
  return passed ? 0 : 1;
}

main().catch((e) => {
  console.error("提取链路验证失败:", e);
  process.exit(2);
});
