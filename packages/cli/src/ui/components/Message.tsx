/**
 * 单条消息组件
 * 区分 用户/AI/工具/系统/错误，代码块缩进
 */
import React from "react";
import { Box, Text } from "ink";
import { theme } from "../styles/theme.js";
import type { ChatMessage } from "../hooks/useSession.js";

function CodeBlock({ code }: { code: string }): React.ReactElement {
  const lines = code.split("\n");
  return (
    <Box flexDirection="column" marginLeft={2} borderStyle="round" borderColor="gray">
      {lines.map((line, i) => (
        <Text key={i} color="gray">
          {line || " "}
        </Text>
      ))}
    </Box>
  );
}

/** 将消息内容按代码块分段渲染 */
function renderContent(content: string): React.ReactElement[] {
  const parts = content.split(/```/g);
  const nodes: React.ReactElement[] = [];
  parts.forEach((part, i) => {
    if (i % 2 === 1) {
      // 代码块
      const code = part.split("\n").slice(1).join("\n");
      nodes.push(<CodeBlock key={i} code={code} />);
    } else if (part.trim()) {
      nodes.push(
        <Text key={i} color={theme.assistant.text}>
          {part}
        </Text>
      );
    }
  });
  return nodes;
}

export interface MessageProps {
  message: ChatMessage;
}

export function Message({ message }: MessageProps): React.ReactElement {
  switch (message.role) {
    case "user":
      return (
        <Box flexDirection="column" marginBottom={1}>
          <Text color={theme.user.name} bold>
            {theme.user.prefix}
          </Text>
          <Text color={theme.user.text}>{message.content}</Text>
        </Box>
      );
    case "tool":
      return (
        <Box flexDirection="column" marginBottom={1}>
          <Text color={theme.tool.name}>🔧 {message.content.split("\n")[0]}</Text>
          {message.content.split("\n").slice(1).join("\n") && (
            <Text color={theme.tool.text} dimColor>
              {message.content.split("\n").slice(1).join("\n")}
            </Text>
          )}
        </Box>
      );
    case "error":
      return (
        <Box flexDirection="column" marginBottom={1}>
          <Text color={theme.error}>✖ {message.content}</Text>
        </Box>
      );
    case "system":
      return (
        <Box flexDirection="column" marginBottom={1}>
          <Text color={theme.info} dimColor>
            {message.content}
          </Text>
        </Box>
      );
    case "assistant":
    default:
      return (
        <Box flexDirection="column" marginBottom={1}>
          <Text color={theme.assistant.name} bold>
            {message.agent ? `🤖 ${message.agent}` : "🤖 xuanwo"}
          </Text>
          {renderContent(message.content)}
        </Box>
      );
  }
}
