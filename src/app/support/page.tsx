import type { Metadata, Viewport } from "next";
import Link from "next/link";
import { WigLogo } from "@/components/ui/wig-logo";

export const metadata: Metadata = {
  title: "Support | Who Is Going",
  description: "Get help with WIG, report an issue, or share feedback with Who Is Going.",
  alternates: { canonical: "/support" },
};

export const viewport: Viewport = {
  colorScheme: "dark",
  themeColor: "#1B1B1D",
};

export default function SupportPage() {
  return (
    <div className="min-h-screen bg-background text-muted-foreground">
      <header className="border-b border-border/70 bg-card">
        <div className="container mx-auto flex h-16 items-center justify-between px-4">
          <WigLogo />
          <Link href="/" className="text-sm font-medium hover:text-foreground">
            Back to Who Is Going
          </Link>
        </div>
      </header>
      <main className="mx-auto max-w-3xl space-y-10 px-5 py-12 text-base leading-7 sm:px-8 sm:py-16">
        <header className="space-y-4 border-b border-border/70 pb-8">
          <p className="text-sm font-semibold uppercase tracking-[0.18em] text-primary">Who Is Going</p>
          <h1 className="font-space-grotesk text-4xl font-semibold tracking-tight text-foreground sm:text-5xl">How can we help?</h1>
          <p>Need help with WIG? Contact us about your account, an app issue, event information, or a feature you’d like to see.</p>
        </header>
        <section className="space-y-4">
          <h2 className="text-2xl font-semibold text-foreground">Contact support</h2>
          <p>Email us at <a href="mailto:support@whoisgoing.com" className="text-primary underline underline-offset-4">support@whoisgoing.com</a>. You don’t need a WIG account to get help.</p>
          <p>For app issues, include your device model, iOS version, and what happened. A screenshot or a link to the affected event can help us investigate. Please don’t send passwords or verification codes.</p>
          <p>Already have an account? <Link href="/support/tickets" className="text-primary underline underline-offset-4">Sign in to submit a ticket or view your requests.</Link></p>
        </section>
        <section className="space-y-4">
          <h2 className="text-2xl font-semibold text-foreground">Events and tickets</h2>
          <p>For ticket purchases, refunds, or entry requirements, contact the ticket seller or event organizer linked on the event page. To report incorrect event information in WIG, send us the event link and the details that need updating.</p>
        </section>
        <section className="space-y-4">
          <h2 className="text-2xl font-semibold text-foreground">Account and privacy</h2>
          <p>For account access, deletion, or privacy requests, email support with your WIG username, if you have one. You can also delete your account from Settings in the app.</p>
          <div className="flex flex-wrap gap-x-6 gap-y-2">
            <Link href="/privacy" className="text-primary underline underline-offset-4">Privacy Policy</Link>
            <Link href="/community-guidelines" className="text-primary underline underline-offset-4">Community Guidelines</Link>
          </div>
        </section>
      </main>
    </div>
  );
}
