import type { Metadata } from "next";
import type { ReactNode } from "react";
import Link from "next/link";
import { BRAND_NAME } from "@/lib/brand";

const supportEmail = "haohan920@icloud.com";

// This page carries both languages stacked on one page (Task Doc
// docs/tasks/2026-08-27-i18n-zh-tw.md, decision D1). It is one of the two
// public, non-auth routes and it exports Metadata, so it stays a server
// component and cannot read the client locale context that the rest of the
// app uses. Stacking avoids building a second, server-side locale mechanism
// for exactly two pages.
export const metadata: Metadata = {
  title: `${BRAND_NAME} Support`,
  description: "Help and support for PumpLoop coaches and athletes. PumpLoop 教練與學員的支援說明。",
};

function SupportCard({ heading, children }: { heading: string; children: ReactNode }) {
  return (
    <section className="rounded-3xl bg-white p-6 shadow-sm ring-1 ring-slate-950/5">
      <h3 className="text-xl font-semibold tracking-tight">{heading}</h3>
      <p className="mt-3 text-sm leading-6 text-slate-600">{children}</p>
    </section>
  );
}

function SupportEmailLink() {
  return (
    <a className="font-semibold text-teal-700 underline underline-offset-4" href={`mailto:${supportEmail}`}>
      {supportEmail}
    </a>
  );
}

export default function SupportPage() {
  return (
    <main className="min-h-screen bg-stone-100 px-5 py-12 text-slate-900 sm:py-16">
      <div className="mx-auto max-w-2xl">
        <p className="text-xs font-semibold uppercase tracking-[0.18em] text-teal-700">{BRAND_NAME}</p>
        <h1 className="mt-3 text-4xl font-semibold tracking-tight">
          Support <span className="text-slate-400">·</span> <span lang="zh-Hant-TW">支援說明</span>
        </h1>
        <nav aria-label="Language · 語言" className="mt-4 flex flex-wrap items-center gap-x-3 gap-y-1 text-sm">
          <a className="font-semibold text-teal-700 underline underline-offset-4" href="#english">
            English
          </a>
          <span aria-hidden="true" className="text-slate-400">
            ·
          </span>
          <a
            className="font-semibold text-teal-700 underline underline-offset-4"
            href="#zh-hant"
            lang="zh-Hant-TW"
          >
            繁體中文
          </a>
        </nav>

        <section id="english" lang="en" className="mt-10 scroll-mt-8">
          <h2 className="text-2xl font-semibold tracking-tight">Support</h2>
          <p className="mt-4 max-w-xl text-base leading-7 text-slate-600">
            PumpLoop helps coaches plan, assign, and track strength training with their athletes.
          </p>

          <div className="mt-8 grid gap-4">
            <SupportCard heading="Contact">
              For help with PumpLoop, email <SupportEmailLink />.
            </SupportCard>

            <SupportCard heading={"Account & Sign-in help"}>
              Contact us if you need help signing in, joining a coach, or accessing your PumpLoop account.
            </SupportCard>

            <SupportCard heading={"Workout & Calendar help"}>
              Contact us for help creating workouts, scheduling training, recording sets, or reviewing a session.
            </SupportCard>

            <SupportCard heading="Account deletion">
              You can initiate account deletion in the app: Account → Delete Account.
            </SupportCard>
          </div>

          <p className="mt-8 text-sm text-slate-600">
            Read our{" "}
            <Link className="font-semibold text-teal-700 underline underline-offset-4" href="/privacy">
              Privacy Policy
            </Link>
            .
          </p>
        </section>

        <hr className="mt-12 border-0 border-t border-slate-950/10" />

        <section id="zh-hant" lang="zh-Hant-TW" className="mt-12 scroll-mt-8">
          <h2 className="text-2xl font-semibold tracking-tight">支援說明</h2>
          <p className="mt-4 max-w-xl text-base leading-7 text-slate-600">
            PumpLoop 協助教練規劃、指派並追蹤學員的重量訓練。
          </p>

          <div className="mt-8 grid gap-4">
            <SupportCard heading="聯絡我們">
              需要 PumpLoop 的協助，請來信 <SupportEmailLink />。
            </SupportCard>

            <SupportCard heading="帳號與登入">
              登入、加入教練，或存取 PumpLoop 帳號時遇到問題，歡迎與我們聯絡。
            </SupportCard>

            <SupportCard heading="課表與行事曆">
              建立課表、安排訓練、記錄訓練組數，或查看訓練結果時需要協助，歡迎與我們聯絡。
            </SupportCard>

            <SupportCard heading="刪除帳號">
              你可以直接在 App 中刪除帳號：帳號 → 刪除帳號。
            </SupportCard>
          </div>

          <p className="mt-8 text-sm text-slate-600">
            閱讀我們的
            <Link className="font-semibold text-teal-700 underline underline-offset-4" href="/privacy">
              隱私權政策
            </Link>
            （僅提供英文版）。
          </p>
        </section>
      </div>
    </main>
  );
}
