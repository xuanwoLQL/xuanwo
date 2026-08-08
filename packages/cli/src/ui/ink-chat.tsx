/**
 * Ink 对话式 TUI（OpenCode 风格）
 * 消息列表 + 输入框 + 状态栏 + 工具调用可视化 + 启动画面
 */
import React, { useState, useEffect, useRef, useCallback } from "react";
import { render, Text, Box, useInput, useApp } from "ink";
import { renderSplash } from "@xuanwo/core";
import type { AgentRuntime } from "@xuanwo/core";

export interface ChatMessage {
  role: "user" | "assistant" | "system" | "tool";
  content: string;
  agent?: string;
}

export interface TuiState {
  messages: ChatMessage[];
  busy: boolean;
  status: string;
  agent: string;
}

export interface InkTuiOptions {
  runtime: AgentRuntime;
  onTask: (input: string, addAssistant: (content: string) => void, setBusy: (b: boolean) => void) => Promise<string>;
}

export function InkChatTui({ runtime, onTask }: InkTuiOptions): React.ReactElement {
  const { exit } = useApp();
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [history, setHistory] = useState<string[]>([]);
  const [histIdx, setHistIdx] = useState(history.length);
  const [agent, setAgent] = useState("openharmony-hunter");
  const [splash, setSplash] = useState(true);

  const addMessage = useCallback((m: ChatMessage) => {
    setMessages((prev) => [...prev, m]);
  }, []);

  const addAssistant = useCallback(
    (content: string) => addMessage({ role: "assistant", content, agent }),
    [addMessage, agent]
  );

  // 启动画面延时后进入对话
  useEffect(() => {
    const t = setTimeout(() => setSplash(false), 1500);
    return () => clearTimeout(t);
  }, []);

  // 状态栏提示
  const statusBar = busy
    ? "⚙ 分析中..."
    : messages.length === 0
      ? "输入 /help 查看命令 · /scan <path> 扫描 · /knowledge <q> 检索"
      : "Ctrl+C 退出";

  const submit = useCallback(
    async (cmd: string) => {
      if (!cmd.trim() || busy) return;
      addMessage({ role: "user", content: cmd });
      setHistory((h) => [...h, cmd]);
      setHistIdx(history.length + 1);
      setInput("");
      setBusy(true);
      try {
        const reply = await onTask(cmd, addAssistant, setBusy);
        addAssistant(reply);
      } catch (e) {
        addAssistant(`❌ ${(e as Error).message}`);
      } finally {
        setBusy(false);
      }
    },
    [busy, addMessage, addAssistant, history.length, onTask]
  );

  useInput((inputStr, key) => {
    if (splash) return;
    if (key.ctrl && inputStr === "c") {
      exit();
      return;
    }
    if (key.return) {
      void submit(input);
      return;
    }
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
    if (key.backspace) {
      setInput((s) => s.slice(0, -1));
      return;
    }
    if (key.delete) {
      setInput((s) => s.slice(0, -1));
      return;
    }
    if (inputStr) {
      setInput((s) => s + inputStr);
    }
  });

  if (splash) {
    return (
      <Box flexDirection="column" alignItems="center" paddingY={2}>
        <Text color="cyan">{renderSplash("0.1.0")}</Text>
        <Text color="cyan">正在初始化 {runtime.availableAgents().length} 个智能体、{runtime.knowledge.size} 条知识模式...</Text>
      </Box>
    );
  }

  const lastMessages = messages.slice(-12);

  return (
    <Box flexDirection="column" height="100%">
      {/* 消息列表 */}
      <Box flexDirection="column" paddingX={1} flexGrow={1}>
        {lastMessages.map((m, i) => (
          <Box key={i} flexDirection="column" marginBottom={1}>
            <Text color={m.role === "user" ? "greenBright" : m.role === "tool" ? "yellow" : "cyan"} bold>
              {m.role === "user" ? "❯ 你" : m.role === "tool" ? "🛠 工具" : m.agent ? `🤖 ${m.agent}` : "🤖 xuanwo"}
            </Text>
            <Text dimColor={m.role === "tool"}>
              {m.content.split("\n").slice(0, 8).join("\n")}
            </Text>
          </Box>
        ))}
        {busy && (
          <Box>
            <Text color="yellow">⠋ 分析中...</Text>
          </Box>
        )}
      </Box>

      {/* 分隔线 */}
      <Box paddingX={1}>
        <Text dimColor>{"─".repeat(50)}</Text>
      </Box>

      {/* 输入区 + 状态栏 */}
      <Box flexDirection="column" paddingX={1} paddingY={1}>
        <Box>
          <Text color="greenBright">{">"}</Text>
          <Text> </Text>
          <Text>{input}</Text>
        </Box>
        <Text color="gray" dimColor>
          {statusBar}
        </Text>
      </Box>
    </Box>
  );
}

export function launchInkTui(runtime: AgentRuntime, onTask: InkTuiOptions["onTask"]): void {
  render(<InkChatTui runtime={runtime} onTask={onTask} />);
}
