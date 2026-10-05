import type { ProgressMessages } from "../en/progress.ts";

// 動作進度：圖表、所選紀錄卡與歷史時間軸，以及 /coach/clients/[athleteId]
// 的總覽。用字保持中性：只呈現數字與系統算出的事件，不打分數、不貼
// 「進步中／持平／需檢視」之類標籤。PR、RIR、1RM 沿用英文。
export const progress: ProgressMessages = {
  "progress.title": "動作進度",
  "progress.loading": "載入進度中…",
  "progress.backToClient": "← 回到學員",
  "progress.backToToday": "← 回到今日",
  "progress.unknownExercise": "動作",

  "progress.metricLabel": "指標",
  "progress.metric.topSet": "最重組",
  "progress.metric.estimated1rm": "預估 1RM",
  "progress.metric.load": "重量",
  "progress.metric.reps": "次數",
  "progress.metric.volume": "訓練量",
  "progress.estimated1rmNote": "以最重組估算：重量 × (1 + (次數 + RIR) / 30)。這是計算值，不是實測最大重量。",

  "progress.rangeLabel": "範圍",
  "progress.range.3m": "3 個月",
  "progress.range.1y": "1 年",
  "progress.range.all": "全部",

  "progress.unitHeading": "以 {unit} 記錄",
  "progress.chartLabel": "{metric}變化（{unit}）",
  "progress.legend.otherCoach": "空心點＝其他教練期間的紀錄",
  "progress.noPoints": "此範圍內這個指標沒有可繪製的資料。",
  "progress.empty": "此範圍內沒有已完成且有重量的組數。",

  "progress.selected.heading": "所選訓練",
  "progress.selected.previous": "上一次訓練",
  "progress.selected.firstTime": "以 {unit} 記錄的第一筆。",

  "progress.timeline.heading": "歷史紀錄",
  "progress.position": "第 {position} 個動作",
  "progress.otherCoach": "其他教練",
  "progress.openSession": "開啟訓練",

  "progress.loadEarlier": "載入更早紀錄",
  "progress.loadingEarlier": "載入中…",
  "progress.noEarlier": "沒有更早的紀錄了。",

  "progress.event.loadPr": "重量 PR",
  "progress.event.repPr": "次數 PR · {load} {unit} × {reps}",
  "progress.event.repPrBodyweight": "次數 PR · {reps}",
  "progress.event.matched": "與上次相同",
  "progress.event.repsDown": "次數 ↓ {from}→{to}",

  "progress.overview.heading": "總覽",
  "progress.overview.loading": "載入總覽中…",
  "progress.overview.error": "無法載入總覽。",
  "progress.overview.empty": "近 {weeks} 週沒有已完成且有重量的動作。",
  "progress.overview.scopeNote": "完成率與組數只計算你排的課；動作數據包含任何教練期間的訓練。",
  "progress.overview.completion": "完成率",
  "progress.overview.completionDetail": "{scheduled} 堂中完成 {completed} 堂",
  "progress.overview.noAssignments": "你沒有排課",
  "progress.overview.sets": "計畫組數 vs 完成組數",
  "progress.overview.setsValue": "{completed} / {planned} 組",
  "progress.overview.extraSets": "另加 {count} 組",
  "progress.overview.prs": "PR · 近 28 天",
  "progress.overview.prsDetail": "次數 PR 與重量 PR",
  "progress.overview.trendLabel": "每週預估 1RM，近 {weeks} 週",
  "progress.overview.chip.repPr": "次數 PR",
  "progress.overview.chip.loadUp": "↑ 重量",
  "progress.viewProgress": "查看進度",

  // 跨教練可見性揭露（加入流程與隱私權政策）。
  "progress.disclosure.join":
    "每位與你連結的教練都能看到你完整的訓練紀錄，包括你和其他教練一起進行的訓練。教練看到其他教練的訓練時，只會看到日期、動作與組數。",
  "progress.disclosure.privacyLink": "隱私權政策",
  "privacy.trainingLog.heading": "訓練紀錄的可見範圍",
  "privacy.trainingLog.body1":
    "每位在 PumpLoop 與你連結的教練，都能看到你完整的訓練紀錄，包括你和其他教練一起進行的訓練，以便教練了解你的訓練歷史與長期進度。",
  "privacy.trainingLog.body2":
    "在其他教練名下記錄的訓練，連結的教練只會看到實際執行內容：日期、動作與各組（重量、單位、次數、RIR），不會看到其他教練的名字、課表名稱、教練提示或預定處方。你永遠能看到自己的全部歷史。",
};
