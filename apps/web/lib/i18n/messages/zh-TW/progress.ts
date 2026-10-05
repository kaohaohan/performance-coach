import type { ProgressMessages } from "../en/progress.ts";

// 動作進度：圖表、所選紀錄卡與歷史時間軸，以及 /coach/clients/[athleteId]
// 的動作清單。用字保持中性：只呈現數字與系統算出的事件，不打分數、不貼
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

  "progress.clients.heading": "動作進度",
  "progress.clients.loading": "載入動作中…",
  "progress.clients.empty": "近 6 個月沒有已完成的動作。",
  "progress.clients.lastTrained": "最近 {date}",
  "progress.viewProgress": "查看進度",
};
