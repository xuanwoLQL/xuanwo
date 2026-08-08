/**
 * 会话管理：持久化与恢复
 * 序列化到 ~/.xuanwo/sessions/
 */
import { homedir } from "node:os";
import { join } from "node:path";
import { mkdirSync, writeFileSync, readFileSync, existsSync, readdirSync } from "node:fs";
import { createEmptyContext, type AuditContext } from "../agent/audit-context.js";

export interface SessionData {
  id: string;
  createdAt: string;
  updatedAt: string;
  title: string;
  agentId: string;
  messages: { role: string; content: string }[];
  context: AuditContext;
  analyzedFiles: string[];
}

export function sessionsDir(): string {
  return join(homedir(), ".xuanwo", "sessions");
}

export class SessionManager {
  private dir: string;

  constructor(dir: string = sessionsDir()) {
    this.dir = dir;
    mkdirSync(this.dir, { recursive: true });
  }

  save(session: SessionData): string {
    session.updatedAt = new Date().toISOString();
    const file = join(this.dir, `${session.id}.json`);
    writeFileSync(file, JSON.stringify(session, null, 2), "utf8");
    return file;
  }

  load(id: string): SessionData | null {
    const file = join(this.dir, `${id}.json`);
    if (!existsSync(file)) return null;
    try {
      return JSON.parse(readFileSync(file, "utf8")) as SessionData;
    } catch {
      return null;
    }
  }

  list(): { id: string; title: string; updatedAt: string }[] {
    if (!existsSync(this.dir)) return [];
    return readdirSync(this.dir)
      .filter((f) => f.endsWith(".json"))
      .map((f) => {
        try {
          const s = JSON.parse(readFileSync(join(this.dir, f), "utf8")) as SessionData;
          return { id: s.id, title: s.title, updatedAt: s.updatedAt };
        } catch {
          return null;
        }
      })
      .filter((x): x is { id: string; title: string; updatedAt: string } => x !== null)
      .sort((a, b) => (a.updatedAt < b.updatedAt ? 1 : -1));
  }

  create(title: string, agentId: string): SessionData {
    return {
      id: `session-${Date.now()}`,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      title,
      agentId,
      messages: [],
      context: createEmptyContext(),
      analyzedFiles: [],
    };
  }
}
