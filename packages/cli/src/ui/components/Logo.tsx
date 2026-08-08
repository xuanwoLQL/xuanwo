/**
 * 启动 Logo 组件
 * 显示 xuanwo ASCII 艺术字 + 版本号
 */
import React from "react";
import { Box, Text } from "ink";
import { renderSplash } from "@xuanwo/core";

export interface LogoProps {
  version: string;
  progress?: string;
}

export function Logo({ version, progress }: LogoProps): React.ReactElement {
  return (
    <Box flexDirection="column" alignItems="center" paddingY={1}>
      <Text color="cyanBright">{renderSplash(version)}</Text>
      {progress ? (
        <Text color="yellow">{progress}</Text>
      ) : (
        <Text color="gray" dimColor>
          正在初始化...
        </Text>
      )}
    </Box>
  );
}
