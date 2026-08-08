/**
 * TUI 根组件
 * 管理消息、状态栏、快捷键、命令处理、工具进度
 */
import React, { useState, useEffect, useCallback, useRef } from "react";
import { Box, Text, useApp, useInput } from "ink";
import type { AgentRuntime } from "@xuanwo/core";
import { Logo } from "./components/Logo.js";
import { MessageList } from "./components/MessageList.js";
import { StatusBar } from "./components/StatusBar.js";
import { CommandPalette, PALETTE_COMMANDS } from "./components/CommandPalette.js";
import { useSession } from "./hooks/useSession.js";
import { useExitConfirm } from "./hooks/useKeybindings.js";
import { theme } from "./styles/theme.js";
import type { ToolProgressState } from "./components/ToolProgress.js";

const VERSION = "0.1.0";
const AGENTS = ["openharmony-hunter", "napi-auditor", "ipc-analyzer", "race-checker", "poc-generator"];

export interface AppProps {
  runtime: AgentRuntime;
}

export function App({ runtime }: AppProps): React.ReactElement {
  const { exit } = useApp();
  const { messages, sessionId, count, addMessage, clear, newSession } = useSession();

  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [splash, setSplash] = useState(true);
  const [agentIdx, setAgentIdx] = useState(0);
  const [paletteVisible, setPaletteVisible] = useState(false);
  const [tool, setTool] = useState<ToolProgressState | null>(null);
  const [history, setHistory] = useState<string[]>([]);
  const [histIdx, setHistIdx] = useState(history.length);
  const [scrollOffset, setScrollOffset] = useState(0);
  const [exitHint, setExitHint] = useState("");

  const currentAgent = AGENTS[agentIdx];
  const model = runtime.config.get().defaultModel || "deepseek-v4-flash";
  const scrollRef = useRef(0);

  const confirmExit = useExitConfirm();

  // 启动画面：Logo 停顿后进入对话
  useEffect(() => {
    const t = setTimeout(() => setSplash(false), 1200);
    return () => clearTimeout(t);
  }, []);

  // 执行用户输入（命令或任务）
  const runTask = useCallback(
    async (cmd: string) => {
      addMessage({ role: "user", content: cmd });
      setHistory((h) => [...h, cmd]);
      setHistIdx(history.length + 1);
      setInput("");
      setBusy(true);
      setTool(null);
      setScrollOffset(0);

      try {
        const result = await runtime.runTask(cmd, {}, (step) => {
          // 工具调用可视化
          if (step.type === "tool") {
            const toolName = (step.content || "").split("\n")[0].slice(0, 40);
            setTool({ name: `agent ${step.agentId}: ${toolName}`, status: "running", pct: 50 });
          } else if (step.type === "final") {
            setTool({ name: "完成", status: "done", pct: 100 });
          }
        });
        addMessage({ role: "assistant", content: result.conclusion, agent: currentAgent });
      } catch (e) {
        addMessage({ role: "error", content: (e as Error).message });
      } finally {
        setBusy(false);
        setTool(null);
        setScrollOffset(0);
      }
    },
    [addMessage, currentAgent, runtime, history.length]
  );

  // 命令处理
  const handleCommand = useCallback(
    async (cmd: string) => {
      const parts = cmd.trim().split(/\s+/);
      const c = parts[0].toLowerCase();

      switch (c) {
        case "/scan":
        case "/analyze":
        case "/nday":
        case "/report":
        case "/knowledge":
          await runTask(cmd.trim());
          break;
        case "/clear":
          clear();
          break;
        case "/session":
          if (parts[1] === "save") {
            addMessage({ role: "system", content: "会话已保存（功能完善中）" });
          } else if (parts[1] === "load") {
            addMessage({ role: "system", content: "会话加载（功能完善中）" });
          }
          break;
        case "/quit":
        case "/exit":
          exit();
          break;
        case "/help":
          addMessage({
            role: "system",
            content: PALETTE_COMMANDS.map((p) => `  ${p.cmd}  ${p.desc}`).join("\n"),
          });
          break;
        default:
          if (c.startsWith("/")) {
            addMessage({ role: "error", content: `未知命令: ${c}` });
          } else {
            await runTask(cmd.trim());
          }
      }
    },
    [runTask, addMessage, clear, exit]
  );

  // 提交输入
  const submit = useCallback(() => {
    if (!input.trim() || busy) return;
    if (input.trim().startsWith("/")) {
      void handleCommand(input.trim());
    } else {
      void runTask(input.trim());
    }
  }, [input, busy, handleCommand, runTask]);

  // 快捷键
  useInput((inputStr, key) => {
    if (splash) return;

    // Ctrl+C 二次确认
    if (key.ctrl && inputStr === "c") {
      if (confirmExit()) {
        exit();
      } else {
        setExitHint("再次按 Ctrl+C 确认退出");
        setTimeout(() => setExitHint(""), 1500);
      }
      return;
    }

    // 命令面板
    if (key.ctrl && inputStr === "p") {
      setPaletteVisible((v) => !v);
      return;
    }

    // 智能体切换
    if (key.ctrl && inputStr === "t") {
      setAgentIdx((i) => (i + 1) % AGENTS.length);
      return;
    }

    // 消息滚动
    if (key.pageDown) {
      scrollRef.current = Math.max(0, scrollRef.current - 3);
      setScrollOffset(scrollRef.current);
      return;
    }
    if (key.pageUp) {
      scrollRef.current += 3;
      setScrollOffset(scrollRef.current);
      return;
    }

    // Esc 关闭面板
    if (key.escape) {
      setPaletteVisible(false);
      return;
    }

    // Enter 提交
    if (key.return) {
      submit();
      return;
    }

    // 历史记录
    if (key.upArrow) {
      if (histIdx > 0) {
        const idx = histIdx - 1;
        setHistIdx(idx);
        setInput(history[idx] ?? "");
      }
      return;
    }
    if (key.downArrow) {
      if (histIdx < history.length) {
        const idx = histIdx + 1;
        setHistIdx(idx);
        setInput(history[idx] ?? "");
      }
      return;
    }

    // 退格
    if (key.backspace || key.delete) {
      setInput((s) => s.slice(0, -1));
      return;
    }

    // 普通字符输入（命令面板打开时不做输入）
    if (inputStr && !paletteVisible) {
      setInput((s) => s + inputStr);
    }
  });

  // 启动画面
  if (splash) {
    return (
      <Box flexDirection="column" alignItems="center" paddingY={2}>
        <Logo version={VERSION} />
      </Box>
    );
  }

  const hint = exitHint || (busy ? "分析中..." : "输入 /help 查看命令 · /scan <path> 扫描 · /knowledge <q> 检索");

  return (
    <Box flexDirection="column" height="100%">
      {/* 命令面板浮层 */}
      {paletteVisible && (
        <CommandPalette visible onClose={() => setPaletteVisible(false)} onSelect={(c) => { setInput(c); setPaletteVisible(false); }} />
      )}

      {/* 消息列表 */}
      <Box flexGrow={1}>
        <MessageList messages={messages} scrollOffset={scrollOffset} visibleHeight={15} />
      </Box>

      {/* 底部三行状态栏 */}
      <StatusBar
        model={model}
        agent={currentAgent}
        sessionId={sessionId}
        messageCount={count}
        tool={tool}
        input={input}
        hint={hint}
        historyIndex={histIdx >= 0 && histIdx < history.length ? histIdx : -1}
        historyLength={history.length}
      />
    </Box>
  );
}
