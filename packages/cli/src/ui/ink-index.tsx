/**
 * Ink TUI 启动器
 * 启动 AgentRuntime + 渲染 App 根组件
 */
import { render } from "ink";
import { AgentRuntime } from "@xuanwo/core";
import { App } from "./App.js";

export async function runInkTui(): Promise<void> {
  const runtime = await AgentRuntime.create();
  render(<App runtime={runtime} />);
}
