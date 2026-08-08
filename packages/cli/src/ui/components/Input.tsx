/**
 * 输入框组件
 * 支持历史记录（↑↓）、命令提示
 */
import React from "react";
import { Box, Text } from "ink";
import { theme } from "../styles/theme.js";

export interface InputProps {
  value: string;
  hint: string;
  historyIndex: number;
  historyLength: number;
  onChange?: (value: string) => void;
}

export function Input({ value, hint, historyIndex, historyLength }: InputProps): React.ReactElement {
  return (
    <Box flexDirection="column" paddingX={1}>
      <Box flexDirection="row">
        <Text color={theme.input.prompt} bold>
          {">"}
        </Text>
        <Text> </Text>
        <Text color={theme.input.text}>{value}</Text>
        {historyLength > 0 && historyIndex >= 0 && (
          <Text color="gray" dimColor>
            {" "}
            ({historyIndex + 1}/{historyLength})
          </Text>
        )}
      </Box>
      <Text color={theme.input.hint} dimColor>
        {hint}
      </Text>
    </Box>
  );
}
