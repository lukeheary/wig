"use client";

import { differenceInCalendarWeeks, format, startOfWeek } from "date-fns";
import Image from "next/image";
import { CalendarDays, Loader2 } from "lucide-react";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import { BackButtonHeader } from "@/components/shared/back-button-header";
import { PageContainer } from "@/components/shared/page-container";
import { trpc } from "@/lib/trpc";

export default function ProfilePromotingPage() {
  const router = useRouter();
  const utils = trpc.useUtils();
  const {
    data: events,
    isLoading,
    isError,
  } = trpc.user.getPromotionOptions.useQuery();
  const setPromoted = trpc.user.setEventPromoted.useMutation();
  const [drafts, setDrafts] = useState<PromotionDraft[]>([]);
  const [savedDrafts, setSavedDrafts] = useState<PromotionDraft[]>([]);
  const [saveError, setSaveError] = useState<string | null>(null);

  useEffect(() => {
    if (!events) return;
    setDrafts(events);
    setSavedDrafts(events);
  }, [events]);

  const changedDrafts = useMemo(
    () =>
      drafts.filter((draft) => {
        const saved = savedDrafts.find((event) => event.id === draft.id);
        return (
          !saved ||
          saved.isPromoted !== draft.isPromoted ||
          normalizePromo(saved.promo) !== normalizePromo(draft.promo) ||
          normalizePromo(saved.promoUrl) !== normalizePromo(draft.promoUrl)
        );
      }),
    [drafts, savedDrafts]
  );
  const weekGroups = useMemo(() => groupPromotionDrafts(drafts), [drafts]);

  async function saveChanges() {
    if (!changedDrafts.length) return;
    setSaveError(null);
    try {
      for (const draft of changedDrafts) {
        await setPromoted.mutateAsync({
          eventId: draft.id,
          promoted: draft.isPromoted,
          promo: normalizePromo(draft.promo),
          promoUrl: normalizePromo(draft.promoUrl),
        });
      }
      setSavedDrafts(drafts);
      await Promise.all([
        utils.user.getPromotionOptions.invalidate(),
        utils.user.getProfileByUsername.invalidate(),
      ]);
      router.replace("/profile");
    } catch (error) {
      setSaveError(
        error instanceof Error ? error.message : "Unable to save changes."
      );
    }
  }

  return (
    <PageContainer className="min-h-screen bg-black !px-2 !pt-0 text-white md:!px-4 md:!pt-4">
      <div className="relative">
        <BackButtonHeader
          backHref="/profile"
          title="Manage Promoting"
          className="pr-16"
        />
        <button
          type="button"
          onClick={saveChanges}
          disabled={!changedDrafts.length || setPromoted.isPending}
          className="absolute right-2 top-1/2 h-10 -translate-y-1/2 rounded-full border border-white/15 bg-[#242426]/70 px-4 text-sm font-bold text-white shadow-[0_10px_28px_rgba(0,0,0,0.4)] backdrop-blur-2xl transition-colors hover:bg-[#242426]/85 disabled:text-white/30"
        >
          {setPromoted.isPending ? "Saving…" : "Save"}
        </button>
      </div>
      <div className="mx-auto max-w-2xl px-2 pb-28">
        <p className="mb-5 text-sm text-white/55">
          Choose upcoming events from places where you’re a promoter. Only
          selections happening this week appear on your profile.
        </p>

        {saveError ? (
          <p className="mb-3 text-sm text-red-400">{saveError}</p>
        ) : null}

        {isLoading ? (
          <div className="flex justify-center py-16">
            <Loader2 className="h-7 w-7 animate-spin text-white/55" />
          </div>
        ) : isError ? (
          <p className="py-12 text-center text-white/55">
            Unable to load eligible events.
          </p>
        ) : drafts.length ? (
          <div className="space-y-5">
            {weekGroups.map((group) => (
              <section key={group.label}>
                <h2 className="mb-1 px-2 text-base font-bold text-white">
                  {group.label}
                </h2>
                <div className="space-y-2">
                  {group.events.map((event) => (
                    <PromotionOptionRow
                      key={event.id}
                      event={event}
                      disabled={setPromoted.isPending}
                      onChange={(updates) =>
                        setDrafts((current) =>
                          current.map((draft) =>
                            draft.id === event.id
                              ? { ...draft, ...updates }
                              : draft
                          )
                        )
                      }
                    />
                  ))}
                </div>
              </section>
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
  onChange,
}: {
  event: PromotionDraft;
  disabled: boolean;
  onChange: (updates: Partial<PromotionDraft>) => void;
}) {
  const [showPromo, setShowPromo] = useState(Boolean(event.promo));
  const [showPromoLink, setShowPromoLink] = useState(Boolean(event.promoUrl));
  return (
    <div className="rounded-xl px-2 py-2 transition-colors active:bg-white/[0.06]">
      <div className="flex min-h-[3.75rem] items-center gap-2.5">
        <span className="relative h-11 w-11 shrink-0 overflow-hidden rounded-xl border border-white/10 bg-[#111113]">
          {event.coverImageUrl ? (
            <Image
              src={event.coverImageUrl}
              alt={event.title}
              fill
              sizes="44px"
              className="object-cover"
            />
          ) : (
            <span className="flex h-full w-full items-center justify-center">
              <CalendarDays className="h-5 w-5 text-white/25" />
            </span>
          )}
        </span>
        <span className="min-w-0 flex-1">
          <span className="block truncate text-[13px] font-semibold leading-tight">
            {event.title}
          </span>
          <span className="mt-0.5 block truncate text-[10px] font-medium leading-tight text-white/50">
            {format(event.startAt, "EEE, MMM d 'at' h:mm a")}
            {event.placeName ? ` · ${event.placeName}` : ""}
          </span>
        </span>
        <input
          aria-label={`${event.isPromoted ? "Stop promoting" : "Promote"} ${event.title}`}
          type="checkbox"
          checked={event.isPromoted}
          disabled={disabled}
          onChange={(changeEvent) => {
            if (!changeEvent.target.checked) {
              setShowPromo(false);
              setShowPromoLink(false);
            }
            onChange({ isPromoted: changeEvent.target.checked });
          }}
          className="h-5 w-5 cursor-pointer accent-sky-300"
        />
      </div>
      {event.isPromoted ? (
        <div className="mt-2 space-y-2">
          {showPromo && <input
            aria-label={`Promo for ${event.title}`}
            value={event.promo ?? ""}
            maxLength={255}
            disabled={disabled}
            onChange={(e) => onChange({ promo: e.target.value })}
            placeholder="Promo, e.g. Free with RSVP"
            className="h-10 w-full rounded-xl border border-white/10 bg-black/35 px-3 text-sm text-white"
          />}
          {showPromoLink && <input
            aria-label={`Promo link for ${event.title}`}
            type="url"
            autoCapitalize="none"
            spellCheck={false}
            value={event.promoUrl ?? ""}
            maxLength={2048}
            disabled={disabled}
            onChange={(e) => onChange({ promoUrl: e.target.value })}
            placeholder="https://example.com/promo"
            className="h-10 w-full rounded-xl border border-white/10 bg-black/35 px-3 text-sm text-white"
          />}
          {(!showPromo || !showPromoLink) && (
            <div className="flex gap-2.5 text-sm font-semibold text-sky-300">
              {!showPromo && <button type="button" disabled={disabled} onClick={() => setShowPromo(true)} className="min-h-11 min-w-0 flex-1 rounded-xl bg-white/[0.07] px-2 disabled:opacity-50">Add Promo</button>}
              {!showPromoLink && <button type="button" disabled={disabled} onClick={() => setShowPromoLink(true)} className="min-h-11 min-w-0 flex-1 rounded-xl bg-white/[0.07] px-2 disabled:opacity-50">Add Promo Link</button>}
            </div>
          )}
        </div>
      ) : null}
    </div>
  );
}

type PromotionDraft = {
  id: string;
  title: string;
  startAt: Date;
  placeName: string | null;
  coverImageUrl: string | null;
  isPromoted: boolean;
  promo: string | null;
  promoUrl: string | null;
};

function normalizePromo(value: string | null | undefined) {
  const normalized = value?.trim() ?? "";
  return normalized || null;
}

function groupPromotionDrafts(drafts: PromotionDraft[]) {
  const currentWeek = startOfWeek(new Date(), { weekStartsOn: 1 });
  const groups = new Map<number, PromotionDraft[]>();

  for (const draft of [...drafts].sort(
    (left, right) => left.startAt.getTime() - right.startAt.getTime()
  )) {
    const week = differenceInCalendarWeeks(
      startOfWeek(draft.startAt, { weekStartsOn: 1 }),
      currentWeek,
      { weekStartsOn: 1 }
    );
    groups.set(week, [...(groups.get(week) ?? []), draft]);
  }

  return [...groups.entries()].map(([week, events]) => ({
    label: promotionWeekLabel(week),
    events,
  }));
}

function promotionWeekLabel(week: number) {
  if (week <= 0) return "This Week";
  if (week === 1) return "Next Week";
  return `In ${week} Weeks`;
}
