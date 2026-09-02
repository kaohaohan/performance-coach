// Traditional Chinese (zh-TW) message catalog.
//
// Typed as a full Catalog rather than Partial<Catalog>: a key added to en.ts
// without a translation here is a compile error, which is what keeps the two
// catalogs in step. The runtime fallback in translate() still exists, but it
// is a safety net for a bad deploy, not a workflow — a half-translated screen
// is exactly what the pilot coaches would report as a bug.
//
// Terminology note: strength-training vocabulary (組/次/重量/RPE) has
// established usage among Taiwan coaches and is founder-reviewed per
// docs/tasks/2026-08-27-i18n-zh-tw.md §3 sub-task 7 — do not machine-translate
// domain terms into this file without that review.
import type { Catalog } from "./en.ts";

export const zhTW: Catalog = {
  "common.loading": "載入中…",
  "common.save": "儲存",
  "common.saving": "儲存中…",
  "common.cancel": "取消",
  "common.close": "關閉",
  "common.done": "完成",
  "common.back": "返回",
  "common.edit": "編輯",
  "common.add": "新增",
  "common.remove": "移除",
  "common.delete": "刪除",
  "common.retry": "重試",

  "settings.language.heading": "語言",
  "settings.language.description": "僅套用於這台裝置。",
  "settings.language.label": "介面語言",

  "errors.network": "無法連線到伺服器，請檢查網路後再試一次。",
  "errors.unexpected": "發生問題，請再試一次。",
};
