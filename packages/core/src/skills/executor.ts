/**
 * 技能执行器
 * 技能通过 ToolExecutor 安全接口调用外部工具，
 * 内置白名单校验（仅允许技能声明且已注册的工具）。
 */
import type { ToolExecutor } from "../tools/ToolExecutor.js";
import type { SkillConfig } from "./loader.js";

export interface SkillExecResult {
  stdout: string;
  stderr: string;
  code: number;
}

/**
 * 技能的外部工具执行器
 * @param toolExecutor 已配置的 ToolExecutor
 * @param allowedTools 注册允许的工具集（由核心引擎传入）
 */
export class SkillExecutor {
  constructor(
    private toolExecutor: ToolExecutor,
    private allowedTools: Set<string>
  ) {}

  /** 技能声明工具是否全部合法 */
  validateSkill(skill: SkillConfig): string[] {
    return skill.tools.filter((t) => !this.allowedTools.has(t));
  }

  /**
   * 通过技能执行外部命令
   * @param skill 技能配置
   * @param command 命令名（必须在技能声明 + 白名单内）
   * @param args 参数
   */
  async execute(skill: SkillConfig, command: string, args: string[], opts: { cwd?: string } = {}): Promise<SkillExecResult> {
    // 双层校验：技能声明 + 全局白名单
    if (!skill.tools.includes(command)) {
      throw new Error(`技能 "${skill.id}" 未声明工具 "${command}"。声明: ${skill.tools.join(", ")}`);
    }
    if (!this.allowedTools.has(command)) {
      throw new Error(`工具 "${command}" 不在全局白名单`);
    }
    const r = await this.toolExecutor.execute(command, args, opts);
    return { stdout: r.stdout, stderr: r.stderr, code: r.code };
  }
}
