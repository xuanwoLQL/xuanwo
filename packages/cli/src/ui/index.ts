/**
 * TUI 入口：启动交互式界面
 */
import { AgentRuntime } from "@xuanwo/core";
import { LightTui, type TuiStatus } from "./tui.js";
import { handleCommand } from "./commands.js";

export async function runTui() {
  const runtime = await AgentRuntime.create();

  let mode = "interactive";
  let subagent = "";
  const suspiciousCount = () => 0;
  const analyzedCount = () => 0;

  const status: TuiStatus = {
    mode,
    suspiciousCount: suspiciousCount(),
    analyzedCount: analyzedCount(),
  };

  const setStatus = (partial: Partial<TuiStatus>) => {
    Object.assign(status, partial);
  };

  const tui = new LightTui({
    prompt: "xuanwo> ",
    getStatus: () => ({
      mode,
      subagent,
      suspiciousCount: suspiciousCount(),
      analyzedCount: analyzedCount(),
    }),
    onCommand: async (input) => {
      if (input.startsWith("/")) {
        await handleCommand(input, {
          tui,
          runtime,
          onStatusChange: () => {},
          setMode: (m) => {
            mode = m;
          },
        });
      } else {
        // 普通消息直接交给主控智能体
        tui.write(`（普通消息: ${input}）`);
        tui.write("提示: 使用 /scan <path> /analyze <file> /nday /knowledge <q> 开始审计");
      }
    },
    onShortcut: (key) => {
      if (key === "ctrl+p") {
        tui.write("命令面板: /help /scan /analyze /nday /report /knowledge /session /quit");
      } else if (key === "ctrl+t") {
        tui.write("变体切换（预留）: 当前模型 " + (runtime.config.get().defaultModel || "deepseek-v4-flash"));
      } else if (key === "tab") {
        tui.write("智能体切换（预留）: 可用 " + runtime.availableAgents().map((a) => a.id).join(", "));
      } else if (key === "esc") {
        tui.write("（ESC 暂不执行操作）");
      }
    },
  });

  void setStatus;
  tui.start();
}
