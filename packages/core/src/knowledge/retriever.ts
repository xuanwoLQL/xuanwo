/**
 * 渐进式 RAG 检索层
 * V1: 规则分组（modulePath 前缀匹配）
 * V2: 全文索引（minisearch：vulnerabilityType / functionChain / tags / fixDescription）
 * V3: 向量检索（预留接口，后续接入 Chroma / LanceDB）
 */
import MiniSearch from "minisearch";
import type { NdayPattern } from "./knowledge.js";

export interface SearchResult {
  pattern: NdayPattern;
  score: number;
  reason: string;
}

const MINI_INDEX_FIELDS = ["vulnerabilityType", "functionChain", "tags", "fixDescription", "modulePath"] as const;

export class KnowledgeRetriever {
  private mini: MiniSearch<NdayPattern>;
  private patterns: NdayPattern[];

  constructor(patterns: NdayPattern[]) {
    this.patterns = patterns;
    this.mini = new MiniSearch<NdayPattern>({
      fields: [...MINI_INDEX_FIELDS],
      storeFields: ["id", "vulnerabilityType", "modulePath"],
      searchOptions: { boost: { vulnerabilityType: 2, functionChain: 2 }, fuzzy: 0.2 },
    });
    // minisearch 对数组字段需要预处理：join 数组
    const docs = patterns.map((p) => ({
      ...p,
      functionChain: Array.isArray(p.functionChain) ? p.functionChain.join(" ") : "",
      tags: Array.isArray(p.tags) ? p.tags.join(" ") : "",
    }));
    this.mini.addAll(docs as unknown as NdayPattern[]);
  }

  /** V1: 规则分组（模块前缀匹配） */
  searchByModule(modulePath: string): SearchResult[] {
    const target = modulePath.replace(/\/+$/, "");
    const out: SearchResult[] = [];
    for (const p of this.patterns) {
      const pm = (p.modulePath ?? "").replace(/\/+$/, "");
      if (pm === target || pm.startsWith(target) || target.startsWith(pm)) {
        out.push({ pattern: p, score: 1, reason: `模块匹配 ${pm}` });
      }
    }
    return out;
  }

  /** V2: 全文检索 */
  searchFullText(query: string): SearchResult[] {
    const results = this.mini.search(query, { prefix: true, combineWith: "AND" });
    return results.slice(0, 10).map((r) => ({
      pattern: this.patterns.find((p) => p.id === r.id) as NdayPattern,
      score: r.score,
      reason: `全文索引命中 (score=${r.score.toFixed(3)})`,
    }));
  }

  /** 组合检索：模块优先，全文补充 */
  search(query: string, modulePath?: string): SearchResult[] {
    const moduleHits = modulePath ? this.searchByModule(modulePath) : [];
    const textHits = query ? this.searchFullText(query) : [];
    const seen = new Set<string>();
    const merged: SearchResult[] = [];
    for (const r of [...moduleHits, ...textHits]) {
      if (!r.pattern || seen.has(r.pattern.id)) continue;
      seen.add(r.pattern.id);
      merged.push(r);
    }
    return merged.slice(0, 15);
  }

  /** V3: 向量检索（预留接口） */
  async searchVector(_query: string): Promise<SearchResult[]> {
    // TODO: 接入 Chroma / LanceDB + embedding
    return [];
  }
}
