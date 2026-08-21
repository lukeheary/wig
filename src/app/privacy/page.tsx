import type { Metadata, Viewport } from "next";
import Link from "next/link";
import { WigLogo } from "@/components/ui/wig-logo";

export const metadata: Metadata = {
  title: "Privacy Policy | Who Is Going",
  description:
    "Learn how Who Is Going collects, uses, shares, and protects your information.",
  alternates: { canonical: "/privacy" },
};

export const viewport: Viewport = {
  colorScheme: "dark",
  themeColor: "#1B1B1D",
};

const serviceProviders = [
  "Clerk for account authentication and identity management;",
  "Neon for managed database infrastructure;",
  "Cloudflare, including Cloudflare R2, for image and object storage and delivery;",
  "Vercel for website and API hosting and delivery;",
  "Google, including Google Analytics and Google Places, for website analytics and place-search functionality; and",
  "Apple, including Apple Push Notification service and Sign in with Apple, for platform authentication and notification delivery.",
];

function Section({
  number,
  title,
  children,
}: {
  number: number;
  title: string;
  children: React.ReactNode;
}) {
  return (
    <section aria-labelledby={`section-${number}`} className="space-y-4">
      <h2
        id={`section-${number}`}
        className="font-space-grotesk text-2xl font-semibold tracking-tight text-foreground"
      >
        {number}. {title}
      </h2>
      {children}
    </section>
  );
}

function Subheading({ children }: { children: React.ReactNode }) {
  return (
    <h3 className="pt-1 text-lg font-semibold text-foreground">{children}</h3>
  );
}

function Bullets({ items }: { items: React.ReactNode[] }) {
  return (
    <ul className="list-disc space-y-2 pl-6 marker:text-muted-foreground">
      {items.map((item, index) => (
        <li key={index}>{item}</li>
      ))}
    </ul>
  );
}

