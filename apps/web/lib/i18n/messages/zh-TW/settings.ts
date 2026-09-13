import type { SettingsMessages } from "../en/settings.ts";

// Traditional Chinese (Taiwan) for /settings.
//
// The two deletion paragraphs are translated to preserve meaning rather than
// sentence shape: each one still states, in this order, that sign-in access
// is permanently lost, that personal identity is removed, and that training
// records already shared with the other party may remain in anonymised form
// (Guideline 5.1.1(v) — see the English file and
// docs/tasks/2026-08-26-account-deletion.md). 「匿名化」 is the standard
// zh-TW rendering of "anonymized" and is what keeps the third clause true
// rather than sounding like the history is deleted too.
export const settings: SettingsMessages = {
  "settings.heading": "帳號",
  "settings.subtitle": "你的 PumpLoop 帳號。",
  "settings.backToToday": "← 今天",
  "settings.backToCalendar": "← 教練行事曆",
  "settings.signedInAs": "目前登入身分",
  "settings.roleCoach": "教練",
  "settings.roleAthlete": "學員",

  "settings.language.heading": "語言",
  "settings.language.description": "僅套用於這台裝置。",
  "settings.language.label": "介面語言",

  "settings.delete.heading": "刪除帳號",
  "settings.delete.description":
    "刪除後，你將永久無法再登入。你的姓名與個人帳號資料會被移除。你與教練或學員之間已共用的訓練紀錄，可能會以匿名化的形式保留。",
  "settings.delete.button": "刪除帳號",
  "settings.delete.pending": "刪除帳號中…",
  "settings.delete.confirmTitle": "確定要刪除帳號嗎？",
  "settings.delete.confirmBody":
    "你將無法再登入。你的個人帳號身分會被移除。已與教練或學員正當共用的訓練紀錄，可能會以匿名化的形式保留。",
  "settings.delete.passwordLabel": "密碼",
  "settings.delete.passwordRequired": "請輸入密碼以刪除帳號。",
  "settings.delete.failed": "無法刪除你的帳號，請檢查網路後再試一次。",
};
