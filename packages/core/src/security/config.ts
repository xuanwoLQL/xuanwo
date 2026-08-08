/**
 * 安全与合规：配置管理 + 授权校验
 * 配置存储于 ~/.xuanwo/config.json
 */
import { homedir } from "node:os";
import { join } from "node:path";
import { mkdirSync, writeFileSync, readFileSync, existsSync } from "node:fs";

export interface XuanwoConfig {
  authorizedPaths: string[];
  acceptedDisclaimer: boolean;
  acceptedAt?: string;
  defaultModel: string;
  provider?: string;
  baseUrl?: string;
  authorizedTarget?: string;
}

export function configPath(): string {
  return join(homedir(), ".xuanwo", "config.json");
}

export class ConfigManager {
  private config: XuanwoConfig;

  constructor(private file: string = configPath()) {
    this.config = this.load();
  }

  private load(): XuanwoConfig {
    if (existsSync(this.file)) {
      try {
        return { ...defaultConfig(), ...JSON.parse(readFileSync(this.file, "utf8")) };
      } catch {
        return defaultConfig();
      }
    }
    return defaultConfig();
  }

  save(): void {
    mkdirSync(dirnameOf(this.file), { recursive: true });
    writeFileSync(this.file, JSON.stringify(this.config, null, 2), "utf8");
  }

  get(): XuanwoConfig {
    return this.config;
  }

  isAuthorized(targetPath: string): boolean {
    const envTarget = process.env.XUANWO_AUTHORIZED_TARGET;
    const normalized = targetPath.replace(/\\/g, "/").replace(/\/+$/, "");
    const allowed = [
      ...this.config.authorizedPaths,
      ...(this.config.authorizedTarget ? [this.config.authorizedTarget] : []),
      ...(envTarget ? [envTarget] : []),
    ];
    return allowed.some((p) => {
      const np = p.replace(/\\/g, "/").replace(/\/+$/, "");
      return normalized === np || normalized.startsWith(np + "/");
    });
  }

  requireAccepted(): boolean {
    return this.config.acceptedDisclaimer === true;
  }

  setAccepted(at = new Date().toISOString()): void {
    this.config.acceptedDisclaimer = true;
    this.config.acceptedAt = at;
    this.save();
  }

  addAuthorizedPath(p: string): void {
    if (!this.config.authorizedPaths.includes(p)) {
      this.config.authorizedPaths.push(p);
      this.save();
    }
  }
}

function dirnameOf(p: string): string {
  return p.includes("/") || p.includes("\\") ? p.replace(/[\\/][^\\/]*$/, "") : ".";
}

function defaultConfig(): XuanwoConfig {
  return {
    authorizedPaths: [],
    acceptedDisclaimer: false,
    defaultModel: "deepseek-v4-flash",
  };
}
