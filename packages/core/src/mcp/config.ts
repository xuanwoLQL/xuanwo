/**
 * MCP 配置加载
 * 从 ~/.xuanwo/mcp.json 读取 server 配置
 */
import { homedir } from "node:os";
import { join } from "node:path";
import { readFileSync, writeFileSync, mkdirSync, existsSync } from "node:fs";
import type { McpServerConfig } from "./client.js";

export interface McpConfigFile {
  servers: McpServerConfig[];
}

export function mcpConfigPath(): string {
  return join(homedir(), ".xuanwo", "mcp.json");
}

export function loadMcpConfig(file = mcpConfigPath()): McpServerConfig[] {
  if (!existsSync(file)) return [];
  try {
    const data = JSON.parse(readFileSync(file, "utf8")) as McpConfigFile;
    return Array.isArray(data.servers) ? data.servers : [];
  } catch {
    return [];
  }
}

export function saveMcpConfig(servers: McpServerConfig[], file = mcpConfigPath()): void {
  mkdirSync(join(homedir(), ".xuanwo"), { recursive: true });
  writeFileSync(file, JSON.stringify({ servers }, null, 2), "utf8");
}
