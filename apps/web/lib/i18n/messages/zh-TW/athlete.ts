import type { AthleteMessages } from "../en/athlete.ts";

// Traditional Chinese (Taiwan) for the training surfaces.
//
// Strength-training terminology follows what Taiwan coaches actually say on
// the gym floor, not a literal rendering of the English:
//   set  → 組        reps → 次（欄位標題用「次數」）
//   load → 重量      RPE  → RPE（原文照用，教練圈通行）
//   exercise → 動作  workout / session → 訓練、課表
//   planned → 預定   actual → 實際      extra set → 額外組
//   bodyweight → 徒手
// The full list is in the sub-task 5 completion report for founder review
// (task doc §3 sub-task 7). Do not adjust a domain term here without that
// review — these are the words a coach will read mid-session.
//
// Counting phrases keep the Chinese measure word next to the number
// (「第 3 組」, 「預定 4 組」) instead of copying the English order, which is
// why the one-set and many-sets keys share a single Chinese sentence.
export const athlete: AthleteMessages = {
  // --- /today ---------------------------------------------------------
  "athlete.today.account": "帳號",
  "athlete.today.eyebrowToday": "今天",
  "athlete.today.eyebrowTraining": "訓練",
  "athlete.today.previousDay": "前一天",
  "athlete.today.nextDay": "後一天",
  "athlete.today.jumpToToday": "回到今天",
  "athlete.today.subtitle": "你的訓練，由教練安排。",
  "athlete.today.loading": "正在載入你的訓練安排…",
  "athlete.today.emptyTodayTitle": "今天沒有訓練",
  "athlete.today.emptyTodayBody": "今天沒有安排訓練課程。",
  "athlete.today.emptyDateTitle": "這天沒有訓練",
  "athlete.today.emptyDateBody": "這個日期沒有安排訓練課程。",
  "athlete.today.workoutEyebrow": "你的課表",
  "athlete.today.exerciseSummaryOne": "{count} 個動作 · 由教練為你安排在這一天",
  "athlete.today.exerciseSummaryOther": "{count} 個動作 · 由教練為你安排在這一天",
  "athlete.today.startWorkout": "開始訓練",
  "athlete.today.startingWorkout": "開始訓練中…",
  "athlete.today.resumeWorkout": "繼續訓練",
  "athlete.today.viewResult": "查看結果",

  // --- planned-set preview (/today) -----------------------------------
  "athlete.plan.none": "沒有預定組數",
  "athlete.plan.setCountOne": "{count} 組",
  "athlete.plan.setCountOther": "{count} 組",
  "athlete.plan.plannedSetCount": "預定 {count} 組",
  "athlete.coachCue": "教練提示：",

  // --- shared set vocabulary (both pages) -----------------------------
  "athlete.set.label": "第 {position} 組",
  "athlete.set.labelOfTotal": "第 {position} 組／共 {total} 組",
  "athlete.set.reps": "{count} 次",
  "athlete.set.bodyweight": "徒手",

  "athlete.status.active": "進行中",
  "athlete.status.completed": "已完成",

  // --- /session/[id] --------------------------------------------------
  "athlete.session.eyebrow": "訓練課程",
  "athlete.session.live": "訓練進行中",
  "athlete.session.finished": "訓練已完成",
  "athlete.session.exerciseEyebrow": "動作",
  "athlete.session.plannedSetCountOne": "預定 {count} 組",
  "athlete.session.plannedSetCountOther": "預定 {count} 組",
  "athlete.session.setCompleted": "已完成",
  "athlete.session.setNext": "正在記錄",
  "athlete.session.setNotLogged": "尚未記錄",
  "athlete.session.target": "目標",
  "athlete.session.actual": "實際",
  "athlete.session.loggedNumber": "已記錄 #{number}",
  "athlete.session.extraLoggedNumber": "額外組 · 已記錄 #{number}",
  "athlete.session.logThisSetInstead": "記錄",
  "athlete.session.expandExercise": "展開",
  "athlete.session.collapseExercise": "收合",
  "athlete.session.logSet": "記錄這一組",
  "athlete.session.loggingSet": "記錄中…",
  "athlete.session.extraSetsHeading": "額外組",
  "athlete.session.addExtraSet": "新增額外組",
  "athlete.session.logExtraSet": "記錄額外組",
  "athlete.session.completeHint": "訓練結束後，請完成這次訓練，把結果鎖定保存。",
  "athlete.session.completeWorkout": "完成訓練",
  "athlete.session.completingWorkout": "完成中…",
  "athlete.session.adjustHeading": "調整進行中的課表",
  "athlete.session.adjustHint": "可新增動作；既有處方不會被覆寫。",
  "athlete.session.addExercise": "新增動作",
  "athlete.session.addOwnExercise": "＋新增自己的動作",
  "athlete.session.adjustExercise": "動作",
  "athlete.session.replaceOptional": "取代現有動作（選填）",
  "athlete.session.addWithoutReplacing": "不取代，直接新增",
  "athlete.session.adjustSets": "組數",
  "athlete.session.adjustReps": "每組次數",
  "athlete.session.adjustLoad": "重量（選填，kg）",
  "athlete.session.adjustRpe": "RPE（選填）",
  "athlete.session.replaceAndAdd": "取代並加入",
  "athlete.session.addToWorkout": "加入本次訓練",
  "athlete.session.athleteAdded": "學生自主新增",
  "athlete.session.coachAdded": "教練臨時新增",
  "athlete.session.coachCueLabel": "教練提示",
  "athlete.session.coachCuePlaceholder": "例如：肩膀不要聳起，頂端停一秒",
  "athlete.session.noCoachCue": "尚未設定教練提示",
  "athlete.session.addCoachCue": "新增提示",
  "athlete.session.editCoachCue": "編輯提示",
  "athlete.session.cancelCoachCue": "取消",
  "athlete.session.saveCoachCue": "儲存提示",
  "athlete.session.progressSummary": "已完成 {completed}／{total} 組",
  "athlete.session.nextExercise": "下一個動作",
  "athlete.session.adjustSetsRepsInvalid": "請輸入有效的組數與次數。",
  "athlete.session.adjustNumbersInvalid": "請確認重量與 RPE 格式。",

  "athlete.session.fieldLoad": "重量",
  "athlete.session.fieldUnit": "單位",
  "athlete.session.fieldReps": "次數",
  "athlete.session.fieldActualRpe": "實際 RPE",
  "athlete.session.fieldOptional": "選填",
  "athlete.session.textPrescriptionHint": "請填入實際完成的次數。",

  "athlete.session.repsInvalid": "次數必須是大於或等於 1 的整數。",
  "athlete.session.loadInvalid": "重量必須是大於或等於 0 的數字。",
  "athlete.session.rpeInvalid": "實際 RPE 必須介於 1 到 10 之間。",
  "athlete.session.editSet": "編輯組數",
  "athlete.session.cancelEdit": "取消",
  "athlete.session.saveEdit": "儲存",
  "athlete.session.savingEdit": "儲存中…",
};
