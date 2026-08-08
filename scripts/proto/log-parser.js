import { encoding_for_model } from "tiktoken";

let enc = null;

export function countTokens(text) {
  if (!enc) {
    try {
      enc = encoding_for_model("gpt-4o");
    } catch {
      enc = encoding_for_model("cl100k_base");
    }
  }
  return enc.encode(text).length;
}

const SESSION_RE = /^SESSION \[(\d+)\]\s*(.*)$/;

export function parseLog(raw) {
  const sessions = [];
  let current = null;
  const buf = [];
  const bufLines = [];

  const flush = () => {
    if (current) {
      current.body = buf.join("\n");
      current.lines = bufLines.slice();
      sessions.push(current);
    }
    buf.length = 0;
    bufLines.length = 0;
  };

  for (const line of raw.split("\n")) {
    const m = line.match(SESSION_RE);
    if (m) {
      flush();
      current = { index: Number(m[1]), title: m[2], body: "", lines: [] };
      continue;
    }
    if (current) {
      buf.push(line);
      bufLines.push({ type: classify(line), text: line });
    }
  }
  flush();
  sessions.sort((a, b) => a.index - b.index);
  return sessions;
}

function classify(line) {
  const t = line.trim();
  if (/^\d\d:\d\d:\d\d\] CMD:/.test(t) || /^CMD:/.test(t)) return "cmd";
  if (/^\d\d:\d\d:\d\d\] OUT:/.test(t) || /^OUT:/.test(t)) return "out";
  if (/^\d\d:\d\d:\d\d\] >>/.test(t) || /^>>/.test(t)) return "think";
  if (t.startsWith("SESSION") || t.startsWith("=")) return "meta";
  return "unknown";
}
