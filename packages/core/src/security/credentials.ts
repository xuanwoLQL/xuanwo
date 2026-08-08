/**
 * 凭据存储抽象层
 * 优先使用 keytar（系统凭据管理器：Windows Credential Vault / macOS Keychain / Linux libsecret）
 * 若 keytar 不可用（如 SEA 打包环境），自动降级为 node:crypto 加密文件（密钥绑定机器特征）
 */
import { randomBytes, createCipheriv, createDecipheriv, createHash } from "node:crypto";
import { homedir, hostname, userInfo } from "node:os";
import { join } from "node:path";
import { mkdirSync, readFileSync, writeFileSync, existsSync } from "node:fs";

const SERVICE = "xuanwo";

interface KeyValueStore {
  getPassword(account: string): Promise<string | null>;
  setPassword(account: string, password: string): Promise<void>;
  deletePassword(account: string): Promise<boolean>;
}

/** 机器特征密钥：绑定机器 + 用户，保证文件被拷走也无法解密 */
function machineKey(): Buffer {
  const identity = `${hostname()}|${userInfo().username}`;
  return createHash("sha256").update(identity).digest();
}

/** 加密文件存储（备选方案） */
class EncryptedFileStore implements KeyValueStore {
  private file: string;

  constructor() {
    this.file = join(homedir(), ".xuanwo", "credentials.enc");
  }

  private readAll(): Record<string, string> {
    if (!existsSync(this.file)) return {};
    try {
      const buf = readFileSync(this.file);
      const tag = buf.subarray(0, 16);
      const iv = buf.subarray(16, 28);
      const data = buf.subarray(28);
      const decipher = createDecipheriv("aes-256-gcm", machineKey(), iv);
      decipher.setAuthTag(tag);
      const dec = Buffer.concat([decipher.update(data), decipher.final()]);
      return JSON.parse(dec.toString("utf8"));
    } catch {
      return {};
    }
  }

  private writeAll(map: Record<string, string>): void {
    const iv = randomBytes(12);
    const cipher = createCipheriv("aes-256-gcm", machineKey(), iv);
    const data = Buffer.concat([cipher.update(JSON.stringify(map), "utf8"), cipher.final()]);
    const tag = cipher.getAuthTag();
    mkdirSync(join(homedir(), ".xuanwo"), { recursive: true });
    writeFileSync(this.file, Buffer.concat([tag, iv, data]));
  }

  async getPassword(account: string): Promise<string | null> {
    return this.readAll()[account] ?? null;
  }

  async setPassword(account: string, password: string): Promise<void> {
    const map = this.readAll();
    map[account] = password;
    this.writeAll(map);
  }

  async deletePassword(account: string): Promise<boolean> {
    const map = this.readAll();
    if (!(account in map)) return false;
    delete map[account];
    this.writeAll(map);
    return true;
  }
}

/** keytar 存储（系统凭据管理器） */
class KeytarStore implements KeyValueStore {
  private keytar: typeof import("keytar") | null = null;

  constructor() {
    try {
      // 动态 require，避免 SEA 环境下加载失败直接崩溃
      // eslint-disable-next-line @typescript-eslint/no-var-requires
      this.keytar = require("keytar");
    } catch {
      this.keytar = null;
    }
  }

  get available(): boolean {
    return this.keytar !== null;
  }

  async getPassword(account: string): Promise<string | null> {
    if (!this.keytar) return null;
    return this.keytar.getPassword(SERVICE, account);
  }

  async setPassword(account: string, password: string): Promise<void> {
    if (!this.keytar) return;
    await this.keytar.setPassword(SERVICE, account, password);
  }

  async deletePassword(account: string): Promise<boolean> {
    if (!this.keytar) return false;
    return this.keytar.deletePassword(SERVICE, account);
  }
}

/** 统一凭据管理器 */
export class CredentialManager {
  private store: KeyValueStore;
  readonly backend: "keytar" | "encrypted-file";

  constructor() {
    const keytar = new KeytarStore();
    if (keytar.available) {
      this.store = keytar;
      this.backend = "keytar";
    } else {
      this.store = new EncryptedFileStore();
      this.backend = "encrypted-file";
    }
  }

  getApiKey(provider: string): Promise<string | null> {
    return this.store.getPassword(`apikey:${provider}`);
  }

  async setApiKey(provider: string, key: string): Promise<void> {
    await this.store.setPassword(`apikey:${provider}`, key);
  }

  deleteApiKey(provider: string): Promise<boolean> {
    return this.store.deletePassword(`apikey:${provider}`);
  }
}
