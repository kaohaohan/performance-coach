# Task Doc Template

Copy this file to `docs/tasks/YYYY-MM-DD-<slug>.md` before starting implementation, per AGENTS.md §9 (Task Documentation Requirement). Fill in all sections during the planning session (AGENTS.md §10 — high effort / high-capability model); update the Progress Tracker as implementation proceeds.

---

# Task: <short title>

- Date opened: YYYY-MM-DD
- Related contract sections: <e.g. §6 API Contract Discipline>
- Size (S/M/L/XL, per AGENTS.md §7): <size>

## 1. Feasibility Analysis

Evaluate the options. Do not design the winner here — that is section 2.

- Problem / trigger:
- Options considered:
  1. ...
  2. ...
- Trade-offs (per option):
- Selected option and why:
- Risks & unknowns:
- Dependencies / blockers:

## 2. Technical Design

Detailed design of the option selected in section 1. Fill in only the subsections the task actually touches; delete the rest.

- Affected files/components:
- Data flow: <how a request/change moves through the layers>
- Schema changes: <tables, columns, constraints, migration up/down>
- API changes: <routes, request/response shapes, status codes, authorization — see §6>
- State transitions: <valid states and allowed transitions, if applicable>
- Frontend state/UI impact:
- Backward compatibility / data backfill:

## 3. Estimate

- Size: <S/M/L/XL>
- Points (optional):
- Sub-task breakdown (required for L/XL, per AGENTS.md §7):
  1. ...
  2. ...

## 4. Progress Tracker

| Phase / Sub-task | Status | Notes |
| --- | --- | --- |
| ... | Not Started | |

Status values: `Not Started`, `In Progress`, `Blocked`, `Done`. Keep this table current — do not write it once and abandon it.

## 5. Outcome (filled at completion)

- Final status:
- Deviations from plan:
- Follow-ups:
