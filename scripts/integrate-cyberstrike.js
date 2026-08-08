/**
 * xuanwo → cyberstrike 集成脚本
 * 把 xuanwo 的安全 agent 转成 cyberstrike 的 agent 格式（markdown frontmatter）
 * 生成到 ~/.config/cyberstrike/agents/，并生成 Patch Diffing skill。
 *
 * 用法: node scripts/integrate-cyberstrike.js [--install]
 *   --install: 实际写入 ~/.config/cyberstrike/
 *   不带: 仅预览生成内容
 */
import { readFileSync, writeFileSync, mkdirSync, existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { homedir } from "node:os";

const __dirname = dirname(fileURLToPath(import.meta.url));
const agentsDir = join(__dirname, "..", "packages", "resources", "agents");
const skillsDir = join(__dirname, "..", "packages", "resources", "skills");
const target = process.argv.includes("--install");
const CS_AGENTS = join(homedir(), ".config", "cyberstrike", "agents");
const CS_SKILLS = join(homedir(), ".config", "cyberstrike", "skill");

// 要转换的安全 agent（排除纯编程的 coder/explorer 可保留，这里全转）
const SECURITY_AGENTS = ["openharmony-hunter", "napi-auditor", "ipc-analyzer", "race-checker", "poc-generator"];

/** 解析 markdown frontmatter */
function parseFrontmatter(source) {
  const m = source.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n([\s\S]*)$/);
  if (!m) return { meta: {}, body: source };
  const meta = {};
  for (const line of m[1].split("\n")) {
    const kv = line.match(/^([A-Za-z0-9_-]+):\s*(.*)$/);
    if (!kv) continue;
    const key = kv[1];
    const val = kv[2].trim();
    if (val.startsWith("[")) {
      meta[key] = val.replace(/^\[|\]$/g, "").split(",").map((s) => s.trim()).filter(Boolean);
    } else if (val.startsWith('"') && val.endsWith('"')) {
      meta[key] = val.slice(1, -1);
    } else {
      meta[key] = val;
    }
  }
  return { meta, body: m[2].trim() };
}

/** 把 xuanwo prompt 转成 cyberstrike prompt（清理占位符） */
function toCyberPrompt(body) {
  // 移除 xuanwo 模板变量（保持核心方法论）
  return body
    .replace(/\{\{KNOWLEDGE_SUMMARY\}\}/g, "（结合 Nday 知识库：UAF/溢出/权限/竞争/整数 5 类模式）")
    .replace(/\{\{SUBAGENT_ROSTER\}\}/g, "")
    .replace(/\{\{SKILL_CONTENT\}\}/g, "")
    .replace(/\{\{DEFAULT_MODEL\}\}/g, "")
    .trim();
}

/** 生成 cyberstrike agent 文件内容 */
function toCyberAgent(file) {
  const src = readFileSync(join(agentsDir, file), "utf8");
  const { meta, body } = parseFrontmatter(src);
  const id = meta.id ?? file.replace(".md", "");
  const prompt = toCyberPrompt(body);

  // 主控 description 增强：明确 Nday/0day 用途
  const descMap = {
    "openharmony-hunter": "OpenHarmony 漏洞挖掘主控（Nday/0day）：Patch Diffing 定位修复 + 污点追踪 + 攻击链 + 三级提交(L1位置/L2 commit/L3 CWE)",
  };
  const desc = descMap[id] ?? meta.description ?? `${id} OpenHarmony 漏洞挖掘智能体`;
  const lines = [
    "---",
    `description: ${desc}`,
    "mode: subagent",
    "tools:",
    "  bash: true",
    "  read: true",
    "  write: true",
    "  edit: true",
    "  glob: true",
    "  grep: true",
    "  webfetch: true",
    "---",
    "",
    prompt,
    "",
  ];
  return { id, content: lines.join("\n") };
}

/** 生成 Patch Diffing skill */
function generateNdaySkill() {
  return {
    id: "ohos-nday",
    content: `---
name: ohos-nday
description: "OpenHarmony Nday 漏洞挖掘方法论：Patch Diffing 定位修复 commit → 提取漏洞位置/commit/CWE"
category: "ohos"
version: "1.0"
tags: [openharmony, nday, patch-diffing, ctf]
---

# OpenHarmony Nday 挖掘方法论

## 核心流程（Patch Diffing）

1. **拉取 master**：\`git fetch origin master\`
2. **对比 6.0 修复**：\`git log OpenHarmony-v6.0-Release..origin/master\`
3. **筛选安全修复**：关键词 fix/security/CVE/UAF/permission/overflow/race
4. **查看 diff**：\`git show <commit>\`（merge commit 用 \`git diff parent..commit\`）
5. **提取漏洞信息**：
   - L1 漏洞位置：被删除/修改行的 file:line（源码根相对路径）
   - L2 修复 commit hash
   - L3 CWE 编号（如 CWE-787）

## 三级提交规范

| Level | 内容 | 格式 |
|-------|------|------|
| L1 | 漏洞位置 | \`foundation/xxx/...:行号\` |
| L2 | commit hash | 纯 hash |
| L3 | CWE | \`CWE-787\` |

## ⚠️ 防爆破规则（必须遵守）

- wrongAnswerLimit 5~60，答错超限触发 5 分钟冷却
- 禁止枚举行号（冻结提交资格）
- 提交前必须查询题目状态
- 只提交有 diff 依据、能解释漏洞操作的答案

## 证据要求

每个发现必须说明：
- 修复前漏洞操作是什么（被删除的行）
- 为什么这是漏洞（缺校验/越界/未授权）
- 触发条件（谁调用、传什么）
`,
  };
}

/** 主流程 */
async function main() {
  console.log("===== xuanwo → cyberstrike 集成 =====");
  console.log(target ? "模式: 安装（写入 ~/.config/cyberstrike/）" : "模式: 预览（--install 写入）\n");

  const generated = [];

  // 转换 agent
  for (const a of SECURITY_AGENTS) {
    const { id, content } = toCyberAgent(`${a}.md`);
    generated.push({ type: "agent", id, content });
  }

  // Patch Diffing skill
  const skill = generateNdaySkill();
  generated.push({ type: "skill", id: skill.id, content: skill.content });

  // 输出/写入
  for (const g of generated) {
    if (target) {
      const dir = g.type === "agent" ? CS_AGENTS : CS_SKILLS;
      mkdirSync(dir, { recursive: true });
      const file = join(dir, g.id === "ohos-nday" ? "SKILL.md" : `${g.id}.md`);
      writeFileSync(file, g.content, "utf8");
      console.log(`✅ 写入 ${file}`);
    } else {
      console.log(`\n--- ${g.type}: ${g.id} (预览) ---`);
      console.log(g.content.slice(0, 300) + (g.content.length > 300 ? "\n..." : ""));
    }
  }

  if (target) {
    console.log("\n✅ 集成完成！");
    console.log("验证: cyberstrike agent list | grep openharmony");
    console.log("使用: 在 cyberstrike TUI 里 @openharmony-hunter 调用");
  } else {
    console.log("\n预览完成。加 --install 实际写入。");
  }
}

main().catch((e) => {
  console.error("集成失败:", e);
  process.exit(1);
});
