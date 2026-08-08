/**
 * 模块路径规范化
 * 将提取的 modulePath 归一化为 OpenHarmony 标准源码路径（foundation/xxx 或 drivers/xxx）。
 * 处理：
 * - 仓库名（web_webview → foundation/web/web_webview）
 * - 直接文件名（process.cpp → 附加到已知模块）
 * - 已有完整路径保留
 */
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const REPO_TO_PREFIX = {
  web_webview: "foundation/web/web_webview",
  web: "foundation/web",
  arkweb: "foundation/web/arkweb",
  ohos_cef_ext: "foundation/web/arkweb/ohos_cef_ext",
  cef: "foundation/web/arkweb/ohos_cef_ext",
  libcef: "foundation/web/arkweb/ohos_cef_ext/libcef",
  chromium_cef: "foundation/web/arkweb/ohos_cef_ext",
  chromium_src: "third_party/chromium",
  netmanager_base: "foundation/communication/netmanager_base",
  netmanager_ext: "foundation/communication/netmanager_ext",
  wifi: "foundation/communication/wifi",
  communication_wifi: "foundation/communication/wifi",
  filemanagement_storage_service: "foundation/filemanagement/storage_service",
  storage_service: "foundation/filemanagement/storage_service",
  multimedia_audio_framework: "foundation/multimedia/audio_framework",
  arkcompiler_ets_runtime: "arkcompiler/ets_runtime",
  ets_runtime: "arkcompiler/ets_runtime",
  drivers_peripheral: "drivers/peripheral",
  drivers_hdf_core: "drivers/hdf_core",
  device_auth: "foundation/device_standby/device_standby",
  keystore: "foundation/security/certificate_manager",
  certificate_manager: "foundation/security/certificate_manager",
  update_sys_installer: "foundation/update/update_sys_installer",
};

/** 判断 modulePath 是否已是标准完整路径 */
function isFullPath(p) {
  return /^(foundation|drivers|arkcompiler|base|third_party)\//.test(p);
}

/** 按文件名匹配已知模块归属 */
const FILE_MODULE_MAP = [
  { re: /cert_mgr_adapter/i, prefix: "foundation/web/web_webview/ohos_adapter/cert_mgr_adapter" },
  { re: /net_manager_native|netsys_sock|netmanagernative/i, prefix: "foundation/communication/netmanager_base/services/netmanagernative" },
  { re: /ipc_service/i, prefix: "foundation/communication/netmanager_base" },
  { re: /audio_service|i_audio_stream|hpae_pcm/i, prefix: "foundation/multimedia/audio_framework" },
  { re: /sensor_event_callback|sensor_service/i, prefix: "drivers/peripheral/sensor" },
  { re: /runtime_stubs|js_proxy|stable_array|containers_buffer|gc_bitset|builtins_typedarray/i, prefix: "arkcompiler/ets_runtime/ecmascript" },
  { re: /medical_native/i, prefix: "foundation/multimedia/medical" },
  { re: /external_volume_info/i, prefix: "foundation/filemanagement/storage_service" },
  { re: /volume_manager|region_manager/i, prefix: "foundation/filemanagement/storage_service/services/storage_manager" },
  { re: /drm_connector/i, prefix: "drivers/peripheral/display" },
  { re: /wifi_hdi/i, prefix: "drivers/peripheral/wlan" },
  { re: /storage_manager_provider/i, prefix: "foundation/filemanagement/storage_service" },
  { re: /cj_cert_manager/i, prefix: "foundation/web/web_webview" },
  { re: /hc_file_posix/i, prefix: "foundation/distributeddatamgr/device_auth" },
  { re: /process\.cpp|shared_cc/i, prefix: "arkcompiler/ets_runtime" },
  { re: /containers_vector|containers_buffer/i, prefix: "arkcompiler/ets_runtime/ecmascript/containers" },
  { re: /medical_data_processer/i, prefix: "foundation/multimedia/medical" },
  { re: /fastbuffer|jitfort/i, prefix: "arkcompiler/ets_runtime" },
  { re: /icu/i, prefix: "third_party/icu" },
  { re: /Base64Decode/i, prefix: "base/security" },
  { re: /napi_ref/i, prefix: "foundation/web/web_webview" },
];

export function normalizeModulePath(raw) {
  let p = (raw ?? "").trim().replace(/^[\/\\]+/, "").replace(/\/+$/, "");
  if (!p) return "unknown";
  if (isFullPath(p)) return p;

  // 仓库名映射
  for (const [repo, prefix] of Object.entries(REPO_TO_PREFIX)) {
    if (p === repo || p.startsWith(repo + "/")) {
      const rest = p.slice(repo.length);
      return prefix + rest;
    }
  }

  // 文件名归属
  for (const { re, prefix } of FILE_MODULE_MAP) {
    if (re.test(p)) {
      const fileName = p.split("/").pop();
      return fileName && fileName !== p ? `${prefix}/${fileName}` : prefix;
    }
  }

  // 未知但含明显文件名
  if (/\.(cpp|h|c|cc|java)$/.test(p) && !p.includes("/")) {
    return `unknown/${p}`;
  }

  // 直接以 ecmascript/ 开头 → arkcompiler
  if (p.startsWith("ecmascript/")) return `arkcompiler/ets_runtime/${p}`;
  // NWeb / container / builtins 等 arkweb/ark 相关
  if (p === "NWeb" || p.startsWith("NWeb/")) return `foundation/web/arkweb/${p}`;
  if (/^ComputeElementIdAndBitId|container$|builtins/.test(p)) return `arkcompiler/ets_runtime/ecmascript/${p}`;
  if (p.startsWith("chromium_cef")) return `foundation/web/arkweb/ohos_cef_ext/${p}`;

  return p;
}

export function normalizeKnowledgeBase(kbPath) {
  const kb = JSON.parse(readFileSync(kbPath, "utf8"));
  let changed = 0;
  kb.patterns.forEach((p) => {
    const np = normalizeModulePath(p.modulePath);
    if (np !== p.modulePath) {
      p.modulePath = np;
      changed++;
    }
  });
  writeFileSync(kbPath, JSON.stringify(kb, null, 2), "utf8");
  return { changed, total: kb.patterns.length };
}

// CLI 直接执行
if (process.argv[1]?.endsWith("normalize-knowledge.js")) {
  const kbPath = process.argv[2] || join(process.cwd(), "packages", "resources", "knowledge", "nday-patterns.json");
  const r = normalizeKnowledgeBase(kbPath);
  console.log(`规范化完成: ${r.changed}/${r.total} 条 modulePath 已修正`);
}
