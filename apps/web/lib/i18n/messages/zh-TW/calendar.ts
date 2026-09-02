// Traditional Chinese for the Coach Calendar.
//
// Domain terminology is fixed here and is the list the founder reviews per
// task doc §3 sub-task 7. The choices, once, so they are not re-litigated
// string by string:
//
//   Workout            課表        the thing assigned to a day
//   Exercise           動作        a movement; the library is 動作庫
//   Sets               組數        one set is 第 N 組
//   Reps               次數        a count of reps reads "{n} 次"
//   Load               重量
//   RPE                RPE         left in Latin — Taiwan coaches say "RPE"
//   Unit               單位        kg / lb themselves stay untranslated
//   Prescription       指定方式    the Reps-vs-Text choice
//   Instruction        指示        the free-text prescription
//   Planned sets       各組設定
//   Athlete / Client   學員        one word for both, as both mean the
//                                  person being coached
//   Assign             指派
//   Draft              草稿
//   Session            訓練        "Start Session" is 開始訓練
//   Duplicate          複製
//
// Chinese has no plural inflection, so every …One / …Other English pair maps
// to the same sentence here. That is intentional duplication, not an
// oversight — the split exists to keep English from being assembled out of
// fragments.
import type { CalendarMessages } from "../en/calendar.ts";

