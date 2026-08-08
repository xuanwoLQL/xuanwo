/**
 * 会话管理 Hook
 * 管理消息列表、会话 ID、消息计数
 */
import { useCallback, useRef, useState } from "react";

export interface ChatMessage {
  role: "user" | "assistant" | "tool" | "system" | "error";
  content: string;
  agent?: string;
}

export interface SessionState {
  messages: ChatMessage[];
  sessionId: string;
  count: number;
}

export function useSession() {
  const sessionIdRef = useRef(`sess_${Date.now().toString(36)}`);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [sessionId, setSessionId] = useState(sessionIdRef.current);

  const addMessage = useCallback((m: ChatMessage) => {
    setMessages((prev) => [...prev, m]);
  }, []);

  const clear = useCallback(() => {
    setMessages([]);
  }, []);

  const newSession = useCallback(() => {
    const id = `sess_${Date.now().toString(36)}`;
    sessionIdRef.current = id;
    setSessionId(id);
    setMessages([]);
  }, []);

  return {
    messages,
    sessionId,
    count: messages.length,
    addMessage,
    clear,
    newSession,
  };
}
