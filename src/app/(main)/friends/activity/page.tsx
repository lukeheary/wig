"use client";

import { Suspense } from "react";
import { Loader2 } from "lucide-react";
import { ActivityFeed } from "@/components/friends/activity-feed";
import { BackButtonHeader } from "@/components/shared/back-button-header";
import { PageContainer } from "@/components/shared/page-container";

function ActivityPageContent() {
  return (
    <PageContainer>
      <BackButtonHeader
        backHref="/activity"
        title="Activity"
        subtitle="See what your friends are up to"
      />

      <ActivityFeed />
    </PageContainer>
  );
}

export default function ActivityPage() {
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
      <ActivityPageContent />
    </Suspense>
  );
}