export const calendar: CalendarMessages = {
  // ── Page chrome ──────────────────────────────────────────────────────────
  "calendar.title": "行事曆",
  "calendar.nav.label": "教練工具",
  "calendar.nav.menuLabel": "教練工具選單",
  "calendar.nav.workouts": "課表",
  "calendar.nav.exercises": "動作庫",
  "calendar.nav.clients": "學員",
  "calendar.nav.account": "帳號",

  "calendar.athletes.loading": "載入學員中…",
  "calendar.athletes.none": "尚無已連結的學員",
  "calendar.athleteCalendar": "學員行事曆",
  "calendar.anotherAthlete": "其他學員",
  "calendar.thisAthlete": "這位學員",

  // ── View toolbar ─────────────────────────────────────────────────────────
  "calendar.toolbar.previousDay": "前一天",
  "calendar.toolbar.previousWeek": "前一週",
  "calendar.toolbar.previousMonth": "前一個月",
  "calendar.toolbar.nextDay": "後一天",
  "calendar.toolbar.nextWeek": "後一週",
  "calendar.toolbar.nextMonth": "後一個月",
  "calendar.toolbar.today": "今天",
  "calendar.toolbar.viewLabel": "行事曆檢視",
  "calendar.view.day": "日",
  "calendar.view.week": "週",
  "calendar.view.month": "月",

  // ── Day view: mini month picker ──────────────────────────────────────────
  "calendar.previousMonth": "前一個月",
  "calendar.nextMonth": "後一個月",
  "calendar.day.ariaScheduled": "{date}，已排定訓練",
  "calendar.day.ariaDraft": "{date}，有草稿進行中",
  "calendar.day.ariaScheduledAndDraft": "{date}，已排定訓練，有草稿進行中",

  // ── Day view: selected day ───────────────────────────────────────────────
  "calendar.scheduledCountOne": "已排定 1 份課表",
  "calendar.scheduledCountOther": "已排定 {count} 份課表",
  "calendar.addWorkout": "新增課表",
  "calendar.addWorkoutAction": "+ 新增課表",
  "calendar.editWorkout": "編輯課表",
  "calendar.loadingScheduled": "載入已排定訓練…",
  "calendar.empty.title": "尚未排定課表",
  "calendar.empty.body": "為這位學員的所選日期新增課表。",
  "calendar.saveChangesSuccess": "已儲存變更，學員會立即看到更新後的訓練內容。",

  "calendar.status.active": "進行中",
  "calendar.status.completed": "已完成",
  "calendar.status.notStarted": "未開始",
  "calendar.opening": "開啟中…",
  "calendar.removing": "移除中…",
  "calendar.starting": "開始中…",
  "calendar.startSession": "開始訓練",
  "calendar.resume": "繼續訓練",
  "calendar.review": "檢視",

  // ── Draft chip / banners ─────────────────────────────────────────────────
  "calendar.draft.inProgress": "草稿進行中 · {date}",
  "calendar.draft.inProgressWithAthlete": "草稿進行中 · {name} · {date}",
  "calendar.draft.continue": "繼續草稿",
  "calendar.draft.continueFor": "繼續 {name}",
  "calendar.draft.startNew": "建立新的",
  "calendar.draft.startNewFor": "為 {name} 建立新的",
  "calendar.draft.restored": "已還原上次的草稿。",
  "calendar.draft.restoredRecheck": "已還原上次的草稿，請重新確認這份課表要指派給誰。",
  "calendar.draft.save": "儲存草稿",
  "calendar.draft.saved": "已儲存 ✓",
  "calendar.draft.savedJustNow": "草稿剛剛已儲存",
  "calendar.draft.savedAt": "草稿已於 {time} 儲存",
  "calendar.draft.saveFailed": "無法在瀏覽器中儲存這份草稿。",
  "calendar.draft.discard": "捨棄草稿",
  "calendar.draft.discardConfirm": "要捨棄這份草稿嗎？編輯器中所有未儲存的內容將永久刪除。",

  // ── Builder ──────────────────────────────────────────────────────────────
  "calendar.builder.draftFor": "這份草稿是為 {name} 在 {date} 建立的。",
  "calendar.builder.moveToDate": "移到 {date}",
  "calendar.builder.editingNotice":
    "正在編輯 {name} 已指派的課表。這只會取代這一筆指派，可重複使用的課表範本以及其他學員的副本都不受影響。",
  "calendar.mode.existing": "從已儲存課表",
  "calendar.mode.build": "新建課表",
  "calendar.assignTo": "指派給",
  "calendar.workout": "課表",
  "calendar.loadingWorkouts": "載入課表中…",
  "calendar.noSavedWorkouts.title": "尚未儲存任何課表",
  "calendar.noSavedWorkouts.body": "請選擇上方的「新增課表」，在這裡建立並指派課表。",
  "calendar.chooseWorkout": "選擇課表…",
  "calendar.assign.assigning": "指派課表中…",
  "calendar.assign.buttonOne": "指派給 {count} 位學員",
  "calendar.assign.buttonOther": "指派給 {count} 位學員",
  "calendar.workoutNameLabel": "新增課表名稱",
  "calendar.workoutNamePlaceholder": "新增課表名稱",
  "calendar.optional": "選填",
  "calendar.exercises": "動作",
  "calendar.exercisesAdded": "已新增 {count} 個",
  "calendar.addExercise": "+ 新增動作",
  "calendar.build.createdNotAssigned": "課表已建立，但尚未指派。",
  "calendar.build.retryAssignment": "重試指派",
  "calendar.build.creating": "建立課表中…",
  "calendar.build.assign": "指派",
  "calendar.build.saveChanges": "儲存變更",
  "calendar.build.savingChanges": "儲存變更中…",

  // ── Exercise card ────────────────────────────────────────────────────────
  "calendar.exercise.number": "動作 {number}",
  "calendar.exercise.mine": "自建",
  "calendar.field.sets": "組數",
  "calendar.field.prescription": "指定方式",
  "calendar.field.instruction": "指示",
  "calendar.field.instructionPlaceholder": "AMAP、30 秒、10–12",
  "calendar.field.reps": "次數",
  "calendar.field.repsHintLabel": "關於次數",
  "calendar.field.repsHint":
    "次數只接受一個整數，並套用到每一組。若要使用 8-12、8+、AMAP 或計時組，請將「指定方式」切換為「文字」；也可以在「各組設定」中編輯單一組別，讓各組次數不同。",
  "calendar.field.load": "重量",
  "calendar.field.unit": "單位",
  "calendar.prescription.reps": "次數",
  "calendar.prescription.text": "文字",
  "calendar.plannedSets": "各組設定",
  "calendar.setNumber": "第 {position} 組",
  "calendar.setSummaryReps": "{reps} 次",
  "calendar.useDefault": "使用預設值",
  "calendar.useDefaultLoad": "使用預設重量",
  "calendar.useDefaultRpe": "使用預設 RPE",
  "calendar.moveUp": "上移",
  "calendar.moveDown": "下移",

  // ── Exercise picker ──────────────────────────────────────────────────────
  "calendar.picker.title": "新增動作",
  "calendar.picker.searchLabel": "搜尋動作",
  "calendar.picker.searchPlaceholder": "搜尋動作…",
  "calendar.picker.startTyping": "開始輸入以尋找動作。",
  "calendar.picker.loading": "載入動作中…",
  "calendar.picker.noneFound": "找不到動作。",
  "calendar.picker.noneFoundBody": "建立這個動作，或管理你的動作庫。",
  "calendar.picker.openLibrary": "開啟動作庫",
  "calendar.picker.allAdded": "符合的動作都已加入。",
  "calendar.picker.create": "建立「{name}」",
  "calendar.picker.creating": "建立中…",
  "calendar.picker.systemGroup": "系統動作",
  "calendar.picker.myGroup": "我的動作",
  "calendar.picker.added": "已加入",
  "calendar.picker.moreResultsOne": "還有 1 筆結果，繼續輸入以縮小範圍。",
  "calendar.picker.moreResultsOther": "還有 {count} 筆結果，繼續輸入以縮小範圍。",
  "calendar.picker.updating": "更新動作中…",
  "calendar.picker.existsUnavailable": "「{name}」已存在，但無法加入。",
  "calendar.picker.createFailed": "無法建立「{name}」。{reason}",

  // ── Validation ───────────────────────────────────────────────────────────
  "calendar.validation.setsRequired": "組數為必填，請輸入至少 1 的整數。",
  "calendar.validation.setsWhole": "請輸入至少 1 的整數。",
  "calendar.validation.repsRequired":
    "次數為必填 — 請輸入一個整數，例如 8。若要使用 8-12、8+、AMAP 或計時組，請將這個動作的「指定方式」切換為「文字」。",
  "calendar.validation.repsFormat":
    "「{value}」不是整數。次數只接受一個數字，例如 8。若要使用 8-12、8+、AMAP 或計時組，請將這個動作的「指定方式」切換為「文字」。",
  "calendar.validation.repsMin": "次數至少為 1。",
  "calendar.validation.instructionRequired": "指示為必填。",
  "calendar.validation.loadMin": "重量必須大於或等於 0。",
  "calendar.validation.rpeRange": "RPE 必須介於 1 到 10 之間。",
  "calendar.validation.setOutsideCount": "第 {position} 組超出目前的組數範圍。",
  "calendar.validation.setBothRepsAndText": "這一組同時有次數和文字 — 請擇一。",
  "calendar.validation.removeOverridesFirst": "請先移除超過新組數的個別設定，再減少組數。",
  "calendar.validation.addExercise": "請至少新增一個動作。",
  "calendar.validation.chooseValidDate": "請選擇有效的日期。",
  "calendar.validation.selectAthlete": "請至少選擇一位學員。",

  // ── Assignment result / errors ───────────────────────────────────────────
  "calendar.assignedSummaryOne": "已將「{name}」指派給 1 位學員，日期為 {date}。",
  "calendar.assignedSummaryOther": "已將「{name}」指派給 {count} 位學員，日期為 {date}。",
  "calendar.errors.alreadyStartedRemove": "這份課表已經開始，無法再移除。",
  "calendar.errors.alreadyStartedEdit": "這份課表已經開始，無法再編輯。",

  // ── Day card (week / month grids) ────────────────────────────────────────
  "calendar.dayCard.setCountOne": "1 組",
  "calendar.dayCard.setCountOther": "{count} 組",
  "calendar.dayCard.statusDone": "已完成",
  "calendar.dayCard.statusInProgress": "進行中",
  "calendar.dayCard.statusNotStarted": "未開始",
  "calendar.dayCard.duplicateFrom": "複製 {date} 的課表",
  "calendar.dayCard.duplicateTitle": "複製課表",
  "calendar.dayCard.noTraining": "沒有訓練",
  "calendar.dayCard.prescriptionUnavailable": "無法取得訓練內容",

  // ── Duplicate day panel ──────────────────────────────────────────────────
  "calendar.duplicate.title": "複製課表",
  "calendar.duplicate.from": "來自 {date}",
  "calendar.duplicate.sourceWorkouts": "來源課表",
  "calendar.duplicate.loadingWorkouts": "載入課表中…",
  "calendar.duplicate.noWorkouts": "這個日期沒有排定課表。",
  "calendar.duplicate.exerciseCountOne": "1 個動作",
  "calendar.duplicate.exerciseCountOther": "{count} 個動作",
  "calendar.duplicate.moreExercises": "{names} · 還有 {count} 個",
  "calendar.duplicate.exerciseDetailsUnavailable": "無法取得動作細節",
  "calendar.duplicate.clients": "學員",
  "calendar.duplicate.searchClients": "搜尋學員",
  "calendar.duplicate.selectedOne": "已選擇（{count} 位學員）",
  "calendar.duplicate.selectedOther": "已選擇（{count} 位學員）",
  "calendar.duplicate.selectClient": "請至少選擇一位學員。",
  "calendar.duplicate.noClientsMatch": "沒有符合的學員。",
  "calendar.duplicate.targetDate": "目標日期",
  "calendar.duplicate.summaryOneOne": "將有 1 份課表複製給 1 位學員，日期為 {date}。",
  "calendar.duplicate.summaryOneOther": "將有 1 份課表複製給 {clients} 位學員，日期為 {date}。",
  "calendar.duplicate.summaryOtherOne": "將有 {workouts} 份課表複製給 1 位學員，日期為 {date}。",
  "calendar.duplicate.summaryOtherOther":
    "將有 {workouts} 份課表複製給 {clients} 位學員，日期為 {date}。",
  "calendar.duplicate.submit": "複製",
  "calendar.duplicate.submitting": "複製中…",
  "calendar.duplicate.showCalendar": "顯示日曆",
  "calendar.duplicate.hideCalendar": "隱藏日曆",
  "calendar.duplicate.unnamedWorkout": "某份課表",
  "calendar.duplicate.partialFailure":
    "{total} 份中有 {failed} 份無法複製（{names}）。{error} 請按「複製」只重試這些。",

  // ── Dialogs ──────────────────────────────────────────────────────────────
  "calendar.dialog.alreadyScheduledTitle": "已排定",
  "calendar.dialog.alreadyScheduledBody":
    "再次排定會在那一天建立第二筆獨立的副本 — 如果是一日兩練，這正是你要的；否則多半不是。",
  "calendar.dialog.scheduleAnyway": "仍要排定",
  "calendar.dialog.removeTitle": "要移除這份課表嗎？",
  "calendar.dialog.removeBody":
    "這會將 {workout} 從 {athlete} 的 {date} 移除。那一天的其他內容不受影響，課表本身也會留在你的課表庫中，可以再次指派。",
  "calendar.dialog.removeConfirm": "移除課表",
  "calendar.dialog.removeCancel": "保留",
  "calendar.dialog.unfinishedDraftTitle": "未完成的草稿",
  "calendar.dialog.unfinishedDraftBody":
    "你有一份未完成的草稿：{draft}。為 {target} 建立新課表後，這份草稿會保留，直到你為新課表加入名稱或動作為止。",
  "calendar.dialog.closeBuilderTitle": "要關閉編輯器嗎？",
  "calendar.dialog.navBodyDate":
    "你的草稿已儲存，仍排定在 {date} — 不會遺失。前往 {target} 只會關閉編輯器；隨時可以用「{label}」重新開啟。",
  "calendar.dialog.navBodyAthlete":
    "你的草稿已儲存，仍排定在 {date} — 不會遺失。切換到 {target} 只會關閉編輯器；用「{label}」重新開啟即可繼續。",
  "calendar.dialog.navBodyViewDay":
    "你的草稿已儲存，仍排定在 {date} — 不會遺失。切換到日檢視只會關閉編輯器；用「{label}」重新開啟即可繼續。",
  "calendar.dialog.navBodyViewWeek":
    "你的草稿已儲存，仍排定在 {date} — 不會遺失。切換到週檢視只會關閉編輯器；用「{label}」重新開啟即可繼續。",
  "calendar.dialog.navBodyViewMonth":
    "你的草稿已儲存，仍排定在 {date} — 不會遺失。切換到月檢視只會關閉編輯器；用「{label}」重新開啟即可繼續。",
  "calendar.dialog.navConfirmDate": "前往那一天",
  "calendar.dialog.navConfirmAthlete": "切換學員",
  "calendar.dialog.navConfirmView": "切換檢視",
  "calendar.dialog.navCancel": "繼續編輯",
};
