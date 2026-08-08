/**
 * ASCII Art 品牌启动画面
 * 纯 Node 实现，无依赖，跨平台可用（Bun/Node 均可）
 * 特性：彩虹渐变 Logo、初始化进度条、版本信息
 */

// xuanwo ASCII Art（等宽，适合终端）
export const XUANWO_LOGO = [
  "██╗  ██╗██╗   ██╗ █████╗ ███╗   ██╗██╗    ██╗ ██████╗",
  "╚██╗██╔╝╚██╗ ██╔╝██╔══██╗████╗  ██║██║    ██║██╔═══██╗",
  " ╚███╔╝  ╚████╔╝ ███████║██╔██╗ ██║██║ █╗ ██║██║   ██║",
  " ██╔██╗   ╚██╔╝  ██╔══██║██║╚██╗██║██║███╗██║██║   ██║",
  "██╔╝ ██╗   ██║   ██║  ██║██║ ╚████║╚███╔███╔╝╚██████╔╝",
  "╚═╝  ╚═╝   ╚═╝   ╚═╝  ╚═╝╚═╝  ╚═══╝ ╚══╝╚══╝  ╚═════╝ ",
];

const TAGLINE = "OpenHarmony AI 漏洞挖掘 · 多智能体 · 0day Hunting";

// ANSI 颜色
const COLORS = {
  red: 196, orange: 208, yellow: 220, green: 82, cyan: 51, blue: 33, purple: 141,
} as const;

function ansi256(code: number, text: string): string {
  return `\u001b[38;5;${code}m${text}\u001b[0m`;
}

/** 彩虹渐变渲染 Logo（逐字符着色） */
export function renderRainbowLogo(): string {
  const palette = Object.values(COLORS);
  const lines = XUANWO_LOGO.map((line) => {
    return [...line]
      .map((ch, i) => {
        if (ch === " ") return " ";
        const color = palette[i % palette.length];
        return ansi256(color, ch);
      })
      .join("");
  });
  return lines.join("\n");
}

/** 纯色渲染（fallback，终端不支持 256 色时） */
export function renderMonoLogo(color: keyof typeof COLORS = "cyan"): string {
  return XUANWO_LOGO.map((line) => ansi256(COLORS[color], line)).join("\n");
}

/** 完整启动画面文本 */
export function renderSplash(version = "0.1.0", useColor = true): string {
  const logo = useColor ? renderRainbowLogo() : renderMonoLogo();
  return `${logo}

${ansi256(COLORS.green, TAGLINE)}
${ansi256(COLORS.purple, `v${version} · 授权安全测试专用`)}
`;
}

/**
 * 初始化进度条（异步任务集合）
 * @param steps [{label, task}] 依次执行
 */
export async function runBootSequence(
  steps: { label: string; task: () => Promise<unknown> | unknown }[],
  onLog?: (msg: string) => void
): Promise<void> {
  const total = steps.length;
  for (let i = 0; i < total; i++) {
    const step = steps[i];
    const pct = Math.round(((i + 1) / total) * 100);
    onLog?.(`  ${step.label}...`);
    try {
      await step.task();
    } catch {
      /* 单步失败不阻塞启动 */
    }
    const bar = "█".repeat(Math.round((pct / 100) * 20)) + "░".repeat(20 - Math.round((pct / 100) * 20));
    onLog?.(`  [${bar}] ${pct}%`);
  }
}
