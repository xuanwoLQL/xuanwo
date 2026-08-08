/**
 * 消息列表组件
 * 支持滚动（PgUp/PgDn），显示消息总数
 */
import React from "react";
import { Box, Text } from "ink";
import { Message } from "./Message.js";
import type { ChatMessage } from "../hooks/useSession.js";

export interface MessageListProps {
  messages: ChatMessage[];
  scrollOffset: number; // 从底部向上滚动的行数
  visibleHeight: number;
  onScrollChange?: (offset: number) => void;
}

export function MessageList({ messages, scrollOffset, visibleHeight }: MessageListProps): React.ReactElement {
  // 如果消息太多，只显示最近 visibleHeight 条（减去滚动偏移）
  const total = messages.length;
  const visible = Math.max(1, Math.min(total, visibleHeight));
  const end = Math.min(total, total - scrollOffset);
  const start = Math.max(0, end - visible);
  const shown = messages.slice(start, end);

  return (
    <Box flexDirection="column" paddingX={1} flexGrow={1}>
      {shown.map((m, i) => (
        <Message key={start + i} message={m} />
      ))}
      {scrollOffset > 0 && (
        <Text color="gray" dimColor>
          ↑ 上方还有 {scrollOffset} 条消息（PgUp 查看）
        </Text>
      )}
    </Box>
  );
}
