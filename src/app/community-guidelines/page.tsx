import type { Metadata, Viewport } from "next";
import Link from "next/link";
import { WigLogo } from "@/components/ui/wig-logo";

export const metadata: Metadata = {
  title: "Community Guidelines | Who Is Going",
  description:
    "The rules that help keep the Who Is Going community safe and welcoming.",
  alternates: { canonical: "/community-guidelines" },
};

export const viewport: Viewport = {
  colorScheme: "dark",
  themeColor: "#1B1B1D",
};

const guidelines = [
  {
    title: "Treat people with respect",
    body: "Do not harass, threaten, bully, shame, or target another person. Hate speech and attacks based on protected characteristics are prohibited.",
  },
  {
    title: "Keep content safe",
    body: "Do not post sexual exploitation, sexual solicitation, graphic violence, credible threats, or content that encourages harm. Any sexual content involving minors is strictly prohibited.",
  },
  {
    title: "Be authentic",
    body: "Do not impersonate another person, venue, organizer, or business. Do not deliberately publish misleading event or profile information.",
  },
  {
    title: "No spam or scams",
    body: "Do not use WIG for deceptive promotions, fraudulent investments, repeated unsolicited links, engagement manipulation, or attempts to steal money or personal information.",
  },
  {
    title: "Respect privacy and ownership",
    body: "Only upload content you have permission to share. Do not expose another person’s private information or misuse their image, identity, or intellectual property.",
  },
];

export default function CommunityGuidelinesPage() {
  return (
    <div className="min-h-screen bg-background text-muted-foreground">
      <header className="border-b border-border/70 bg-card">
        <div className="container mx-auto flex h-16 items-center justify-between px-4">
          <WigLogo />
          <Link
            href="/"
            className="text-sm font-medium text-muted-foreground transition-colors hover:text-foreground"
          >
            Back to Who Is Going
          </Link>
        </div>
      </header>

      <main className="mx-auto max-w-3xl px-5 py-12 sm:px-8 sm:py-16">
        <article className="space-y-10 text-[15px] leading-7 sm:text-base">
          <header className="space-y-4 border-b border-border/70 pb-8">
            <p className="text-sm font-semibold uppercase tracking-[0.18em] text-primary">
              Who Is Going
            </p>
            <h1 className="font-space-grotesk text-4xl font-semibold tracking-tight text-foreground sm:text-5xl">
              Community Guidelines
            </h1>
            <p>
              WIG helps people discover events and connect with their community.
              These rules apply to profiles, reviews, events, places, images,
              and every other contribution to the service.
            </p>
          </header>

          <section className="space-y-6" aria-labelledby="community-rules">
            <h2
              id="community-rules"
              className="font-space-grotesk text-2xl font-semibold text-foreground"
            >
              Community rules
            </h2>
            <div className="space-y-5">
              {guidelines.map((guideline, index) => (
                <div
                  key={guideline.title}
                  className="rounded-2xl border border-border/70 bg-card p-5"
                >
                  <h3 className="font-semibold text-foreground">
                    {index + 1}. {guideline.title}
                  </h3>
                  <p className="mt-2">{guideline.body}</p>
                </div>
              ))}
            </div>
          </section>

          <section className="space-y-4" aria-labelledby="enforcement">
            <h2
              id="enforcement"
              className="font-space-grotesk text-2xl font-semibold text-foreground"
            >
              Reporting and enforcement
            </h2>
            <p>
              Use the Report a Concern option on a user, event, or place to send
              it to WIG for review. You can also block a user to prevent further
              interaction. Depending on severity and history, WIG may remove
              content, restrict features, suspend an account, or permanently ban
              an account.
            </p>
            <p>
              We prioritize credible threats, exploitation, and urgent safety
              reports. For help, an appeal, or an urgent concern, contact{" "}
              <a
                href="mailto:support@whoisgoing.com"
                className="font-medium text-foreground underline underline-offset-4"
              >
                support@whoisgoing.com
              </a>
              . If anyone is in immediate danger, contact local emergency
              services first.
            </p>
          </section>

          <footer className="border-t border-border/70 pt-8 text-sm">
            <Link
              href="/privacy"
              className="font-medium text-foreground underline underline-offset-4"
            >
              Read the Privacy Policy
            </Link>
          </footer>
        </article>
      </main>
    </div>
  );
}
