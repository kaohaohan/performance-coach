import type { Metadata } from "next";
import Link from "next/link";
import { BRAND_NAME } from "@/lib/brand";

const supportEmail = "haohan920@icloud.com";

export const metadata: Metadata = {
  title: `${BRAND_NAME} Support`,
  description: "Help and support for PumpLoop coaches and athletes.",
};

export default function SupportPage() {
  return (
    <main className="min-h-screen bg-stone-100 px-5 py-12 text-slate-900 sm:py-16">
      <div className="mx-auto max-w-2xl">
        <p className="text-xs font-semibold uppercase tracking-[0.18em] text-teal-700">{BRAND_NAME}</p>
        <h1 className="mt-3 text-4xl font-semibold tracking-tight">Support</h1>
        <p className="mt-4 max-w-xl text-base leading-7 text-slate-600">
          PumpLoop helps coaches plan, assign, and track strength training with their athletes.
        </p>

        <div className="mt-8 grid gap-4">
          <section className="rounded-3xl bg-white p-6 shadow-sm ring-1 ring-slate-950/5">
            <h2 className="text-xl font-semibold tracking-tight">Contact</h2>
            <p className="mt-3 text-sm leading-6 text-slate-600">
              For help with PumpLoop, email{" "}
              <a className="font-semibold text-teal-700 underline underline-offset-4" href={`mailto:${supportEmail}`}>
                {supportEmail}
              </a>.
            </p>
          </section>

          <section className="rounded-3xl bg-white p-6 shadow-sm ring-1 ring-slate-950/5">
            <h2 className="text-xl font-semibold tracking-tight">Account &amp; Sign-in help</h2>
            <p className="mt-3 text-sm leading-6 text-slate-600">
              Contact us if you need help signing in, joining a coach, or accessing your PumpLoop account.
            </p>
          </section>

          <section className="rounded-3xl bg-white p-6 shadow-sm ring-1 ring-slate-950/5">
            <h2 className="text-xl font-semibold tracking-tight">Workout &amp; Calendar help</h2>
            <p className="mt-3 text-sm leading-6 text-slate-600">
              Contact us for help creating workouts, scheduling training, recording sets, or reviewing a session.
            </p>
          </section>

          <section className="rounded-3xl bg-white p-6 shadow-sm ring-1 ring-slate-950/5">
            <h2 className="text-xl font-semibold tracking-tight">Account deletion</h2>
            <p className="mt-3 text-sm leading-6 text-slate-600">
              You can initiate account deletion in the app: Account → Delete Account.
            </p>
          </section>
        </div>

        <p className="mt-8 text-sm text-slate-600">
          Read our{" "}
          <Link className="font-semibold text-teal-700 underline underline-offset-4" href="/privacy">
            Privacy Policy
          </Link>.
        </p>
      </div>
    </main>
  );
}
