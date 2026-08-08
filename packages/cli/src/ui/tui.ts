/**
 * 轻量 TUI：基于 readline + ANSI 转义
 * 零重型依赖，跨平台（含 Windows）可靠。
 * 提供：状态栏、输入区、输出滚动区、快捷键（Ctrl+P / Ctrl+T / Tab / Esc）。
 */
import { createInterface } from "node:readline";
import { stdin, stdout } from "node:process";

export interface TuiStatus {
  mode: string; // 当前模式/智能体
  progress?: string; // 进度信息
  suspiciousCount: number;
  analyzedCount: number;
  subagent?: string; // 当前运行的子智能体
}

export interface TuiOptions {
  onCommand: (input: string) => void | Promise<void>;
  onShortcut?: (key: string) => void | Promise<void>;
  getStatus: () => TuiStatus;
  prompt?: string;
}

const ESC = "\u001b[";
const CLEAR_LINE = `${ESC}2K`;
const MOVE_UP = (n: number) => `${ESC}${n}A`;
const MOVE_DOWN = (n: number) => `${ESC}${n}B`;

export class LightTui {
  private rl: ReturnType<typeof createInterface>;
  private output: string[] = [];
  private options: TuiOptions;
  private history: string[] = [];
  private historyIdx = 0;
  private paused = false;

  constructor(options: TuiOptions) {
    this.options = options;
    this.rl = createInterface({
      input: stdin,
      output: stdout,
      terminal: true,
    });
    this.rl.setPrompt(options.prompt ?? "xuanwo> ");
    this.bindKeys();
  }

  /** 输出消息到滚动区 */
  write(text: string): void {
    const lines = String(text).split("\n");
    this.output.push(...lines);
    if (this.output.length > 200) this.output = this.output.slice(-200);
    this.render();
  }

  private render(): void {
    if (this.paused) return;
    const status = this.options.getStatus();
    // 清空当前行，重绘状态栏 + 最近输出
    const statusLine = `[${status.mode}]${status.subagent ? ` sub=${status.subagent}` : ""} 可疑=${status.suspiciousCount} 已分析=${status.analyzedCount}${status.progress ? ` ${status.progress}` : ""}`;
    const lastLines = this.output.slice(-5);
    const toShow = [`${CLEAR_LINE}${statusLine}`, ...lastLines.map((l) => `${CLEAR_LINE}${l}`)];
    stdout.write(MOVE_UP(toShow.length) + toShow.join("\n") + MOVE_DOWN(toShow.length));
    this.rl.prompt();
  }

  private bindKeys(): void {
    stdin.setRawMode?.(true);
    stdin.resume?.();
    this.rl.on("line", async (line) => {
      const input = line.trim();
      if (input) {
        this.history.push(input);
        this.historyIdx = this.history.length;
        await this.options.onCommand(input);
      }
      this.rl.prompt();
    });
    stdin.on("keypress", (str, key) => {
      if (!key) return;
      // 快捷键
      if (key.ctrl && key.name === "p") {
        void this.options.onShortcut?.("ctrl+p");
        return;
      }
      if (key.ctrl && key.name === "t") {
        void this.options.onShortcut?.("ctrl+t");
        return;
      }
      if (key.name === "tab") {
        void this.options.onShortcut?.("tab");
        return;
      }
      if (key.name === "escape") {
        void this.options.onShortcut?.("esc");
      }
    });
  }

  start(): void {
    this.write("xuanwo TUI 已启动。输入 /help 查看命令。Ctrl+P 命令面板，Ctrl+T 切换变体，Ctrl+C 退出。");
  }

  pause(): void {
    this.paused = true;
  }

  resume(): void {
    this.paused = false;
    this.render();
  }

  close(): void {
    stdin.setRawMode?.(false);
    this.rl.close();
  }
}
