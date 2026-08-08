/**
 * 技能注册表
 * 将技能注册为可发现资源，供智能体提示词注入和按需加载。
 */
import type { SkillConfig } from "./loader.js";

export interface DiscoverableSkill {
  id: string;
  name: string;
  description: string;
  tools: string[];
}

export class SkillRegistry {
  private skills = new Map<string, SkillConfig>();
  private rejected: { file: string; reason: string }[] = [];

  constructor(skills: SkillConfig[], rejected: { file: string; reason: string }[] = []) {
    for (const s of skills) this.skills.set(s.id, s);
    this.rejected = rejected;
  }

  get size(): number {
    return this.skills.size;
  }

  /** 技能清单（可发现资源元数据） */
  list(): DiscoverableSkill[] {
    return [...this.skills.values()].map((s) => ({
      id: s.id,
      name: s.name,
      description: s.description,
      tools: s.tools,
    }));
  }

  has(id: string): boolean {
    return this.skills.has(id);
  }

  get(id: string): SkillConfig | undefined {
    return this.skills.get(id);
  }

  /** 技能简介文本（注入智能体提示词，让模型决定何时加载详情） */
  summaryText(): string {
    if (this.skills.size === 0) return "（无可用技能）";
    return [...this.skills.values()]
      .map((s) => `- ${s.id}: ${s.description}`)
      .join("\n");
  }

  /** 加载技能详情（完整审计指南） */
  getBody(id: string): string | undefined {
    return this.skills.get(id)?.body;
  }

  getRejected(): { file: string; reason: string }[] {
    return this.rejected;
  }
}
