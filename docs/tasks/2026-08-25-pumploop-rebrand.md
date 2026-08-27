# Task: Rebrand web + iOS identity to PumpLoop, extract shared header components

- Date opened: 2026-08-25
- Related contract sections: §3 MVP Scope (no scope change), §7 Task Sizing, §9 Task Documentation
- Size (S/M/L/XL, per AGENTS.md §7): L

## 1. Feasibility Analysis

- Problem / trigger: The app header and browser/iOS identity still read "Performance Coach" (web, 10 hand-duplicated occurrences) and "PumpSlate" (iOS Capacitor shell). "PumpLoop" is the confirmed final product name. The duplicated string means every rename touches ten files.
- Options considered:
  1. Text swap only — replace the string in all 10 web files + iOS shell, no extraction.
  2. Text swap + extract a shared `BRAND_NAME` constant and shared header shells for the pages whose markup is genuinely identical (5-page hero family, 3-page pre-auth family); one-off headers (calendar app-bar, join/[code] shell) get the constant only.
  3. One fully configurable header component covering all 10 pages.
- Trade-offs (per option):
  1. Smallest diff, but the next rename repeats this exact 10-file hunt. Duplication stays.
  2. Two small components with a narrow props surface (`maxWidth`, `padding`, `actions`, `children`); each page keeps its own title/subtitle/nav JSX as children. Slightly larger diff than (1).
  3. Trades real duplication for a large props surface spanning four incompatible header shapes (hero stacked, pre-auth hero, calendar row app-bar, join/[code] eyebrow-only). Over-abstraction for an MVP.
- Selected option and why: Option 2. It removes the duplication that actually exists (byte-identical markup) without inventing configurability for shapes that differ. Matches the precedent diff already verified on `fix/ios-release-alamofire-link` (commit `12d93ff`).
- Risks & unknowns: Migrated pages must render pixel-identical except the string — mitigated by keeping every page's inner JSX untouched and passing it as `children`. The in-flight Apple sign-in branch (`fix/calendar-discard-and-unassign`) also touches `login`, `coach/signup`, `join/[code]` — this branch is cut from `staging` per the delivery flow; the edits are in different regions (header vs. form body) so merge conflicts should not occur.
- Dependencies / blockers: None. iOS bundle identifier stays `com.pumpslate.app` (changing it means re-registering the Firebase iOS app — out of scope, same decision as `docs/tasks/2026-08-24-ios-rebrand-pumpslate.md`).

## 2. Technical Design

- Affected files/components:
  - New: `apps/web/lib/brand.ts` (`export const BRAND_NAME = "PumpLoop"`), `apps/web/components/app-header.tsx`, `apps/web/components/auth-hero.tsx`
  - Migrated to `<AppHeader>`: `coach/clients/page.tsx`, `coach/clients/[athleteId]/page.tsx`, `coach/workouts/page.tsx`, `coach/exercises/page.tsx`, `today/page.tsx`
  - Migrated to `<AuthHero>`: `coach/signup/page.tsx`, `join/page.tsx`, `login/page.tsx`
  - Wired to `{BRAND_NAME}` only (bespoke markup unchanged): `coach/calendar/page.tsx`, `join/[code]/page.tsx`
  - Metadata: `app/layout.tsx` title → "PumpLoop", description → "Strength training programs from your coach, tracked set by set."
  - iOS/Capacitor: `capacitor.config.ts` (`appName`), `capacitor-shell/index.html` (title + body), `ios/App/App/Info.plist` (`CFBundleDisplayName`); generated `capacitor.config.json` + `public/index.html` refreshed via `npx cap sync ios`, never hand-edited.
- Frontend state/UI impact: None — pure presentational extraction. `AppHeader` owns the `bg-slate-950` wrapper, safe-area top padding, and eyebrow+actions row; `AuthHero` owns the pre-auth `<section>` shell and `tracking-[0.2em]` eyebrow. All page-specific content passes through as `children`, so `today`'s date carousel, `workouts`' `disabled={saving}` back button, and `clients/[athleteId]`'s absent `SignOutButton` behave exactly as before.
- Backward compatibility: No API, schema, auth, or routing changes. Explicitly excluded: `session/[id]/page.tsx` (eyebrow reads "Workout Session", not a brand occurrence), app icon/splash assets, colors, and header layout structure.

