// A focus-trapped confirmation dialog, shared rather than copied.
//
// The pattern originated in app/coach/clients/page.tsx (ConfirmDialog +
// useFocusTrap) and is duplicated again in that page's invite-codes-panel.
// This module is the extraction point for the third consumer: an accessibility
// fix to a focus trap should land once, not once per page. The two existing
// call sites still hold their own copies — migrating them is deliberately out
// of scope for the change that created this file.
//
// Differences from the clients-page original, both required by the calendar's
// unsaved-changes dialog: the cancel action is labelled (a reassuring dialog
// wants "Keep editing", not "Cancel"), and `body` accepts ReactNode so a date
// can be emphasised inside the sentence. The heading id comes from useId()
// rather than a hardcoded string, so two dialogs can coexist without colliding.
"use client";

import { useEffect, useId, useRef, type ReactNode, type RefObject } from "react";

// useFocusTrap keeps keyboard focus inside a modal dialog while it's open:
// Tab/Shift+Tab wrap within the container's focusable elements, Escape
// calls onClose. It intentionally does not restore focus itself on
// cleanup — callers pass an onClose that already does that (e.g. focusing
// the trigger button)
// (docs/athlete-onboarding-invite-codes-v0.1.md §7.3 modal a11y).
export function useFocusTrap(containerRef: RefObject<HTMLElement | null>, onClose: () => void) {
  useEffect(() => {
    const focusableSelector = 'a[href], button:not([disabled]), textarea, input, select, [tabindex]:not([tabindex="-1"])';
    const focusables = () => Array.from(containerRef.current?.querySelectorAll<HTMLElement>(focusableSelector) ?? []);
    focusables()[0]?.focus();

    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        event.preventDefault();
        onClose();
        return;
      }
      if (event.key !== "Tab") return;
      const items = focusables();
      if (items.length === 0) return;
      const first = items[0];
      const last = items[items.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    }
    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
}

export function ConfirmDialog({
  title,
  body,
  confirmLabel,
  cancelLabel = "Cancel",
  danger,
  onConfirm,
  onCancel,
  onDismiss,
}: {
  title: string;
  body: ReactNode;
  confirmLabel: string;
  cancelLabel?: string;
  danger?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
  // Backdrop and Escape. Defaults to onCancel. Pass a distinct handler when
  // the cancel button is a real action (e.g. Continue Draft) and closing
  // the dialog should do neither confirm nor that action.
  onDismiss?: () => void;
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const titleId = useId();
  const dismiss = onDismiss ?? onCancel;
  useFocusTrap(containerRef, dismiss);

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-slate-950/40 p-4 sm:items-center" role="presentation" onClick={dismiss}>
      <div ref={containerRef} role="alertdialog" aria-modal="true" aria-labelledby={titleId} className="w-full max-w-sm rounded-3xl bg-white p-6 shadow-xl" onClick={(event) => event.stopPropagation()}>
        <h2 id={titleId} className="text-lg font-semibold tracking-tight">{title}</h2>
        <div className="mt-2 text-sm leading-6 text-slate-600">{body}</div>
        <div className="mt-6 flex gap-3">
          <button type="button" onClick={onCancel} className="min-h-14 flex-1 rounded-2xl border border-slate-200 text-base font-bold text-slate-700 transition hover:bg-stone-50">{cancelLabel}</button>
          <button type="button" onClick={onConfirm} className={`min-h-14 flex-1 rounded-2xl text-base font-bold text-white shadow-sm transition ${danger ? "bg-red-600 hover:bg-red-700" : "bg-teal-600 hover:bg-teal-700"}`}>{confirmLabel}</button>
        </div>
      </div>
    </div>
  );
}
