import type { Metadata } from "next";
import Link from "next/link";
import { BRAND_NAME } from "@/lib/brand";

const supportEmail = "haohan920@icloud.com";

export const metadata: Metadata = {
  title: `${BRAND_NAME} Privacy Policy`,
  description: "PumpLoop's Privacy Policy.",
};

export default function PrivacyPage() {
  return (
    <main className="min-h-screen bg-stone-100 px-5 py-12 text-slate-900 sm:py-16">
      <article className="mx-auto max-w-2xl">
        <p className="text-xs font-semibold uppercase tracking-[0.18em] text-teal-700">{BRAND_NAME}</p>
        <h1 className="mt-3 text-4xl font-semibold tracking-tight">Privacy Policy</h1>
        <p className="mt-3 text-sm text-slate-600">Effective date: August 27, 2026</p>

        <div className="mt-8 space-y-8 text-sm leading-6 text-slate-700">
          <section>
            <h2 className="text-xl font-semibold tracking-tight text-slate-900">1. Information we collect</h2>
            <p className="mt-3">
              We collect the information needed to provide PumpLoop: your account name and role (coach or athlete),
              and authentication information such as your email address when you use email sign-in. When you sign in
              with Google or Apple, the applicable provider authenticates you and provides the information needed to
              create or access your PumpLoop account.
            </p>
            <p className="mt-3">
              We also collect the training information you or your coach enter in PumpLoop, including coach-athlete
              relationships, exercises, workout programs, scheduled workouts, workout sessions, and set logs such as
              repetitions, load, unit, and RPE.
            </p>
          </section>

          <section>
            <h2 className="text-xl font-semibold tracking-tight text-slate-900">2. How we use information</h2>
            <p className="mt-3">
              We use this information to authenticate users, provide coaching and training features, schedule and
              record workouts, and let coaches and athletes view the training information they share through the app.
            </p>
          </section>

          <section>
            <h2 className="text-xl font-semibold tracking-tight text-slate-900">3. Authentication providers</h2>
            <p className="mt-3">
              PumpLoop uses Firebase Authentication for account authentication. You may sign in with email and
              password, Google Sign-In, or Sign in with Apple where available. Google and Apple handle their own
              authentication flows under their respective privacy policies.
            </p>
          </section>

          <section>
            <h2 className="text-xl font-semibold tracking-tight text-slate-900">4. Service providers and infrastructure</h2>
            <p className="mt-3">
              PumpLoop uses Vercel to host its web application, Google Cloud Run to operate its application API,
              Neon PostgreSQL to store application data, and Firebase Authentication to provide authentication.
              These providers process information only as needed to provide their services to PumpLoop.
            </p>
            <p className="mt-3">
              PumpLoop does not use analytics or advertising tracking in the app.
            </p>
          </section>

          <section>
            <h2 className="text-xl font-semibold tracking-tight text-slate-900">5. Data retention and account deletion</h2>
            <p className="mt-3">
              We retain account and training information while your account is active. You can initiate deletion in
              the app through Account → Delete Account. Deletion removes your ability to sign in and removes or
              anonymizes your account identity. Unstarted scheduled workouts, invitations, and unused coach-created
              workouts and exercises may be removed. Training history that a coach or athlete already shares may
              remain in anonymized form so it does not disrupt the other person&apos;s records.
            </p>
          </section>

          <section>
            <h2 className="text-xl font-semibold tracking-tight text-slate-900">6. Security</h2>
            <p className="mt-3">
              We use reasonable technical and organizational measures designed to protect the information handled by
              PumpLoop. No method of electronic storage or transmission is completely secure.
            </p>
          </section>

          <section>
            <h2 className="text-xl font-semibold tracking-tight text-slate-900">7. Children&apos;s privacy</h2>
            <p className="mt-3">
              PumpLoop is not directed to children under 13. If you believe a child under 13 has provided personal
              information through PumpLoop, contact us so we can address the request.
            </p>
          </section>

          <section>
            <h2 className="text-xl font-semibold tracking-tight text-slate-900">8. Changes to this policy</h2>
            <p className="mt-3">
              We may update this Privacy Policy as PumpLoop changes. We will post the updated policy on this page and
              revise its effective date.
            </p>
          </section>

          <section>
            <h2 className="text-xl font-semibold tracking-tight text-slate-900">9. Contact</h2>
            <p className="mt-3">
              For privacy questions, email{" "}
              <a className="font-semibold text-teal-700 underline underline-offset-4" href={`mailto:${supportEmail}`}>
                {supportEmail}
              </a>.
            </p>
          </section>
        </div>

        <p className="mt-10 text-sm text-slate-600">
          Need help?{" "}
          <Link className="font-semibold text-teal-700 underline underline-offset-4" href="/support">
            Visit PumpLoop Support
          </Link>.
        </p>
      </article>
    </main>
  );
}
