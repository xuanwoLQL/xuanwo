/**
 * 颜色主题（OpenCode 风格）
 * 统一管理所有 UI 颜色，方便调整
 */

export const theme = {
  // 用户消息
  user: {
    prefix: "> ",
    name: "cyanBright",
    text: "whiteBright",
  },
  // AI 消息
  assistant: {
    name: "green",
    text: "white",
  },
  // 工具调用
  tool: {
    name: "yellow",
    text: "gray",
  },
  // 系统/错误
  error: "redBright",
  warn: "yellowBright",
  success: "greenBright",
  info: "cyan",
  dim: "gray",

  // 状态栏
  statusBar: {
    bg: "black",
    model: "magenta",
    agent: "cyan",
    session: "yellow",
    count: "green",
    separator: "gray",
  },
  // 工具进度条
  progress: {
    bar: "greenBright",
    idle: "gray",
    text: "yellow",
  },
  // 输入区
  input: {
    prompt: "greenBright",
    text: "white",
    hint: "gray",
  },
  // 命令面板
  palette: {
    bg: "black",
    border: "cyan",
    item: "white",
    selected: "cyanBright",
    key: "yellow",
  },
} as const;

export type Theme = typeof theme;
