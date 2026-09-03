// Traditional Chinese (zh-TW) message catalog — one file per area, mirroring
// messages/en/. Each area file is typed against its English counterpart, so
// a key added in English without a translation here fails the build.
//
// The runtime fallback in translate() still exists, but it is a safety net
// for a bad deploy, not a workflow: the production flip reaches live pilot
// coaches immediately (task doc §2, Rollout sequencing), and a
// half-translated screen is exactly what they would report as a bug.
//
// Terminology note: strength-training vocabulary (組/次/重量/RPE) has
// established usage among Taiwan coaches and is founder-reviewed per task
// doc §3 sub-task 7 — do not machine-translate domain terms into these files
// without that review.
import type { Catalog } from "../en/index.ts";
import { auth } from "./auth.ts";
import { coach } from "./coach.ts";
import { common } from "./common.ts";
import { errors } from "./errors.ts";
import { settings } from "./settings.ts";

export const zhTW: Catalog = {
  ...auth,
  ...coach,
  ...common,
  ...errors,
  ...settings,
};
