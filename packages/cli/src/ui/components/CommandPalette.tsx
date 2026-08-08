/**
 * 命令面板（Ctrl+P 浮层）
 */
import React from "react";
import { Box, Text } from "ink";
import { theme } from "../styles/theme.js";

export interface PaletteItem {
  cmd: string;
  desc: string;
}

export const PALETTE_COMMANDS: PaletteItem[] = [
  { cmd: "/scan <path>", desc: "启动源码扫描" },
  { cmd: "/analyze <file>", desc: "深度分析单个文件" },
  { cmd: "/nday", desc: "进入 Nday 学习模式" },
  { cmd: "/report", desc: "生成审计报告" },
  { cmd: "/knowledge <q>", desc: "检索知识库" },
  { cmd: "/knowledge update --log <path>", desc: "更新知识库" },
  { cmd: "/session save", desc: "保存当前会话" },
  { cmd: "/session load", desc: "加载历史会话" },
  { cmd: "/clear", desc: "清屏" },
  { cmd: "/quit", desc: "退出" },
];

export interface CommandPaletteProps {
  visible: boolean;
  onClose: () => void;
  onSelect: (cmd: string) => void;
}

export function CommandPalette({ visible, onClose, onSelect }: CommandPaletteProps): React.ReactElement {
  if (!visible) return <Box />;

  return (
    <Box flexDirection="column" borderStyle="round" borderColor={theme.palette.border} marginX={2} marginBottom={1}>
      <Box paddingX={1}>
        <Text color={theme.palette.border} bold>
          ⌘ 命令面板
        </Text>
      </Box>
      {PALETTE_COMMANDS.map((item, i) => (
        <Box key={i} flexDirection="row" paddingX={1}>
          <Text color={theme.palette.key} bold>
            {item.cmd}
          </Text>
          <Text color="gray">
            {"  "}
            {item.desc}
          </Text>
        </Box>
      ))}
      <Box paddingX={1}>
        <Text color="gray" dimColor>
          ↑↓ 选择 · Enter 执行 · Esc 关闭
        </Text>
      </Box>
      <Box paddingX={1}>
        <Text color="gray" dimColor>
          提示：在输入框直接输入命令也可执行
        </Text>
      </Box>
      <Box paddingX={1}>
        <Text color="cyan" dimColor>
          （Esc 关闭本面板）
        </Text>
      </Box>
    </Box>
  );
}