export default function PrivacyPage() {
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
              Privacy Policy
            </h1>
            <div className="text-sm">
              <p>Effective date: August 20, 2026</p>
              <p>Last updated: August 20, 2026</p>
            </div>
            <p>
              Who Is Going (&quot;WIG,&quot; &quot;we,&quot; &quot;us,&quot; or
              &quot;our&quot;) provides the WIG service. This Privacy Policy
              explains how we collect, use, disclose, and retain information
              when you use the WIG mobile application, the website at
              whoisgoing.com, and related services (collectively, the
              &quot;Service&quot;).
            </p>
          </header>

          <Section number={1} title="Information We Collect">
            <Subheading>Information you provide</Subheading>
            <p>
              We may collect information that you provide directly, including:
            </p>
            <Bullets
              items={[
                <>
                  <strong className="text-foreground">
                    Account and profile information:
                  </strong>{" "}
                  email address, username, first and last name, profile photo,
                  city, state, gender, and date of birth.
                </>,
                <>
                  <strong className="text-foreground">
                    Authentication information:
                  </strong>{" "}
                  information needed to create and authenticate your account. If
                  you sign in with Apple, Google, or another authentication
                  provider, we receive information that provider makes available
                  to us. Your password is handled by our authentication provider
                  and is not stored in WIG&apos;s application database.
                </>,
                <>
                  <strong className="text-foreground">
                    Social and activity information:
                  </strong>{" "}
                  friend requests and friendships, partner relationships,
                  followed or hidden places, notification preferences, RSVPs,
                  reasons you provide for not attending, reviews, ratings, and
                  other interactions.
                </>,
                <>
                  <strong className="text-foreground">
                    Content you submit:
                  </strong>{" "}
                  profile images, event and place information, event cover
                  images, reviews, comments, and other content you create or
                  upload.
                </>,
                <>
                  <strong className="text-foreground">
                    Support communications:
                  </strong>{" "}
                  the subject, message, category, severity, status, and related
                  information for requests you send to WIG support.
                </>,
              ]}
            />
            <p>
              Some profile details, content, and activity may be visible to
              other WIG users as described in Section 4.
            </p>

            <Subheading>Information collected automatically</Subheading>
            <Bullets
              items={[
                <>
                  <strong className="text-foreground">
                    Device and technical information:
                  </strong>{" "}
                  device type, operating system, app or browser version, IP
                  address, diagnostic information, request timestamps, and
                  similar server-log information.
                </>,
                <>
                  <strong className="text-foreground">
                    Usage information:
                  </strong>{" "}
                  pages or screens viewed, features used, navigation and
                  interaction events, referring pages, and approximate usage
                  times. Our website uses Google Analytics for this purpose. The
                  iOS app may generate operational logs needed to provide and
                  troubleshoot the Service.
                </>,
                <>
                  <strong className="text-foreground">
                    Notification information:
                  </strong>{" "}
                  an Apple Push Notification service device token, notification
                  authorization status, registration dates, and whether a token
                  has been revoked. A device token identifies an app
                  installation for delivery purposes; it is not your phone
                  number.
                </>,
                <>
                  <strong className="text-foreground">
                    Approximate location:
                  </strong>{" "}
                  WIG may infer a general location from your selected city and
                  state or IP address. WIG does not currently request continuous
                  or precise device location through the iOS app.
                </>,
                <>
                  <strong className="text-foreground">
                    Cookies and similar technologies:
                  </strong>{" "}
                  the website may use cookies, local storage, pixels, and
                  similar technologies for authentication, security,
                  preferences, analytics, and Service operation.
                </>,
              ]}
            />

            <Subheading>Information from other sources</Subheading>
            <p>We may receive information from:</p>
            <Bullets
              items={[
                <>
                  Apple, Google, Clerk, or another provider you use to sign in;
                </>,
                <>
                  other users, such as when they send a friend or partner
                  request, RSVP on behalf of a partner where the feature permits
                  it, or include you in Service activity;
                </>,
                <>
                  event, venue, organizer, mapping, and ticketing sources,
                  including Google Places and publicly available or licensed
                  event listings; and
                </>,
                <>
                  service providers that help us detect abuse, secure, host,
                  analyze, and operate the Service.
                </>,
              ]}
            />
          </Section>

          <Section number={2} title="How We Use Information">
            <p>We use information to:</p>
            <Bullets
              items={[
                <>create, authenticate, maintain, and secure accounts;</>,
                <>
                  provide profiles, event discovery, place pages, social
                  connections, activity feeds, RSVPs, reviews, partner features,
                  and other Service functionality;
                </>,
                <>
                  personalize content using information such as your city,
                  followed places, relationships, and activity;
                </>,
                <>
                  deliver service-related emails, in-app messages, and push
                  notifications;
                </>,
                <>process uploads and display user and event images;</>,
                <>respond to support requests and communicate with you;</>,
                <>
                  measure use of the Service and improve reliability,
                  performance, features, and user experience;
                </>,
                <>
                  detect, investigate, and prevent spam, fraud, abuse, security
                  incidents, and violations of our terms or community rules;
                </>,
                <>moderate content and protect WIG, our users, and others;</>,
                <>
                  comply with law, enforce agreements, and establish, exercise,
                  or defend legal claims; and
                </>,
                <>
                  create aggregated or de-identified information that does not
                  reasonably identify you.
                </>,
              ]}
            />
            <p>
              We do not use data collected from Apple&apos;s platform APIs or
              permission-protected resources for advertising or to build
              advertising profiles.
            </p>
          </Section>

          <Section number={3} title="When We Disclose Information">
            <Subheading>Other users and the public</Subheading>
            <p>
              WIG is a social event-discovery service. Depending on the feature
              and your relationships, other users may be able to see your
              username, name, profile photo, city and state, friend or partner
              relationships, event activity, RSVPs, ratings, reviews, and
              content you create. Some event, place, organizer, and
              public-profile pages may also be accessible on the public website.
              Do not submit content you do not want shared with the applicable
              audience.
            </p>
            <Subheading>Service providers</Subheading>
            <p>
              We disclose information to vendors that process it for us to
              provide the Service. These include, as applicable:
            </p>
            <Bullets items={serviceProviders} />
            <p>
              These providers may process device, network, account, usage,
              content, or other information as necessary to perform services for
              us. We require service providers that receive personal information
              from us to protect it consistently with this Privacy Policy and
              applicable law and to use it only for authorized purposes.
            </p>
            <Subheading>Legal, safety, and rights protection</Subheading>
            <p>
              We may disclose information if we reasonably believe disclosure is
              necessary to comply with law or legal process; respond to valid
              government requests; protect the rights, safety, and property of
              WIG, our users, or others; investigate fraud, abuse, or security
              issues; or enforce our agreements.
            </p>
            <Subheading>Business transfers</Subheading>
            <p>
              Information may be disclosed or transferred as part of a merger,
              financing, acquisition, reorganization, bankruptcy, sale of
              assets, or similar transaction. Where required, we will provide
              notice before personal information becomes subject to a materially
              different privacy policy.
            </p>
            <Subheading>At your direction</Subheading>
            <p>
              We may disclose information when you direct us to do so, request
              an integration, or otherwise give consent.
            </p>
          </Section>

          <Section number={4} title="Social Features and User Content">
            <p>
              Your visibility on WIG depends on the feature, the audience, and
              your relationships. For example:
            </p>
            <Bullets
              items={[
                <>
                  profile and public-page information may be visible to other
                  users or website visitors;
                </>,
                <>
                  friends or partners may see activity and event-attendance
                  information that is not shown to unrelated users;
                </>,
                <>
                  event organizers, place managers, or administrators may see
                  information needed to operate their features; and
                </>,
                <>
                  reviews and event or place content may remain visible to their
                  intended audience until removed or until your account is
                  deleted, subject to legal and operational exceptions described
                  below.
                </>,
              ]}
            />
            <p>
              Other people may copy or reshare information that you make visible
              to them. WIG cannot control information after another person has
              copied or shared it outside the Service.
            </p>
          </Section>

          <Section number={5} title="Your Choices and Controls">
            <p>Depending on the feature, you may:</p>
            <Bullets
              items={[
                <>review and update profile details in the app;</>,
                <>
                  add, verify, or remove email addresses through account
                  settings;
                </>,
                <>
                  manage friendships, partner relationships, place follows,
                  hidden content, and notification-muting preferences;
                </>,
                <>
                  change push-notification, camera, photo-library, and calendar
                  permissions in iOS Settings;
                </>,
                <>
                  manage cookie controls through your browser and, where
                  available, website controls; and
                </>,
                <>delete your WIG account from the app.</>,
              ]}
            />
            <p>
              Disabling a permission may prevent the related feature from
              working, but core features that do not require that permission
              will remain available where practicable.
            </p>
          </Section>

          <Section number={6} title="Account and Data Deletion">
            <p>
              You may initiate permanent account deletion within the WIG app
              from your profile or account settings. Account deletion is
              designed to remove your WIG profile, personal information,
              relationships, follows, RSVPs, reviews, notifications, support
              records, push tokens, and content you created, together with
              stored images associated with that content.
            </p>
            <p>
              Deletion may not be instantaneous in backups, caches, logs, or
              systems operated by service providers. Residual copies are
              isolated from ordinary use and are deleted or overwritten
              according to backup and security cycles. We may retain limited
              information when reasonably necessary to comply with law, prevent
              fraud or abuse, resolve disputes, enforce agreements, protect the
              Service, or maintain a record of a privacy request. Aggregated or
              de-identified information may be retained.
            </p>
            <p>
              If you used Sign in with Apple or another third-party sign-in
              provider, you may also manage WIG&apos;s access through that
              provider&apos;s account settings. Deleting your WIG account does
              not delete your Apple or Google account.
            </p>
            <p>
              You may also request access, correction, or deletion by contacting
              us at{" "}
              <a
                className="text-foreground underline underline-offset-4"
                href="mailto:support@whoisgoing.com"
              >
                support@whoisgoing.com
              </a>
              . We may need to verify your identity before completing a request.
            </p>
          </Section>

          <Section number={7} title="Retention">
            <p>
              We retain personal information for as long as reasonably necessary
              to provide the Service and fulfill the purposes described in this
              policy, including while your account remains active. The retention
              period depends on the type of information, the feature for which
              it is used, security and fraud-prevention needs, applicable
              limitation periods, and legal or contractual requirements.
            </p>
            <p>
              When information is no longer needed, we delete, de-identify, or
              securely isolate it. Account data is generally retained until
              account deletion, support and security records may be kept for a
              reasonable period after a matter is resolved, and routine logs and
              backups are retained on rolling schedules.
            </p>
          </Section>

          <Section number={8} title="Security">
            <p>
              We use reasonable administrative, technical, and organizational
              safeguards designed to protect personal information. These
              measures may include encrypted network transmission, managed
              authentication, access controls, and separation of production
              systems. No method of transmission or storage is completely
              secure, and we cannot guarantee absolute security.
            </p>
            <p>
              You are responsible for maintaining the security of your sign-in
              methods and for promptly notifying us if you believe your account
              has been compromised.
            </p>
          </Section>

          <Section number={9} title="Children's Privacy">
            <p>
              The Service is not directed to children under 13, and children
              under 13 may not create or use a WIG account. We do not knowingly
              collect personal information from children under 13. If you
              believe a child under 13 has provided personal information to WIG,
              contact us at{" "}
              <a
                className="text-foreground underline underline-offset-4"
                href="mailto:support@whoisgoing.com"
              >
                support@whoisgoing.com
              </a>{" "}
              so we can investigate and, where appropriate, delete it.
            </p>
            <p>
              Users may be required to provide a date of birth to support
              age-appropriate experiences and legal compliance. A date-of-birth
              field does not mean that WIG knowingly permits use by children
              under 13.
            </p>
          </Section>

          <Section number={10} title="U.S. State Privacy Rights">
            <p>
              Depending on where you live and whether the applicable law applies
              to WIG, you may have rights to request access to or a copy of
              personal information; learn about the categories and sources of
              information we collect; correct inaccurate information; delete
              information; obtain data in a portable format; or appeal our
              response to a request. You may also have the right not to receive
              discriminatory treatment for exercising a privacy right.
            </p>
            <p>
              WIG does not sell personal information for money. WIG does not use
              personal information for cross-context behavioral advertising. If
              our practices change, we will update this policy and provide any
              legally required opt-out mechanism.
            </p>
            <p>
              To submit a request, email{" "}
              <a
                className="text-foreground underline underline-offset-4"
                href="mailto:support@whoisgoing.com?subject=Privacy%20Request"
              >
                support@whoisgoing.com
              </a>{" "}
              with the subject line &quot;Privacy Request.&quot; Describe your
              request and the account email or username involved. We will verify
              and respond as required by applicable law.
            </p>
          </Section>

          <Section number={11} title="International Data Transfers">
            <p>
              WIG and its providers may process and store information in the
              United States and other countries where they operate. Those
              countries may have data-protection laws that differ from the laws
              where you live. Where required, we use appropriate safeguards for
              international transfers.
            </p>
            <p>
              If WIG is offered in a jurisdiction that requires a specific
              lawful basis for processing, we process information as needed to
              perform our agreement with you, based on our legitimate interests
              in operating and securing the Service, with your consent, or to
              comply with legal obligations, as applicable. You may withdraw
              consent at any time, without affecting processing that occurred
              before withdrawal.
            </p>
          </Section>

          <Section number={12} title="Third-Party Services and Links">
            <p>
              The Service may link to ticketing providers, event organizers,
              venues, maps, social networks, and other third-party services.
              Their privacy practices are governed by their own policies, not
              this Privacy Policy. Review those policies before providing
              information to them.
            </p>
          </Section>

          <Section number={13} title="Changes to This Policy">
            <p>
              We may update this Privacy Policy as the Service or legal
              requirements change. We will update the &quot;Last updated&quot;
              date above and provide additional notice when required by law.
              Your continued use of the Service after an update takes effect is
              subject to the updated policy, to the extent permitted by law.
            </p>
          </Section>

          <Section number={14} title="Contact Us">
            <address className="not-italic">
              <p className="font-semibold text-foreground">Who Is Going</p>
              <p>
                Email:{" "}
                <a
                  className="text-foreground underline underline-offset-4"
                  href="mailto:support@whoisgoing.com"
                >
                  support@whoisgoing.com
                </a>
              </p>
            </address>
          </Section>
        </article>
      </main>
    </div>
  );
}
