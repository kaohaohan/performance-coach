import type { CoachMessages } from "../en/coach.ts";

// Traditional Chinese (Taiwan) for the coach surfaces except Calendar.
//
// Domain terminology, chosen for Taiwan strength coaches and listed in the
// sub-task 3 Completion Report for founder review (task doc §3 sub-task 7):
//
//   client / athlete (the people a coach manages) → 學員
//   workout (reusable template, and an assigned one)  → 課表
//   exercise / movement                              → 動作
//   set / sets                                       → 組 / 組數
//   reps                                             → 次數（值寫作「N 次」）
//   load                                             → 重量
//   session (a performed workout)                    → 訓練
//   invite code                                      → 邀請碼
//   RPE, kg, lb                                      → left as-is
//
// 學員 rather than 客戶: the repo's coach-facing UI deliberately says
// "client" rather than "athlete" (docs/tasks/2026-08-24-coach-client-
// terminology.md), and 學員 is the term Taiwan coaches use for the people
// they train. 客戶 would read as a commercial customer relationship, which
// is not what this product describes.
export const coach: CoachMessages = {
  "coach.nav.calendar": "← 教練行事曆",
  "coach.optional": "選填",

  "coach.col.name": "姓名",
  "coach.col.status": "狀態",
  "coach.col.actions": "操作",
  "coach.col.description": "說明",
  "coach.col.joinCode": "加入代碼",
  "coach.col.expires": "到期日",

  "coach.session.start": "開始訓練",
  "coach.session.starting": "開始中…",
  "coach.session.resume": "繼續",
  "coach.session.review": "查看紀錄",

  // Chinese has no letter case, so the client-detail page's raw-enum chips
  // and the history list's sentence-case chips land on the same three
  // words. That is the intended reading — the English drift between the two
  // screens does not need to be reproduced here.
  "coach.sessionStatus.notStarted": "尚未開始",
  "coach.sessionStatus.active": "進行中",
  "coach.sessionStatus.completed": "已完成",

  "coach.historyStatus.notStarted": "尚未開始",
  "coach.historyStatus.inProgress": "進行中",
  "coach.historyStatus.done": "已完成",

  "coach.scope.system": "系統",
  "coach.scope.private": "自訂",

  "coach.clients.title": "學員",
  "coach.clients.subtitle": "已與你連結的學員。",
  "coach.clients.sectionsNav": "學員頁面分頁",
  "coach.clients.tabAthletes": "學員",
  "coach.clients.tabCodes": "邀請碼",
  "coach.clients.inviteCta": "＋邀請學員",
  "coach.clients.loading": "正在載入已連結的學員…",
  "coach.clients.empty": "還沒有學員。建立一組邀請碼，再把連結傳給他們。",
  "coach.clients.search": "搜尋學員",
  "coach.clients.noMatch": "沒有符合「{query}」的學員。",
  "coach.clients.connected": "已連結",
  "coach.clients.removeAria": "移除 {name}",
  "coach.clients.removeTitle": "要移除 {name} 嗎？",
  "coach.clients.removeBody":
    "移除後，這位學員不會再出現在你的學員名單中，你也無法再為他安排新的訓練。既有的訓練紀錄不受影響。",

  "coach.invite.title": "邀請學員",
  "coach.invite.descriptionLabel": "說明（選填）",
  "coach.invite.descriptionPlaceholder": "秋季班",
  "coach.invite.descriptionHelp": "學員打開連結時會看到這段說明。",
  "coach.invite.expiresIn": "有效期限",
  "coach.invite.days": "{count} 天",
  "coach.invite.create": "建立邀請",
  "coach.invite.creating": "建立中…",
  "coach.invite.readyTitle": "邀請已建立",
  "coach.invite.joinCode": "加入代碼",
  "coach.invite.copyCode": "複製代碼",
  "coach.invite.inviteLink": "邀請連結",
  "coach.invite.copyLink": "複製連結",
  "coach.invite.copied": "已複製 ✓",
  "coach.invite.expiresOn": "到期日 {date}",
  "coach.invite.share": "可以用 LINE、WhatsApp 或電子郵件傳送。",

  "coach.codes.loading": "正在載入邀請碼…",
  "coach.codes.empty": "還沒有邀請碼。",
  "coach.codes.emptyHint": "請用上方的「＋邀請學員」建立一組。",
  "coach.codes.untitled": "邀請碼",
  "coach.codes.revoke": "撤銷",
  "coach.codes.revoking": "撤銷中…",
  "coach.codes.revokeTitle": "要撤銷這組邀請碼嗎？",
  "coach.codes.revokeBody": "{code} 將對尚未加入的人失效。已經加入的學員不受影響。",
  "coach.codeStatus.active": "有效",
  "coach.codeStatus.expired": "已過期",
  "coach.codeStatus.revoked": "已撤銷",

  "coach.clientDetail.loading": "正在載入已連結的學員…",
  "coach.clientDetail.notConnected": "這位學員未與你的帳號連結。",
  "coach.clientDetail.unknownName": "學員",
  "coach.clientDetail.subtitle": "學員訓練",
  "coach.clientDetail.back": "← 學員",
  "coach.clientDetail.trainingHeading": "訓練",
  "coach.clientDetail.loadingTraining": "正在載入訓練…",
  "coach.clientDetail.noTraining": "這段期間沒有安排訓練。",

  "coach.workouts.historyTitle": "課表紀錄",
  "coach.workouts.historySubtitle": "檢視所有學員過去的課表。",
  "coach.workouts.createCta": "＋建立課表",
  "coach.workouts.athleteFilter": "學員",
  "coach.workouts.allAthletes": "所有學員",
  "coach.workouts.dateRange": "日期範圍",
  "coach.workouts.range7": "最近 7 天",
  "coach.workouts.range30": "最近 30 天",
  "coach.workouts.range90": "最近 90 天",
  "coach.workouts.rangeAll": "全部時間",
  "coach.workouts.loadingHistory": "正在載入課表紀錄…",
  "coach.workouts.emptyHistory": "還沒有課表紀錄。",
  "coach.workouts.emptyForAthlete": "找不到這位學員的課表。",

  "coach.workouts.createTitle": "建立課表",
  "coach.workouts.createSubtitle": "建立可重複使用的訓練範本。",
  "coach.workouts.nameLabel": "課表名稱",
  "coach.workouts.exercisesEyebrow": "動作",
  "coach.workouts.prescriptionHeading": "訓練內容",
  "coach.workouts.addedCount": "已加入 {count} 個",
  "coach.workouts.addExercise": "＋新增動作",
  "coach.workouts.save": "儲存課表",
  "coach.workouts.saving": "儲存課表中…",

  "coach.workouts.exerciseIndex": "動作 {number}",
  "coach.workouts.sets": "組數",
  "coach.workouts.targetRpe": "目標 RPE",
  "coach.workouts.prescription": "指定方式",
  "coach.workouts.modeReps": "次數",
  "coach.workouts.modeText": "文字",
  "coach.workouts.instruction": "文字說明",
  "coach.workouts.instructionPlaceholder": "力竭、30 秒、10–12",
  "coach.workouts.reps": "次數",
  "coach.workouts.plannedLoad": "預定重量",
  "coach.workouts.load": "重量",
  "coach.workouts.unit": "單位",
  "coach.workouts.customizeSets": "自訂各組",
  "coach.workouts.hideSets": "收合各組設定",
  "coach.workouts.setNumber": "第 {number} 組",
  "coach.workouts.repsValue": "{value} 次",
  "coach.workouts.useDefault": "使用預設",
  "coach.workouts.useDefaultLoad": "使用預設重量",
  "coach.workouts.useDefaultRpe": "使用預設 RPE",
  "coach.workouts.moveUp": "上移",
  "coach.workouts.moveDown": "下移",

  "coach.workouts.error.nameRequired": "請輸入課表名稱。",
  "coach.workouts.error.exercisesRequired": "請至少加入一個動作。",
  "coach.workouts.error.wholeNumber": "請輸入至少為 1 的整數。",
  "coach.workouts.error.noteRequired": "請輸入文字說明。",
  "coach.workouts.error.load": "重量必須為 0 或以上。",
  "coach.workouts.error.rpe": "RPE 必須介於 1 到 10 之間。",
  "coach.workouts.error.setCountOverrides": "要減少組數前，請先移除超出新組數的個別設定。",
  "coach.workouts.error.overridePosition": "每個個別設定都必須在組數範圍內。",
  "coach.workouts.error.overrideMode": "每一組只能設定次數或文字其中一種，不能同時設定。",
  "coach.workouts.error.overrideReps": "個別次數必須是至少為 1 的整數。",
  "coach.workouts.error.overrideNote": "請輸入個別的文字說明。",
  "coach.workouts.error.overrideLoad": "個別重量必須為 0 或以上。",
  "coach.workouts.error.overrideRpe": "個別 RPE 必須介於 1 到 10 之間。",

  "coach.picker.title": "新增動作",
  "coach.picker.startTyping": "開始輸入即可搜尋動作。",
  "coach.picker.cantFind": "找不到你要的動作嗎？",
  "coach.picker.openLibrary": "開啟動作庫",
  "coach.picker.allAdded": "符合的動作都已經加入了。",
  "coach.picker.updating": "正在更新動作…",
  "coach.picker.added": "已加入",
  // Chinese does not inflect for number, so the two English plural forms
  // share one translation. Intentional — see the English file.
  "coach.picker.moreResultsOne": "還有 {count} 筆結果，繼續輸入以縮小範圍。",
  "coach.picker.moreResultsOther": "還有 {count} 筆結果，繼續輸入以縮小範圍。",

  "coach.exercises.title": "動作庫",
  "coach.exercises.subtitle": "管理你編排課表時使用的動作。",
  "coach.exercises.searchLabel": "搜尋動作",
  "coach.exercises.searchPlaceholder": "搜尋動作…",
  "coach.exercises.createCta": "＋建立動作",
  "coach.exercises.create": "建立動作",
  "coach.exercises.creating": "建立動作中…",
  "coach.exercises.nameLabel": "動作名稱",
  "coach.exercises.nameRequired": "請輸入動作名稱。",
  "coach.exercises.loading": "正在載入動作…",
  "coach.exercises.loadFailed": "無法載入動作。",
  "coach.exercises.noneFound": "找不到動作。",
  "coach.exercises.noneFoundHint": "請換個關鍵字搜尋，或建立新的動作。",
  "coach.exercises.systemTitle": "系統動作",
  "coach.exercises.systemEmpty": "目前還沒有系統動作。",
  "coach.exercises.privateTitle": "我的動作",
  "coach.exercises.privateEmpty": "你還沒有建立任何動作。",
};
