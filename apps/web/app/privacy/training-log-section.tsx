"use client";

import { useT } from "@/lib/i18n";

// The Privacy page is a server component with no access to the client-side
// locale, so the training-log disclosure (en + zh-TW) is its own small client
// section. docs/tasks/2026-10-04-training-history.md, sub-task 6.
export function TrainingLogSection() {
  const t = useT();
  return (
    <section>
      <h2 className="text-xl font-semibold tracking-tight text-slate-900">{t("privacy.trainingLog.heading")}</h2>
      <p className="mt-3">{t("privacy.trainingLog.body1")}</p>
      <p className="mt-3">{t("privacy.trainingLog.body2")}</p>
    </section>
  );
}
