/**
 * 资源路径定位
 * SEA 打包后资源外置，按优先级探测：
 * 1. 环境变量 XUANWO_RESOURCES_DIR
 * 2. 可执行文件同目录 resources/
 * 3. 当前工作目录 packages/resources/
 */
import { existsSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

export interface ResourcePaths {
  agentsDir: string;
  knowledgeDir: string;
  skillsDir: string;
}

function exeDir(): string {
  // SEA 下 __dirname 为 exe 所在目录
  if (typeof __dirname !== "undefined") return resolve(__dirname);
  try {
    return dirname(fileURLToPath(import.meta.url));
  } catch {
    return process.cwd();
  }
}

function findDir(candidates: string[]): string | null {
  for (const c of candidates) {
    if (existsSync(c)) return c;
  }
  return null;
}

export function resolveResourcePaths(): ResourcePaths {
  const env = process.env.XUANWO_RESOURCES_DIR;
  const exeRes = join(exeDir(), "resources");
  const cwdRes = join(process.cwd(), "packages", "resources");
  const devRes = join(process.cwd(), "packages", "resources");

  const base = env ?? findDir([exeRes, cwdRes, devRes]) ?? devRes;

  return {
    agentsDir: findDir([join(base, "agents")]) ?? join(base, "agents"),
    knowledgeDir: findDir([join(base, "knowledge")]) ?? join(base, "knowledge"),
    skillsDir: findDir([join(base, "skills")]) ?? join(base, "skills"),
  };
}
