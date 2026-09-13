# Deployment Targets — Read This Before Testing

This is the single quick-reference for deciding **where a build or deployment goes**.
Do not infer the environment from an old Xcode build, a browser tab, or a
branch name alone. Before asking someone to test, report the target, URL, source
SHA, API, and database below.

## Target map

| Target | How it is selected | Frontend / app URL | API | Database | Use |
| --- | --- | --- | --- | --- | --- |
| Local | `APP_TARGET=local` or `npm run ios:local` | `http://127.0.0.1:3000` (Simulator) | Local Go API at `http://localhost:8080` | Local Docker Postgres | Development and automated/local verification only |
| Staging | Push/merge to lowercase `staging`; web Preview follows the `staging` branch | `https://performance-coach-git-staging-kaohaohans-projects.vercel.app` | Cloud Run `performance-coach-api-staging` | Neon `staging` branch | Shared pre-production testing; data is not production |
| Production | Explicit production deployment; never selected by a bare sync | `https://dontworkout.vercel.app` | Cloud Run `performance-coach-api` | Neon `main` branch | Real coaches and real training data |

The staging and production databases are separate. Staging can therefore have
older or missing students/workouts even when the UI looks identical. Firebase
Auth is currently shared by the deployed environments; a staging login is not
proof that the corresponding application data exists in the staging database.

## Web deployment path

The web app is deployed by the Vercel Git integration, not by opening Xcode.

- A local commit is **not deployed anywhere**.
- A branch Preview is not production.
- The `staging` branch produces the staging Preview URL above.
- The production URL must be checked explicitly in Vercel before calling it a
  production deployment. Never tell a tester that production changed merely
  because a Preview build passed.

For a web-only change such as Calendar `Edit workout`, the test path is:

```text
commit locally
  → push/merge to staging
  → Vercel builds the staging Preview
  → test the staging URL in Safari/Chrome
```

No Xcode rebuild is required for a web-only change. An installed Capacitor app
loads whichever remote URL was baked into its generated Capacitor config, so a
remote web deployment is visible only when that app is already pointed at the
same target; force-quit and reopen after the deployment to avoid stale WebView
state.

## iOS / Xcode path

`apps/web/capacitor.config.ts` reads `APP_TARGET`; it is not edited by hand.

```sh
# Local development / Simulator — local API and local database
cd apps/web
npm run ios:local

# Staging native shell — staging URL and staging data
APP_TARGET=staging npx cap sync ios
# Then Xcode Debug / Run is allowed to test staging.

# Production Release only — real production data
APP_TARGET=production npx cap sync ios
./ios/verify-capacitor-target.sh Release ios/App/App/capacitor.config.json
# The verification must print the production URL before Archive.
```

Rules:

- Bare `npx cap sync ios` uses the committed default, currently `staging`.
- Never use an Xcode Debug build to test production. The native safety gate
  rejects production for Debug and labels Debug builds `PumpLoop DEV`.
- Do not Archive from a feature branch or from an old checkout. Release
  candidates originate from the current `staging` SHA after the web/API checks
  pass; follow `docs/ios-release-runbook.md` for the full Archive checklist.

## Required deployment report

Every agent handoff that mentions “deployed”, “ready to test”, or “open the
app” must include all of these facts:

1. Target: Local, Staging, or Production.
2. Exact URL or app target.
3. Source branch and full commit SHA.
4. Frontend deployment status and API deployment status separately.
5. Database target: local, Neon `staging`, or Neon `main`.
6. Whether the user should use Safari/Chrome, Simulator, Xcode Debug, or
   TestFlight.
7. Any blocker, such as “commit is local only” or “Vercel build has not been
   verified”.

If any item is unknown, say “not verified” instead of implying that the change
is live.
