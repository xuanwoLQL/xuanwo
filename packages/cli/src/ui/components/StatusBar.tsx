/**
 * 底部状态栏组件（三行）
 * 行1: 模型 | 智能体 | 会话 | 消息数
 * 行2: 工具调用进度
 * 行3: 输入区
 */
import React from "react";
import { Box, Text } from "ink";
import { theme } from "../styles/theme.js";
import { ToolProgress, type ToolProgressState } from "./ToolProgress.js";
import { Input } from "./Input.js";

export interface StatusBarProps {
  model: string;
  agent: string;
  sessionId: string;
  messageCount: number;
  tool: ToolProgressState | null;
  input: string;
  hint: string;
  historyIndex: number;
  historyLength: number;
}

function Dot(): React.ReactElement {
  return <Text color="greenBright">●</Text>;
}

function Sep(): React.ReactElement {
  return <Text color={theme.statusBar.separator}> ｜ </Text>;
}

export function StatusBar({
  model,
  agent,
  sessionId,
  messageCount,
  tool,
  input,
  hint,
  historyIndex,
  historyLength,
}: StatusBarProps): React.ReactElement {
  return (
    <Box flexDirection="column" borderStyle="single" borderColor="gray" paddingX={1}>
      {/* 行1: 主状态栏 */}
      <Box flexDirection="row" justifyContent="space-between">
        <Box flexDirection="row">
          <Dot />
          <Sep />
          <Text color={theme.statusBar.model}>模型: {model}</Text>
          <Sep />
          <Text color={theme.statusBar.agent}>智能体: {agent}</Text>
          <Sep />
          <Text color={theme.statusBar.session}>会话: {sessionId}</Text>
          <Sep />
          <Text color={theme.statusBar.count}>消息: {messageCount}</Text>
        </Box>
      </Box>

      {/* 行2: 工具进度 */}
      <ToolProgress tool={tool} />

      {/* 行3: 输入区 */}
      <Input value={input} hint={hint} historyIndex={historyIndex} historyLength={historyLength} />
    </Box>
  );
}
