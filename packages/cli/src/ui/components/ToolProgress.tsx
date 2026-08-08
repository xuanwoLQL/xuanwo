/**
 * 工具调用进度条组件
 * 实时显示工具执行进度
 */
import React from "react";
import { Box, Text } from "ink";
import { theme } from "../styles/theme.js";

export interface ToolProgressState {
  name: string;
  status: "running" | "done" | "error";
  pct?: number; // 0-100，未知时为 null
  detail?: string;
}

export function ToolProgress({ tool }: { tool: ToolProgressState | null }): React.ReactElement {
  if (!tool) return <Box />;

  const barWidth = 16;
  const pct = tool.pct ?? 0;
  const filled = Math.round((pct / 100) * barWidth);
  const bar = "█".repeat(filled) + "░".repeat(barWidth - filled);

  const statusIcon = tool.status === "done" ? "✅" : tool.status === "error" ? "✖" : "🔧";
  const statusColor = tool.status === "done" ? theme.success : tool.status === "error" ? theme.error : theme.warn;

  return (
    <Box flexDirection="row">
      <Text color={statusColor}>{statusIcon} 正在执行: {tool.name}</Text>
      <Text> </Text>
      <Text color={theme.progress.bar}>{bar}</Text>
      <Text> </Text>
      <Text color={theme.progress.text}>{tool.status === "done" ? "完成" : tool.status === "error" ? "失败" : `${pct}%`}</Text>
      {tool.detail ? (
        <Text color="gray" dimColor>
          {" "}
          {tool.detail}
        </Text>
      ) : null}
    </Box>
  );
}
