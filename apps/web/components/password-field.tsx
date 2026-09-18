"use client";

import { useState } from "react";
import { useT } from "@/lib/i18n";

const inputClassName =
  "min-h-14 w-full rounded-xl border border-slate-200 bg-stone-50 py-0 pl-4 pr-16 text-base outline-none focus:border-teal-600 focus:bg-white focus:ring-2 focus:ring-teal-600/15 disabled:opacity-60";

type PasswordFieldProps = {
  value: string;
  onChange: (value: string) => void;
  autoComplete: string;
  label: string;
  required?: boolean;
  disabled?: boolean;
  hint?: string;
};

export function PasswordField({
  value,
  onChange,
  autoComplete,
  label,
  required,
  disabled,
  hint,
}: PasswordFieldProps) {
  const t = useT();
  const [visible, setVisible] = useState(false);

  return (
    <label>
      <span className="mb-1.5 block text-sm font-semibold text-slate-700">{label}</span>
      <span className="relative block">
        <input
          type={visible ? "text" : "password"}
          required={required}
          autoComplete={autoComplete}
          value={value}
          onChange={(event) => onChange(event.target.value)}
          disabled={disabled}
          className={inputClassName}
        />
        <button
          type="button"
          aria-pressed={visible}
          onClick={() => setVisible((current) => !current)}
          className="absolute inset-y-0 right-0 grid min-w-11 place-items-center px-3 text-sm font-bold text-teal-700"
        >
          {visible ? t("auth.field.hidePassword") : t("auth.field.showPassword")}
        </button>
      </span>
      {hint ? <span className="mt-1.5 block text-sm leading-5 text-slate-500">{hint}</span> : null}
    </label>
  );
}
