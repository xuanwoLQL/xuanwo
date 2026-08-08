/**
 * 技能加载器
 * 读取 SKILL.md（YAML frontmatter + 主体），校验声明工具是否在白名单内。
 */
import { readFileSync, readdirSync, existsSync } from "node:fs";
import { join, resolve } from "node:path";
import { parseFrontmatter, renderTemplate, type TemplateContext } from "../agent/config.js";

export interface SkillConfig {
  id: string;
  name: string;
  description: string;
  tools: string[];
  body: string;
  sourcePath: string;
}

/** 解析技能：从 SKILL.md 提取 frontmatter + 主体 */
export function parseSkillFile(filePath: string, ctx: TemplateContext): SkillConfig {
  const source = readFileSync(filePath, "utf8");
  const m = source.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n([\s\S]*)$/);
  if (!m) {
    throw new Error(`技能缺少 frontmatter: ${filePath}`);
  }
  const meta = parseFrontmatter(m[1]);
  const body = renderTemplate(m[2].trim(), ctx);
  const id = String(meta.id ?? "");
  if (!id) throw new Error(`技能缺少 id: ${filePath}`);

  return {
    id,
    name: String(meta.name ?? id),
    description: String(meta.description ?? ""),
    tools: Array.isArray(meta.tools) ? (meta.tools as string[]) : [],
    body,
    sourcePath: filePath,
  };
}

export interface SkillLoadResult {
  skills: SkillConfig[];
  rejected: { file: string; reason: string }[];
}

/**
 * 从目录加载技能，并校验声明的工具是否在白名单内。
 * @param dir 技能根目录（含子技能文件夹）
 * @param allowedTools 允许的工具集（如 ToolExecutor 白名单 + read/grep）
 */
export function loadSkillsFromDir(
  dir: string,
  ctx: TemplateContext,
  allowedTools: Set<string>
): SkillLoadResult {
  const skills: SkillConfig[] = [];
  const rejected: { file: string; reason: string }[] = [];

  if (!existsSync(dir)) return { skills, rejected };

  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    const skillFile = join(dir, entry.name, "SKILL.md");
    if (!existsSync(skillFile)) continue;
    try {
      const skill = parseSkillFile(skillFile, ctx);
      // 白名单校验
      const bad = skill.tools.filter((t) => !allowedTools.has(t));
      if (bad.length > 0) {
        rejected.push({
          file: skillFile,
          reason: `声明工具不在白名单: ${bad.join(", ")}`,
        });
        continue;
      }
      skills.push(skill);
    } catch (e) {
      rejected.push({ file: skillFile, reason: (e as Error).message });
    }
  }
  return { skills, rejected };
}

/** 校验技能声明工具是否可解析（供 CLI 检查） */
export function validateSkillTools(skill: SkillConfig, allowedTools: Set<string>): boolean {
  return skill.tools.every((t) => allowedTools.has(t));
}

export function resolveSkillsDir(baseDir: string): string {
  return resolve(baseDir, "skills");
}
