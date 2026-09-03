import type { ErrorMessages } from "../en/errors.ts";

// Traditional Chinese (Taiwan). Error copy is read by someone who is already
// stuck, so every line names what happened and what to do next — the same
// contract the English copy keeps. 「以 Apple 登入」 is Apple's own zh-TW
// wording for the feature and is quoted as a proper noun rather than
// translated freely.
export const errors: ErrorMessages = {
  "errors.network": "無法連線到伺服器，請檢查網路後再試一次。",
  "errors.unexpected": "發生問題，請再試一次。",

  "errors.auth.signInFailed": "登入失敗，請再試一次。",
  "errors.auth.invalidEmail": "請輸入有效的電子郵件地址。",
  "errors.auth.invalidCredentials": "電子郵件或密碼不正確。",
  "errors.auth.emailInUse": "這個電子郵件已經有帳號了，請改用登入。",
  "errors.auth.weakPassword": "密碼至少需要 8 個字元。",
  "errors.auth.tooManyRequests": "嘗試次數過多，請稍後再試。",
  "errors.auth.userDisabled": "這個帳號已被停用。",

  "errors.google.popupBlocked": "瀏覽器封鎖了登入視窗，請允許本網站顯示彈出式視窗後再試一次。",
  "errors.google.webStorageUnsupported":
    "瀏覽器封鎖了 Google 登入所需的儲存空間。請改用一般（非無痕）視窗，或使用電子郵件與密碼登入。",
  "errors.google.accountExists": "這個電子郵件已使用其他方式註冊，請改用電子郵件與密碼登入。",
  "errors.google.unavailable": "目前無法使用 Google 登入，請改用電子郵件與密碼登入，或聯絡你的教練。",
  "errors.google.failed": "Google 登入失敗，請再試一次。",

  "errors.apple.accountExists": "這個電子郵件已經有帳號，而且是用其他方式註冊的。請改用你當初註冊的方式登入。",
  "errors.apple.unavailable": "目前無法使用「以 Apple 登入」，請改用其他登入方式，或聯絡你的教練。",
  "errors.apple.failed": "「以 Apple 登入」失敗，請再試一次。",

  // 刪除帳號。每一句都必須維持與英文相同的兩項約束：不能讓人以為帳號其實已經
  // 被刪除，也不能讓人以為資料被保留；而且一定要說明下一步能做什麼。
  "errors.deletion.reauthFailed": "無法確認你的身分，請重新登入後再試著刪除帳號。",
  "errors.deletion.signedOut": "請重新登入後，再試著刪除帳號。",
  "errors.deletion.recentAuthRequired": "請重新確認身分後再試一次。",
  "errors.deletion.invalidRequest": "無法確認你的登入資訊，請再試一次。",
  "errors.deletion.appleCodeMissing": "無法確認你的 Apple 登入，請再試一次。",
  "errors.deletion.appleRequiresIos":
    "若要刪除使用「以 Apple 登入」的帳號，請開啟 {app} iOS App 後再試一次。",
  "errors.deletion.failed": "無法刪除你的帳號，請檢查網路連線後再試一次。",
};
