"use client";

import { Suspense } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { Loader2 } from "lucide-react";
import { EventForm } from "@/components/events/event-form";
import { BackButtonHeader } from "@/components/shared/back-button-header";
import { PageContainer } from "@/components/shared/page-container";
import { resolveBackHref, withReturnTo } from "@/lib/navigation";

function NewEventPageContent() {
  const router = useRouter();
  const searchParams = useSearchParams();

  const venueId = searchParams.get("venueId") || undefined;
  const organizerId = searchParams.get("organizerId") || undefined;
  const isRecurring = searchParams.get("recurring") === "true";
  const returnTo = searchParams.get("returnTo");
  const cancelHref = resolveBackHref({ returnTo, fallbackHref: "/home" });

  return (
    <PageContainer className="max-w-2xl space-y-6">
      <BackButtonHeader
        backFallbackHref="/home"
        returnTo={returnTo}
        title={isRecurring ? "Create Recurring Event" : "Create Event"}
      />

      <EventForm
        venueId={venueId}
        organizerId={organizerId}
        isRecurringDefault={isRecurring}
        onSuccess={(eventId) => {
          if (eventId) {
            router.push(withReturnTo(`/event/${eventId}`, returnTo));
            return;
          }
          router.push(cancelHref);
        }}
        onCancel={() => router.push(cancelHref)}
      />
    </PageContainer>
  );
}

export default function NewEventPage() {
  return (
    <Suspense
      fallback={
        <div className="container mx-auto py-8">
          <div className="flex justify-center py-12">
            <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
          </div>
        </div>
      }
    >
      <NewEventPageContent />
    </Suspense>
  );
}
