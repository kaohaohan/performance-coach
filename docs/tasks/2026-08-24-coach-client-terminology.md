# T4b: Coach Client Terminology

## 1. Scope

Unify coach-facing user-visible terminology around “Client” in:

- `apps/web/app/coach/clients/page.tsx`
- `apps/web/app/coach/clients/[athleteId]/page.tsx`
- `apps/web/app/coach/workouts/page.tsx`
- `apps/web/app/coach/exercises/page.tsx`
- `apps/web/app/coach/clients/invite-codes-panel.tsx`

Change only visible copy:

- `athlete` / `athletes` → `client` / `clients` when referring to people managed by the Coach
- `roster` → `clients`
- `Athlete Training` → `Training`

## 2. Acceptance Criteria

- Coach-facing references to managed people consistently use “Client” / “Clients”.
- Coach-facing “roster” copy is replaced with “clients”.
- “Athlete Training” is replaced with “Training”.
- No behavior, layout, navigation, or data flow changes are introduced.
- Stale coach-facing `Athlete`, `Athletes`, or `roster` copy is absent from the five scoped files, except required code identifiers and domain/API terminology.

## 3. Files

- `apps/web/app/coach/clients/page.tsx`
- `apps/web/app/coach/clients/[athleteId]/page.tsx`
- `apps/web/app/coach/workouts/page.tsx`
- `apps/web/app/coach/exercises/page.tsx`
- `apps/web/app/coach/clients/invite-codes-panel.tsx`

## 4. Invariants / Non-goals

- Do not rename `athleteId` or any `Athlete` type/interface.
- Do not change API fields, routes, backend/domain/database terminology, or behavior.
- Do not touch Calendar, `/today`, auth pages, join pages, product naming, or iOS/Capacitor/TestFlight files.
- Do not change copy outside the five scoped files.
- Do not implement T4a, T4c, or any unrelated terminology work.

## 5. Verification

- Run `npm run lint`.
- Run `npx tsc --noEmit`.
- Run `npm run build`.
- Run `git diff --check`.
- Check the five scoped files for stale coach-facing `Athlete`, `Athletes`, and `roster` copy while allowing required identifiers, types, interfaces, API fields, and domain terminology.
