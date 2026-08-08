/**
 * ToolExecutor 安全接口
 * 所有外部工具调用的唯一入口，内置：
 * - 命令白名单
 * - 路径校验（授权目录前缀匹配，防穿越）
 * - 参数过滤（shell 元字符）
 */
import { spawn } from "node:child_process";
import { resolve, normalize, sep } from "node:path";

export interface AllowedCommand {
  command: string;
  bin: string;
  requirePath?: boolean;
  pathIndex?: number;
}

export interface ToolExecutorOptions {
  authorizedPaths: string[];
  allowedCommands: AllowedCommand[];
}

export interface ExecResult {
  stdout: string;
  stderr: string;
  code: number;
}

export class ToolExecutorError extends Error {}

export class ToolExecutor {
  private authorizedPaths: string[];
  private allowedCommands: Map<string, AllowedCommand>;

  constructor(options: ToolExecutorOptions) {
    this.authorizedPaths = options.authorizedPaths.map((p) => normalize(resolve(p)));
    this.allowedCommands = new Map(
      options.allowedCommands.map((c) => [c.command, c] as const)
    );
  }

  isCommandAllowed(command: string): boolean {
    return this.allowedCommands.has(command);
  }

  /** 校验路径是否在授权目录内；通过则返回规范化绝对路径 */
  checkPath(userPath: string): string {
    const abs = normalize(resolve(userPath));
    const ok = this.authorizedPaths.some((base) => abs === base || abs.startsWith(base + sep));
    if (!ok) {
      throw new ToolExecutorError(
        `路径未授权: "${userPath}" -> "${abs}"。授权目录: [${this.authorizedPaths.join(", ")}]`
      );
    }
    return abs;
  }

  /** 参数过滤：拒绝 shell 元字符 */
  sanitizeArg(arg: string): string {
    const s = String(arg);
    if (/[;&|`$<>()\n\r"']/.test(s)) {
      throw new ToolExecutorError(`参数含非法 shell 字符: "${s}"`);
    }
    return s;
  }

  async execute(command: string, args: string[] = [], opts: { cwd?: string; maxOutput?: number } = {}): Promise<ExecResult> {
    const spec = this.allowedCommands.get(command);
    if (!spec) {
      throw new ToolExecutorError(`命令不在白名单: "${command}"`);
    }
    const cleanArgs = args.map((a) => this.sanitizeArg(a));
    if (spec.requirePath && cleanArgs[spec.pathIndex ?? 0] !== undefined) {
      this.checkPath(cleanArgs[spec.pathIndex ?? 0]);
    }

    return new Promise<ExecResult>((resolvePromise, rejectPromise) => {
      const child = spawn(spec.bin, cleanArgs, {
        cwd: opts.cwd ? this.checkPath(opts.cwd) : process.cwd(),
        shell: false,
        windowsHide: true,
      });
      let stdout = "";
      let stderr = "";
      const maxOut = opts.maxOutput ?? 65536;
      child.stdout.on("data", (d: Buffer) => {
        stdout += d.toString();
        if (stdout.length > maxOut) child.kill();
      });
      child.stderr.on("data", (d: Buffer) => {
        stderr += d.toString();
      });
      child.on("error", rejectPromise);
      child.on("close", (code) => {
        if (code === 0) resolvePromise({ stdout, stderr, code });
        else rejectPromise(new ToolExecutorError(`命令退出码 ${code}: ${stderr.slice(0, 500)}`));
      });
    });
  }
}
