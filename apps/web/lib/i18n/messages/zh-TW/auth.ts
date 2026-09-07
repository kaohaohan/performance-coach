// 繁體中文（台灣）— /login、/coach/signup、/join、/join/[code]。
//
// Typed against ../en/auth.ts: an English key added without a translation
// here is a compile error, not a Chinese screen with an English sentence on
// it. Product names (Google、Apple、PumpLoop) are never translated.
import type { AuthMessages } from "../en/auth.ts";

export const auth: AuthMessages = {
  // --- 四個頁面共用 ---------------------------------------------------
  "auth.eyebrow": "教練與學員訓練",
  "auth.field.name": "姓名",
  "auth.field.email": "電子郵件",
  "auth.field.password": "密碼",
  "auth.continue": "繼續",
  "auth.signIn": "登入",
  "auth.signingIn": "登入中…",
  "auth.createAccount": "建立帳號",
  "auth.creatingAccount": "建立帳號中…",
  "auth.createCoachAccount": "建立教練帳號",
  "auth.haveAccount": "已經有帳號了嗎？",

  "auth.provider.google": "使用 Google 繼續",
  "auth.provider.googlePending": "正在開啟 Google…",
  "auth.provider.apple": "透過 Apple 登入",
  "auth.provider.applePending": "正在開啟 Apple…",
  "auth.divider.or": "或",

  // --- /login ---------------------------------------------------------
  "auth.login.heroTitleLine1": "訓練。",
  "auth.login.heroTitleLine2": "記錄。進步。",
  "auth.login.heroSubtitle": "為教練與學員打造的專注訓練空間。",
  "auth.login.heading": "登入",
  "auth.login.submit": "登入",
  "auth.login.submitting": "登入中…",
  "auth.login.inviteHint": "有邀請碼嗎？",
  "auth.login.inviteLink": "加入教練",
  "auth.login.noAccount.intro": "找不到符合這個登入方式的帳號。",
  "auth.login.noAccount.joinPrompt": "要加入教練嗎？",
  "auth.login.noAccount.joinLink": "使用你的邀請碼",
  "auth.login.noAccount.coachPrompt": "你是教練嗎？",
  "auth.login.noAccount.coachLink": "建立教練帳號",

  // --- /coach/signup ---------------------------------------------------
  "auth.coachSignup.heroTitleLine1": "打造你的",
  "auth.coachSignup.heroTitleLine2": "教練事業。",
  "auth.coachSignup.heroSubtitle": "建立教練帳號，開始安排課表並邀請學員。",
  "auth.coachSignup.confirmHeading": "確認你的名稱",
  "auth.coachSignup.confirmIntro": "你已使用 {provider} 登入。這是你的學員會看到的名稱。",
  "auth.coachSignup.nameMissingApple": "Apple 沒有提供你的名稱，請在上方輸入後繼續。",
  "auth.coachSignup.nameMissingProvider": "你的登入方式沒有提供名稱，請在上方輸入後繼續。",
  "auth.coachSignup.submitting": "建立帳號中…",
  "auth.coachSignup.retry": "重試帳號設定",
  "auth.coachSignup.retrying": "重試中…",
  "auth.coachSignup.useDifferentAccount": "使用其他帳號",
  "auth.coachSignup.error.nameRequired": "請輸入你的學員會看到的名稱。",
  "auth.coachSignup.error.sessionExpiredSignInAgain": "你的登入已過期，請重新登入。",
  "auth.coachSignup.error.sessionExpiredSignInInstead": "你的登入已過期，請改為直接登入。",
  "auth.coachSignup.error.athleteAccount":
    "這個帳號已註冊為學員。請改為登入，或使用其他帳號。",
  "auth.coachSignup.error.provisioningFailed":
    "你的帳號已建立，但我們無法完成設定。請再試一次。",
  "auth.coachSignup.error.provisioningFailedDetail":
    "你的帳號已建立，但我們無法完成設定：{detail}",
  "auth.coachSignup.error.retryFailed": "我們仍無法完成你的帳號設定。請再試一次。",
  "auth.coachSignup.error.retryFailedDetail": "我們仍無法完成你的帳號設定：{detail}",

  // --- /join ------------------------------------------------------------
  "auth.join.heroTitle": "加入你的教練。",
  "auth.join.heroSubtitle": "輸入教練傳給你的代碼。",
  "auth.join.codeLabel": "加入代碼",

  // --- /join/[code] -----------------------------------------------------
  "auth.joinCode.checkingInvite": "正在確認你的邀請…",
  "auth.joinCode.invalidHeading": "這個代碼無效。",
  "auth.joinCode.invalidBody": "代碼可能已過期或已被撤銷。請向教練索取新的連結。",
  "auth.joinCode.enterAnotherCode": "輸入其他代碼",
  "auth.joinCode.useAnotherCode": "使用其他代碼",
  "auth.joinCode.joining": "你正在加入",
  "auth.joinCode.checkingAccount": "正在確認你的帳號…",
  "auth.joinCode.coachSignedIn": "你目前是以教練身分登入。",
  "auth.joinCode.coachSignedInNamed": "你目前是以教練身分登入（{name}）。",
  "auth.joinCode.coachSignedInBody":
    "登出後即可用學員帳號加入 {coach}。這不會變更你的教練帳號。",
  "auth.joinCode.signOutAndContinue": "登出並繼續",
  "auth.joinCode.stayAsCoach": "維持以教練身分登入",
  "auth.joinCode.authTabsLabel": "登入或建立帳號",
  "auth.joinCode.connecting": "連結中…",
  "auth.joinCode.tryAgain": "再試一次",
  "auth.joinCode.connected": "你已成功連結到 {coach}。",
  "auth.joinCode.redirecting": "正在帶你前往訓練頁面…",
};
