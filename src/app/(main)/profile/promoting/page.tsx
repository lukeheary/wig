"use client";

import { format } from "date-fns";
import { Loader2 } from "lucide-react";
import { useState } from "react";
import { BackButtonHeader } from "@/components/shared/back-button-header";
import { PageContainer } from "@/components/shared/page-container";
import { trpc } from "@/lib/trpc";

export default function ProfilePromotingPage() {
  const utils = trpc.useUtils();
  const {
    data: events,
    isLoading,
    isError,
  } = trpc.user.getPromotionOptions.useQuery();
  const setPromoted = trpc.user.setEventPromoted.useMutation({
    onSuccess: async () => {
      await Promise.all([
        utils.user.getPromotionOptions.invalidate(),
        utils.user.getProfileByUsername.invalidate(),
      ]);
    },
  });

  return (
    <PageContainer className="min-h-screen bg-black !px-2 !pt-0 text-white md:!px-4 md:!pt-4">
      <BackButtonHeader backHref="/profile" title="Manage Promoting" />
      <div className="mx-auto max-w-2xl px-2 pb-28">
        <p className="mb-5 text-sm text-white/55">
          Choose upcoming events from places where you’re a promoter. Only
          selections happening this week appear on your profile.
        </p>

        {isLoading ? (
          <div className="flex justify-center py-16">
            <Loader2 className="h-7 w-7 animate-spin text-white/55" />
          </div>
        ) : isError ? (
          <p className="py-12 text-center text-white/55">
            Unable to load eligible events.
          </p>
        ) : events?.length ? (
          <div className="space-y-2">
            {events.map((event) => (
              <PromotionOptionRow
                key={event.id}
                event={event}
                disabled={setPromoted.isPending}
                onSave={(promoted, promo) =>
                  setPromoted.mutate({ eventId: event.id, promoted, promo })
                }
              />
            ))}
          </div>
        ) : (
          <div className="rounded-2xl border border-dashed border-white/10 px-5 py-14 text-center text-sm text-white/45">
            No upcoming events are available from your promoter places.
          </div>
        )}
      </div>
    </PageContainer>
  );
}

function PromotionOptionRow({
  event,
  disabled,
  onSave,
}: {
  event: {
    id: string;
    title: string;
    startAt: Date;
    placeName: string | null;
    isPromoted: boolean;
    promo: string | null;
  };
  disabled: boolean;
  onSave: (promoted: boolean, promo: string | null) => void;
}) {
  const [promo, setPromo] = useState(event.promo ?? "");

  return (
    <div className="rounded-2xl bg-white/[0.06] px-4 py-3">
      <label className="flex cursor-pointer items-center gap-3">
        <span className="min-w-0 flex-1">
          <span className="block truncate text-[15px] font-semibold">
            {event.title}
          </span>
          <span className="mt-0.5 block truncate text-xs text-white/55">
            {format(event.startAt, "EEE, MMM d 'at' h:mm a")}
            {event.placeName ? ` · ${event.placeName}` : ""}
          </span>
        </span>
        <input
          type="checkbox"
          checked={event.isPromoted}
          disabled={disabled}
          onChange={(changeEvent) =>
            onSave(changeEvent.target.checked, promo.trim() || null)
          }
          className="h-5 w-5 accent-sky-300"
        />
      </label>
      {event.isPromoted ? (
        <input
          value={promo}
          maxLength={255}
          onChange={(changeEvent) => setPromo(changeEvent.target.value)}
          onBlur={() => {
            const normalized = promo.trim();
            if (normalized !== (event.promo ?? "")) {
              onSave(true, normalized || null);
            }
          }}
          placeholder="Promo, e.g. Free with RSVP"
          className="mt-3 h-10 w-full rounded-xl border border-white/10 bg-black/35 px-3 text-sm text-white outline-none placeholder:text-white/30 focus:border-sky-300/60"
        />
      ) : null}
    </div>
  );
}
