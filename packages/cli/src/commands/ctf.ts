/**
 * 竞赛平台命令
 * xuanwo ctf login|whoami|challenge|status|submit
 */
import { login, whoami, getChallenge, submit, status, contestConfig } from "@xuanwo/core";

export async function runCtfCommand(args: string[]) {
  const action = args[0];

  switch (action) {
    case "login": {
      const r = await login(args[1], args[2]);
      console.log(r.message);
      return;
    }
    case "whoami": {
      const r = await whoami();
      console.log(typeof r === "string" ? r : JSON.stringify(r, null, 2));
      return;
    }
    case "challenge": {
      const gameId = Number(args[1] ?? 2);
      const challengeId = Number(args[2]);
      if (!challengeId) {
        console.error("用法: xuanwo ctf challenge <gameId> <challengeId>");
        return;
      }
      const c = await getChallenge(gameId, challengeId);
      if (!c) {
        console.log("获取题目失败（可能未登录或 ID 错误）");
        return;
      }
      console.log(`题目 ${c.id}: ${c.title ?? "?"}`);
      console.log(`  分类: ${c.category ?? "?"}`);
      console.log(`  activeTrackId: ${c.activeTrackId ?? "无"}`);
      console.log(`  attempts: ${c.attempts ?? 0}`);
      console.log(`  已解决: ${c.allEnabledFlagsSolved ? "是" : "否"}`);
      console.log(`  锁定: ${c.isLocked ? "是" : "否"}${c.bannedLevel ? ` (封禁 L${c.bannedLevel})` : ""}`);
      return;
    }
    case "status": {
      const gameId = Number(args[1] ?? 2);
      const r = await status(gameId);
      console.log(typeof r === "string" ? r : JSON.stringify(r, null, 2).slice(0, 2000));
      return;
    }
    case "submit": {
      const gameId = Number(args[1] ?? 2);
      const challengeId = Number(args[2]);
      const level = Number(args[3]);
      const answer = args[4];
      const trackId = args[5];
      if (!challengeId || !level || !answer) {
        console.error("用法: xuanwo ctf submit <gameId> <challengeId> <level> <answer> [trackId]");
        return;
      }
      const r = await submit(gameId, challengeId, level, answer, trackId);
      if (r.ok) {
        console.log(`✅ 提交成功! activeTrackId=${r.activeTrackId ?? "?"}${r.message ? ` (${r.message})` : ""}`);
      } else {
        console.log(`❌ 提交失败: ${r.raw ?? ""}`);
      }
      return;
    }
    case "config": {
      const cfg = contestConfig();
      console.log(`Base URL: ${cfg.baseUrl}`);
      console.log(`Cookie: ${cfg.cookieFile}`);
      console.log(`用户名: ${cfg.username ? "已设置" : "未设置 (HARMONY_CTF_USERNAME)"}`);
      return;
    }
    default:
      console.log(`用法: xuanwo ctf <login|whoami|challenge|status|submit|config>`);
      console.log(`  login                      登录 (env: HARMONY_CTF_USERNAME/PASSWORD)`);
      console.log(`  challenge <g> <c>         题目详情`);
      console.log(`  submit <g> <c> <level> <answer> [trackId]  提交答案`);
      console.log(`  status [g]                战报`);
  }
}
