import { spawn } from "node:child_process";
import { resolve, normalize, sep } from "node:path";

/**
 * ToolExecutor 安全接口（原型验证版）
 * - 命令白名单：仅允许登记的外部工具，拒绝任意 shell
 * - 路径校验：目标路径必须在 authorizedPaths 内，拒绝穿越
 * - 参数过滤：转义 / 拒绝 shell 元字符
 */
export class ToolExecutor {
  constructor({ authorizedPaths = [], allowedCommands = [] } = {}) {
    this.authorizedPaths = authorizedPaths.map((p) => normalize(resolve(p)));
    this.allowedCommands = new Map();
    for (const c of allowedCommands) {
      this.allowedCommands.set(c.command, c);
    }
  }

  /** 校验命令是否在白名单中 */
  checkCommand(command) {
    if (!this.allowedCommands.has(command)) {
      throw new Error(`命令不在白名单: "${command}"。允许: ${[...this.allowedCommands.keys()].join(", ")}`);
    }
    return true;
  }

  /** 校验路径是否在授权目录内（核心防穿越逻辑） */
  checkPath(userPath) {
    const abs = normalize(resolve(userPath));
    const ok = this.authorizedPaths.some((base) => abs === base || abs.startsWith(base + sep));
    if (!ok) {
      throw new Error(
        `路径未授权: "${userPath}" -> "${abs}"。授权目录: [${this.authorizedPaths.join(", ")}]`
      );
    }
    return abs;
  }

  /** 参数过滤：拒绝 shell 元字符 */
  sanitizeArg(arg) {
    const s = String(arg);
    if (/[;&|`$<>()\n\r"']/.test(s)) {
      throw new Error(`参数含非法 shell 字符: "${s}"`);
    }
    return s;
  }

  /**
   * 执行命令（唯一入口）
   * @param {string} command 白名单命令名
   * @param {string[]} args 参数数组
   * @param {{ cwd?: string, maxOutput?: number }} opts
   */
  async execute(command, args = [], opts = {}) {
    this.checkCommand(command);
    const spec = this.allowedCommands.get(command);
    const cleanArgs = args.map((a) => this.sanitizeArg(a));

    if (spec.requirePath) {
      const pathIdx = spec.pathIndex ?? 0;
      this.checkPath(cleanArgs[pathIdx]);
    }

    return new Promise((resolveP, rejectP) => {
      const child = spawn(spec.bin, cleanArgs, {
        cwd: opts.cwd ? this.checkPath(opts.cwd) : process.cwd(),
        shell: false,
        windowsHide: true,
      });
      let stdout = "";
      let stderr = "";
      const maxOut = opts.maxOutput ?? 65536;
      child.stdout.on("data", (d) => { stdout += d; if (stdout.length > maxOut) child.kill(); });
      child.stderr.on("data", (d) => { stderr += d; });
      child.on("error", rejectP);
      child.on("close", (code) => {
        if (code === 0) resolveP({ stdout, stderr, code });
        else rejectP(new Error(`命令退出码 ${code}: ${stderr.slice(0, 500)}`));
      });
    });
  }
}

/** 内置允许命令（原型验证用；正式版按需扩展） */
export function defaultAllowed() {
  return [
    { command: "git", bin: "git", requirePath: false },
    { command: "grep", bin: "grep", requirePath: false },
    { command: "semgrep", bin: "semgrep", requirePath: true, pathIndex: 0 },
    { command: "arkanalyzer", bin: "arkanalyzer", requirePath: true, pathIndex: 0 },
  ];
}
