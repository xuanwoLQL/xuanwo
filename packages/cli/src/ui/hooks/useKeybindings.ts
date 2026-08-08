/**
 * 快捷键辅助 Hook
 * Ctrl+C 二次确认退出
 */
import { useRef } from "react";

const EXIT_TIMEOUT = 1500;

export function useExitConfirm() {
  const lastExitRef = useRef(0);
  return (): boolean => {
    const now = Date.now();
    if (now - lastExitRef.current < EXIT_TIMEOUT) {
      return true; // 已确认
    }
    lastExitRef.current = now;
    return false; // 第一次按下，需要再按一次
  };
}
