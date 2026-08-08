/**
 * 知识库管理：Nday 模式加载、V1 规则分组检索
 * 渐进式 RAG：V1 规则分组 → V2 全文索引（预留）→ V3 向量检索（预留）
 */
import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { KnowledgeRetriever } from "./retriever.js";

export interface NdayPattern {
  id: string;
  cveId?: string;
  vulnerabilityType: "UAF" | "缓冲区溢出" | "权限绕过" | "条件竞争" | "整数溢出" | "其他";
  modulePath: string;
  functionChain: string[];
  fixDescription: string;
  severity: "CRITICAL" | "HIGH" | "MEDIUM" | "LOW";
  codeSnippet: string;
  tags: string[];
  confidence: number;
  needsReview: boolean;
}

export interface KnowledgeIndex {
  version: string;
  updatedAt: string;
  patterns: NdayPattern[];
}

/** 知识库检索器（V1：规则分组） */
export class KnowledgeBase {
  private patterns: NdayPattern[] = [];

  constructor(private knowledgeDir: string) {}

  load(): void {
    const file = join(this.knowledgeDir, "nday-patterns.json");
    if (!existsSync(file)) {
      this.patterns = [];
      return;
    }
    const data = JSON.parse(readFileSync(file, "utf8")) as KnowledgeIndex;
    this.patterns = data.patterns ?? [];
  }

  get size(): number {
    return this.patterns.length;
  }

  /** V1：按模块前缀分组匹配 */
  searchByModule(modulePath: string): NdayPattern[] {
    const target = modulePath.replace(/\/+$/, "");
    return this.patterns.filter((p) => {
      const pm = (p.modulePath ?? "").replace(/\/+$/, "");
      return pm === target || pm.startsWith(target) || target.startsWith(pm);
    });
  }

  /** V1：按漏洞类型匹配 */
  searchByType(type: NdayPattern["vulnerabilityType"]): NdayPattern[] {
    return this.patterns.filter((p) => p.vulnerabilityType === type);
  }

  /** 全量模式（供 V2/V3 未来使用） */
  all(): NdayPattern[] {
    return this.patterns;
  }

  /** 高置信度模式（needsReview=false） */
  confirmed(): NdayPattern[] {
    return this.patterns.filter((p) => !p.needsReview);
  }

  /** 渐进式 RAG 检索器（V1 规则分组 + V2 全文索引） */
  retriever(): KnowledgeRetriever {
    return new KnowledgeRetriever(this.patterns);
  }
}
