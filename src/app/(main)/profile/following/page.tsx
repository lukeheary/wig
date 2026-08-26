"use client";

import { Loader2 } from "lucide-react";
import {
  MobileFollowingRow,
  MobileProfileEmpty,
  MobileProfileListHeader,
} from "@/components/profile/mobile-profile-list";
import { BackButtonHeader } from "@/components/shared/back-button-header";
import { PageContainer } from "@/components/shared/page-container";
import { trpc } from "@/lib/trpc";

export default function ProfileFollowingPage() {
  const {
    data: places,
    isLoading,
    isError,
  } = trpc.place.listFollowedPlaces.useQuery();

  if (isLoading) {
    return (
      <div className="flex min-h-[50vh] items-center justify-center bg-black">
        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (isError) {
    return (
      <PageContainer className="min-h-screen bg-black text-center text-muted-foreground">
        Unable to load followed places.
      </PageContainer>
    );
  }

  return (
    <PageContainer className="min-h-screen bg-black !px-2 !pt-3 md:bg-background md:!px-4 md:!pt-4">
      <div className="md:hidden">
        <MobileProfileListHeader title="Following" />
        <div className="mt-4">
          {places?.length ? (
            places.map((place) => (
              <MobileFollowingRow key={place.id} place={place} />
            ))
          ) : (
            <MobileProfileEmpty>No followed places yet</MobileProfileEmpty>
          )}
        </div>
      </div>

      <div className="hidden md:block">
        <BackButtonHeader backHref="/profile" title="Following" />
        <div className="mx-auto max-w-2xl">
          {places?.length ? (
            places.map((place) => (
              <MobileFollowingRow key={place.id} place={place} />
            ))
          ) : (
            <MobileProfileEmpty>No followed places yet</MobileProfileEmpty>
          )}
        </div>
      </div>
    </PageContainer>
  );
}
