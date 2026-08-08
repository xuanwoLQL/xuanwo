/**
 * 攻击链构建器（借鉴 CyberStrikeAI attackchain）
 * 
 * 从审计结果（可疑点 + 情报 + 目标模块）生成树状攻击链：
 * - target 节点：审计目标
 * - action 节点：攻击步骤/数据流操作
 * - vulnerability 节点：确认的漏洞
 * - 因果边连接（非线性，树状/图状）
 * 
 * 核心：LLM 单次调用生成攻击链 JSON，展示"从入口到漏洞"的完整攻击路径。
 */
import type { LlmClient } from "../llm/client.js";
import type { SuspiciousPoint, IntelEntry } from "../agent/audit-context.js";

export type ChainNodeType = "target" | "action" | "vulnerability";

export interface ChainNode {
  id: string;
  type: ChainNodeType;
  label: string;
  riskScore: number;
  metadata: Record<string, unknown>;
}

export interface ChainEdge {
  source: string;
  target: string;
  type: string; // "leads-to" | "exploits" | "discovers" | "enables"
  weight: number;
}

export interface AttackChain {
  nodes: ChainNode[];
  edges: ChainEdge[];
  summary: string;
}

export interface ChainBuildInput {
  targetModule: string;
  targetFile: string;
  suspiciousPoints: SuspiciousPoint[];
  intel: IntelEntry[];
}

const CHAIN_SYSTEM = `你是一个专业的漏洞利用链构建专家。根据给定的安全审计结果，构建一个完整的攻击链（树状结构），展示从攻击入口到最终漏洞的完整路径。

输出 JSON（不要其他文字）：
{
  "nodes": [
    {"id":"n1","type":"target|action|vulnerability","label":"节点描述","risk_score":0-10,"metadata":{}},
    ...
  ],
  "edges": [
    {"source":"n1","target":"n2","type":"leads-to|exploits|discovers|enables","weight":1}
  ],
  "summary": "攻击链整体描述"
}

节点规则：
- target：审计目标（模块/文件），通常 1 个
- action：攻击步骤（数据流操作、入口利用、权限操作），可多个
- vulnerability：确认的漏洞节点
- 树状结构：一个节点可有多个子节点（分支），多个节点可指向同一漏洞（汇聚）
- 不要线性串联所有节点

边类型：
- leads-to：步骤导致下一步
- discovers：步骤发现漏洞
- exploits：攻击利用漏洞
- enables：漏洞使能后续攻击

风险分 risk_score 0-10：漏洞节点按严重度，critical=10, high=8, medium=5, low=2`;

/** 构建攻击链 */
export async function buildAttackChain(
  llm: LlmClient,
  input: ChainBuildInput
): Promise<AttackChain> {
  const userPrompt = `## 审计目标
模块: ${input.targetModule || "未指定"}
文件: ${input.targetFile || "未指定"}

## 已确认可疑点（${input.suspiciousPoints.length} 个）
${input.suspiciousPoints.map((p, i) => {
  const sev = p.evidence?.severity ?? "medium";
  return `${i + 1}. [${p.type}/${sev}] ${p.location} (conf=${p.confidence})
   ${p.description.slice(0, 200)}
   ${p.evidence?.callChain ? `调用链: ${p.evidence.callChain.join(" → ")}` : ""}`;
}).join("\n")}

## 审计情报（${input.intel.length} 条）
${input.intel.map((i) => `- [${i.kind}] ${i.target}: ${i.detail.slice(0, 150)}`).join("\n") || "无"}

请构建攻击链，展示攻击者如何从入口到达这些漏洞。`;

  const resp = await llm.chat(
    [
      { role: "system", content: CHAIN_SYSTEM },
      { role: "user", content: userPrompt },
    ],
    { jsonMode: true, temperature: 0.2 }
  );

  // 解析（宽松）
  let data: {
    nodes?: { id: string; type: ChainNodeType; label: string; risk_score?: number; metadata?: Record<string, unknown> }[];
    edges?: { source: string; target: string; type: string; weight?: number }[];
    summary?: string;
  } = {};
  try {
    const m = resp.content.match(/\{[\s\S]*\}/);
    data = m ? JSON.parse(m[0]) : {};
  } catch {
    /* 解析失败返回空链 */
  }

  const nodes: ChainNode[] = (data.nodes ?? []).map((n) => ({
    id: n.id,
    type: n.type ?? "action",
    label: n.label ?? "",
    riskScore: n.risk_score ?? 0,
    metadata: n.metadata ?? {},
  }));
  const edges: ChainEdge[] = (data.edges ?? []).map((e) => ({
    source: e.source,
    target: e.target,
    type: e.type ?? "leads-to",
    weight: e.weight ?? 1,
  }));

  return {
    nodes,
    edges,
    summary: data.summary ?? "",
  };
}

/** 攻击链 ASCII 可视化 */
export function renderChain(chain: AttackChain): string {
  if (chain.nodes.length === 0) return "攻击链为空";
  const lines: string[] = [];
  lines.push(`攻击链: ${chain.nodes.length} 节点, ${chain.edges.length} 边`);
  lines.push(`\n${chain.summary}\n`);

  // 找根节点（无入边）
  const hasInEdge = new Set(chain.edges.map((e) => e.target));
  const roots = chain.nodes.filter((n) => !hasInEdge.has(n.id));

  const childrenOf = (id: string) => chain.edges.filter((e) => e.source === id).map((e) => e.target);
  const nodeById = new Map(chain.nodes.map((n) => [n.id, n]));

  const typeIcon: Record<ChainNodeType, string> = {
    target: "🎯",
    action: "⚙",
    vulnerability: "💥",
  };

  const visited = new Set<string>();
  const print = (id: string, prefix: string, isLast: boolean, depth: number) => {
    if (depth > 8 || visited.has(id)) return;
    visited.add(id);
    const node = nodeById.get(id);
    if (!node) return;
    const connector = prefix + (isLast ? "└─ " : "├─ ");
    lines.push(`${connector}${typeIcon[node.type]} ${node.label} (risk=${node.riskScore})`);
    const kids = childrenOf(id).filter((k) => !visited.has(k));
    kids.forEach((k, i) => print(k, prefix + (isLast ? "   " : "│  "), i === kids.length - 1, depth + 1));
  };

  roots.forEach((r, i) => print(r.id, "", i === roots.length - 1, 0));

  // 未访问节点（孤立）补充
  for (const n of chain.nodes) {
    if (!visited.has(n.id)) {
      lines.push(`• ${typeIcon[n.type]} ${n.label} (risk=${n.riskScore})`);
    }
  }

  return lines.join("\n");
}

/** 简化摘要（一行） */
export function chainOneLine(chain: AttackChain): string {
  const vulns = chain.nodes.filter((n) => n.type === "vulnerability");
  return `攻击链: ${chain.nodes.length}节点/${chain.edges.length}边, ${vulns.length}个漏洞点${chain.summary ? ` | ${chain.summary.slice(0, 80)}` : ""}`;
}