## 3. Estimate

- Size: L
- Sub-task breakdown (required for L/XL, per AGENTS.md §7):
  1. Foundation (4 files): `lib/brand.ts`, `components/app-header.tsx`, `components/auth-hero.tsx`, `app/layout.tsx` metadata. Plus this Task Doc.
  2. Migrate the 5 hero pages to `<AppHeader>`.
  3. Migrate the 3 pre-auth pages to `<AuthHero>`; wire `calendar` and `join/[code]` to `{BRAND_NAME}`.
  4. iOS/Capacitor identity (3 files) + `npx cap sync ios`; rebuild and confirm the built `Info.plist` reads "PumpLoop" with bundle ID and Google URL scheme unchanged.

## 4. Progress Tracker

| Phase / Sub-task | Status | Notes |
| --- | --- | --- |
| Task Doc | Done | |
| Sub-task 1: Foundation | Done | lint, tsc --noEmit, next build all clean |
| Sub-task 2: Hero pages → AppHeader | Done | lint, tsc, build clean; children JSX carried over unchanged |
| Sub-task 3: Pre-auth pages + bespoke wiring | Done | lint, tsc, build clean; join uses padding="pb-16" |
| Sub-task 4: iOS/Capacitor identity + cap sync | Done | cap sync refreshed gitignored generated files; Release build via xcodebuild succeeded; built Info.plist reads "PumpLoop", bundle ID `com.pumpslate.app` and URL scheme block unchanged vs staging |
| Reconciliation: merge origin/staging (437e414, incl. Sign in with Apple) into feature branch | Done | Conflicts were import-line-only in `login`, `coach/signup`, `join/[code]` — kept both `AuthHero`/`BRAND_NAME` and `AppleSignInButton` imports; `capacitor.config.ts` auto-merged to `appName: "PumpLoop"` + `apple: true`. Re-verified: lint, tsc, build clean; cap sync re-run; Release rebuild BUILD SUCCEEDED; built Info.plist "PumpLoop" + `com.pumpslate.app` |
| Verification + merge to staging | In Progress | lint/tsc/build clean per sub-task; zero "Performance Coach" hits in apps/web; Apple/Google sign-in and calendar Remove/discard confirmed intact post-merge; remaining "PumpSlate" hits are the bundle ID and a factual debug.xcconfig comment about the Firebase registration |

## 5. Outcome (filled at completion)

- Final status: Implemented and verified on `feat/pumploop-rebrand`, reconciled with `origin/staging`@437e414 (which had since gained Sign in with Apple, the coach-signup Apple name-field fix, and iOS entitlement/config persistence — all preserved byte-identical; the merge changes only branding/presentation vs staging).
- Deviations from plan: Visual spot-check done via production-build prerendered HTML + diff review instead of browser screenshots (browser tooling unavailable in this environment); result is pixel-identical by construction since `AppHeader`/`AuthHero` emit the exact class strings the hand-rolled headers had, and all page-specific JSX moved as `children` unchanged. iOS verified with `xcodebuild -project` (no `.xcworkspace` exists — SPM-based project) with `CODE_SIGNING_ALLOWED=NO`. The reconciliation merge was not in the original sub-task list; it became necessary because staging advanced while this branch awaited merge.
- Follow-ups: `apps/web/ios/debug.xcconfig` still says "PumpSlate iOS registration" in a comment; that is the actual Firebase console registration name and stays accurate until the registration is renamed. The empty Google URL scheme in unsigned local Release builds resolves from `GOOGLE_REVERSED_CLIENT_ID` in the (untracked, user-managed) `release.xcconfig` — pre-existing staging behavior, unchanged by this task.
