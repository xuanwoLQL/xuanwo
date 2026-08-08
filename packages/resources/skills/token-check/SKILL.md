---
id: token-check
name: Ability Token 鉴权机制检查
description: OpenHarmony Ability Token / AccessToken 鉴权机制的安全检查
tools: [grep, read]
---

# Ability Token 鉴权机制检查

OpenHarmony 使用 AccessToken / AbilityToken 进行系统能力授权管理。

## 审计步骤
1. 定位系统服务入口，检查 `CheckCallingPermission` / `CheckCallingTokenID`
2. 检查 token 传递链：跨进程时 token 是否可伪造
3. 检查权限常量是否在 `grantedPermissions` 正确声明
4. 检查权限校验是否被绕过（如 `||` 短路、默认放行）

## 高危模式清单

| 模式 | 危险信号 | 后果 |
|:---|:---|:---|
| token 可伪造 | 用调用方传入的 token 而非系统 token | 提权 |
| 校验短路 | `if (!CheckXXX() || true)` 或注释 TODO | 绕过 |
| 默认放行 | switch default 分支无校验 | 越权 |
| token 泄露 | token 传入不可信代码路径 | 冒充 |
| 缺失校验 | 敏感操作无任何权限检查 | 未授权访问 |

## 关键检查点
- 搜索: `CheckCallingPermission|CheckCallingTokenID|GetCallingUid|GetCallingPid|VerifyAccessToken`
- 对每个敏感系统接口，确认调用方身份校验存在
- 检查权限定义（`permission.json` / `ACCESS_*` 常量）
- 确认 token 是系统通过 Binder 自动附加，而非从消息体读取

## 输出格式
每个可疑点输出: `接口 file:line + 缺失的权限校验 + 攻击者如何绕过`
