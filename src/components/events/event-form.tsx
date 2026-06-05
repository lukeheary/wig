"use client";

import { useEffect, useRef, useState } from "react";
import { addDays, differenceInCalendarDays } from "date-fns";
import { Loader2 } from "lucide-react";
import { trpc } from "@/lib/trpc";
import { useToast } from "@/hooks/use-toast";
import { CategoryMultiSelect } from "@/components/category-multi-select";
import { VenueSelector, VenueData } from "@/components/events/venue-selector";
import {
  OrganizerSelector,
  type OrganizerData,
} from "@/components/events/organizer-selector";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { DatePicker } from "@/components/ui/date-picker";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { S3Uploader } from "@/components/ui/s3-uploader";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import type { VenueHours } from "@/components/venue-hours-editor";
import { eventTimeZone } from "@/lib/utils";
import {
  EVENT_STATUS_VALUES,
  getEventStatusLabel,
  type EventStatus,
} from "@/lib/event-status";

interface EventFormProps {
  venueId?: string;
  organizerId?: string;
  isRecurringDefault?: boolean;
  onSuccess?: (eventId?: string) => void;
  onCancel?: () => void;
}

const WEEKDAY_LABELS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const FULL_WEEKDAY_LABELS = [
  "Sunday",
  "Monday",
  "Tuesday",
  "Wednesday",
  "Thursday",
  "Friday",
  "Saturday",
];
const ORDINAL_LABELS = ["First", "Second", "Third", "Fourth", "Fifth"];

export function EventForm({
  venueId,
  organizerId,
  isRecurringDefault = false,
  onSuccess,
  onCancel,
}: EventFormProps) {
  const { toast } = useToast();

  const [formData, setFormData] = useState({
    title: "",
    description: "",
    eventUrl: "",
    coverImageUrl: "",
    categories: [] as string[],
    status: "active" as EventStatus,
    startAt: "",
    endAt: "",
    address: "",
    city: "",
    state: "",
  });

  const [recurrenceData, setRecurrenceData] = useState({
    frequency: "weekly" as "daily" | "weekly" | "monthly",
    interval: 1,
    daysOfWeek: [] as number[],
    untilDate: "",
  });

  const [selectedVenue, setSelectedVenue] = useState<VenueData | null>(null);
  const [selectedOrganizer, setSelectedOrganizer] =
    useState<OrganizerData | null>(null);
  const [isCreatingNewVenue, setIsCreatingNewVenue] = useState(false);
  const lastAutoAppliedKeyRef = useRef<string | null>(null);
  const [deferredCoverImageFile, setDeferredCoverImageFile] =
    useState<File | null>(null);
  const [isSubmittingImage, setIsSubmittingImage] = useState(false);
  const [showTitleSuggestions, setShowTitleSuggestions] = useState(false);
  const submitLockRef = useRef(false);
  const [isSubmitLocked, setIsSubmitLocked] = useState(false);
  const [suggestedTitleTimeTemplate, setSuggestedTitleTimeTemplate] = useState<{
    startTime: string;
    endTime: string | null;
    endDayOffset: number;
  } | null>(null);

  const getDatePart = (value: string) => (value ? value.split("T")[0] : "");
  const getTimePart = (value: string) => (value ? value.split("T")[1] : "");
  const buildDateTime = (date: string, time: string) =>
    date ? `${date}T${time}` : "";
  const formatDatePart = (value: Date) => {
    const year = value.getFullYear();
    const month = String(value.getMonth() + 1).padStart(2, "0");
    const day = String(value.getDate()).padStart(2, "0");
    return `${year}-${month}-${day}`;
  };
  const formatTimePart = (value: Date) => {
    const hours = String(value.getHours()).padStart(2, "0");
    const minutes = String(value.getMinutes()).padStart(2, "0");
    return `${hours}:${minutes}`;
  };

  const getVenueDayHours = (dateString: string, hours?: VenueHours | null) => {
    if (!dateString || !hours) return null;
    const dayIndex = new Date(`${dateString}T00:00`).getDay();
    const dayKeys: (keyof VenueHours)[] = [
      "sunday",
      "monday",
      "tuesday",
      "wednesday",
      "thursday",
      "friday",
      "saturday",
    ];
    const dayKey = dayKeys[dayIndex];
    const dayHours = hours[dayKey];
    if (!dayHours || dayHours.closed) return null;
    return dayHours;
  };

  const applyVenueHoursToDate = (
    dateString: string,
    hours?: VenueHours | null,
    venueKeyOverride?: string
  ) => {
    const dayHours = getVenueDayHours(dateString, hours);
    if (!dayHours) return;

    const venueKey =
      venueKeyOverride || selectedVenue?.id || selectedVenue?.name || "unknown";
    const autoKey = `${venueKey}:${dateString}`;
    if (lastAutoAppliedKeyRef.current === autoKey) return;

    const startHour = parseInt(dayHours.open.split(":")[0] || "0", 10);
    const startMinute = parseInt(dayHours.open.split(":")[1] || "0", 10);
    const endHour = parseInt(dayHours.close.split(":")[0] || "0", 10);
    const endMinute = parseInt(dayHours.close.split(":")[1] || "0", 10);
    const isOvernight =
      endHour < startHour ||
      (endHour === startHour && endMinute <= startMinute);

    const endDateString = isOvernight
      ? addDays(new Date(`${dateString}T00:00`), 1)
          .toISOString()
          .slice(0, 10)
      : dateString;

    setFormData((prev) => ({
      ...prev,
      startAt: buildDateTime(dateString, dayHours.open),
      endAt: buildDateTime(endDateString, dayHours.close),
    }));

    lastAutoAppliedKeyRef.current = autoKey;
  };

  const { data: venue, isLoading: isLoadingVenue } =
    trpc.place.getPlaceById.useQuery(
      { id: venueId as string },
      { enabled: !!venueId }
    );
  const { data: organizer, isLoading: isLoadingOrganizer } =
    trpc.place.getPlaceById.useQuery(
      { id: organizerId as string },
      { enabled: !!organizerId }
    );

  const titleQuery = formData.title.trim();
  const {
    data: titleSuggestions = [],
    isFetching: isFetchingTitleSuggestions,
  } = trpc.place.suggestEventTitles.useQuery(
    {
      venueId: selectedVenue?.id || "",
      query: titleQuery,
      limit: 8,
    },
    {
      enabled: Boolean(selectedVenue?.id && titleQuery.length > 0),
    }
  );
  const visibleTitleSuggestions = titleSuggestions.filter(
    (suggestion) => suggestion.title.toLowerCase() !== titleQuery.toLowerCase()
  );

  const applySuggestedEventTimes = (suggestion: {
    title: string;
    startAt: Date;
    endAt: Date | null;
  }) => {
    const startTime = formatTimePart(suggestion.startAt);
    const endTime = suggestion.endAt ? formatTimePart(suggestion.endAt) : null;
    const endDayOffset = suggestion.endAt
      ? differenceInCalendarDays(suggestion.endAt, suggestion.startAt)
      : 0;

    setSuggestedTitleTimeTemplate({
      startTime,
      endTime,
      endDayOffset,
    });

    setFormData((prev) => {
      const currentStartDate = getDatePart(prev.startAt);
      const baseStartDate = currentStartDate || formatDatePart(new Date());
      const nextStartAt = buildDateTime(baseStartDate, startTime);

      let nextEndAt = "";
      if (endTime) {
        nextEndAt = buildDateTime(
          formatDatePart(
            addDays(new Date(`${baseStartDate}T00:00`), endDayOffset)
          ),
          endTime
        );
      }

      return {
        ...prev,
        title: suggestion.title,
        startAt: nextStartAt,
        endAt: nextEndAt,
      };
    });
  };

  useEffect(() => {
    if (venue) {
      setSelectedVenue({
        id: venue.id,
        name: venue.name,
        address: venue.address || "",
        city: venue.city || "",
        state: venue.state || "",
        categories: venue.categories || [],
        hours: (venue.hours as VenueHours) || null,
      });

      if (venue.categories?.length > 0) {
        setFormData((prev) => ({
          ...prev,
          categories: venue.categories,
        }));
      }

      const startDate = getDatePart(formData.startAt);
      if (startDate) {
        applyVenueHoursToDate(startDate, venue.hours as VenueHours, venue.id);
      }
    }
  }, [venue]);

  useEffect(() => {
    if (organizer) {
      setSelectedOrganizer({
        id: organizer.id,
        name: organizer.name,
        city: organizer.city || "",
        state: organizer.state || "",
        slug: organizer.slug,
        instagram: organizer.instagram || "",
      });
    }
  }, [organizer]);

  useEffect(() => {
    if (!isRecurringDefault || recurrenceData.frequency === "daily") return;
    if (recurrenceData.daysOfWeek.length > 0) return;
    const startDate = getDatePart(formData.startAt);
    if (!startDate) return;

    const weekday = new Date(`${startDate}T00:00`).getDay();
    setRecurrenceData((prev) => ({
      ...prev,
      daysOfWeek: [weekday],
    }));
  }, [
    isRecurringDefault,
    recurrenceData.frequency,
    recurrenceData.daysOfWeek.length,
    formData.startAt,
  ]);

  const monthlyPatternLabel = (() => {
    if (!isRecurringDefault || recurrenceData.frequency !== "monthly")
      return null;
    const startDate = getDatePart(formData.startAt);
    if (!startDate) return null;
    const date = new Date(`${startDate}T00:00`);
    const weekday = date.getDay();
    const ordinal = Math.floor((date.getDate() - 1) / 7);
    const ordinalLabel =
      ORDINAL_LABELS[Math.min(ordinal, ORDINAL_LABELS.length - 1)];
    return `${ordinalLabel} ${FULL_WEEKDAY_LABELS[weekday]}`;
  })();

  const weeklyPatternLabel = (() => {
    if (!isRecurringDefault || recurrenceData.frequency !== "weekly")
      return null;
    if (recurrenceData.daysOfWeek.length === 0) return null;
    return recurrenceData.daysOfWeek
      .map((day) => FULL_WEEKDAY_LABELS[day] ?? WEEKDAY_LABELS[day])
      .join(", ");
  })();

  const createVenueMutation = trpc.place.createPlace.useMutation();

  const createMutation = trpc.event.createEvent.useMutation({
    onError: (error) => {
      toast({
        title: "Error",
        description: error.message,
        variant: "destructive",
      });
    },
  });

  const createRecurringMutation = trpc.event.createRecurringEvent.useMutation({
    onError: (error) => {
      toast({
        title: "Error",
        description: error.message,
        variant: "destructive",
      });
    },
  });
  const setEventCoverImageMutation = trpc.event.setEventCoverImage.useMutation();
  const setEventSeriesCoverImageMutation =
    trpc.event.setEventSeriesCoverImage.useMutation();

  const uploadCoverImage = async (file: File, folder: string) => {
    const uploadFormData = new FormData();
    uploadFormData.append("file", file);
    uploadFormData.append("folder", folder);
    uploadFormData.append("filename", "cover-image.png");

    const uploadResponse = await fetch("/api/upload", {
      method: "POST",
      body: uploadFormData,
    });

    const uploadData = await uploadResponse.json();
    if (!uploadResponse.ok) {
      throw new Error(uploadData.error || "Upload failed");
    }

    return uploadData.url as string;
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    if (submitLockRef.current) {
      return;
    }

    submitLockRef.current = true;
    setIsSubmitLocked(true);

    try {
      if (!formData.title || !formData.startAt) {
        toast({
          title: "Validation Error",
          description: "Please fill in all required fields",
          variant: "destructive",
        });
        return;
      }

      const startDate = new Date(formData.startAt);
      const endDate = formData.endAt ? new Date(formData.endAt) : null;

      if (endDate && endDate <= startDate) {
        toast({
          title: "Validation Error",
          description: "End time must be after start time",
          variant: "destructive",
        });
        return;
      }

      if (isRecurringDefault) {
        if (
          recurrenceData.frequency === "weekly" &&
          recurrenceData.daysOfWeek.length === 0
        ) {
          toast({
            title: "Validation Error",
            description: "Select at least one weekday for a weekly recurrence",
            variant: "destructive",
          });
          return;
        }

        if (recurrenceData.untilDate) {
          const untilDate = new Date(`${recurrenceData.untilDate}T23:59:59`);
          if (untilDate < startDate) {
            toast({
              title: "Validation Error",
              description: "Series end date must be on or after the start date",
              variant: "destructive",
            });
            return;
          }
        }
      }

      let finalVenueId = venueId || selectedVenue?.id;

      if (isCreatingNewVenue && selectedVenue) {
        try {
          const newVenue = await createVenueMutation.mutateAsync({
            type: "venue",
            name: selectedVenue.name,
            address: selectedVenue.address || undefined,
            city: selectedVenue.city,
            state: selectedVenue.state,
            latitude: selectedVenue.latitude,
            longitude: selectedVenue.longitude,
            instagram: selectedVenue.instagram || undefined,
          });
          finalVenueId = newVenue.id;
        } catch (error: any) {
          toast({
            title: "Venue Creation Error",
            description: error.message,
            variant: "destructive",
          });
          return;
        }
      }

      if (!finalVenueId && !isCreatingNewVenue) {
        toast({
          title: "Validation Error",
          description: "Please select a venue",
          variant: "destructive",
        });
        return;
      }

      const payload = {
        venueId: finalVenueId,
        organizerId: selectedOrganizer?.id || undefined,
        title: formData.title,
        description: formData.description || undefined,
        eventUrl: formData.eventUrl || undefined,
        coverImageUrl: deferredCoverImageFile
          ? undefined
          : formData.coverImageUrl || undefined,
        categories: formData.categories,
        status: formData.status,
        startAt: startDate,
        endAt: endDate || undefined,
        address: selectedVenue?.address || formData.address || undefined,
        city: selectedVenue?.city || formData.city,
        state: selectedVenue?.state || formData.state,
        timeZone: eventTimeZone(
          undefined,
          selectedVenue?.state || formData.state
        ),
      };

      if (isRecurringDefault) {
        const createdSeries = await createRecurringMutation.mutateAsync({
          ...payload,
          timeZone: eventTimeZone(undefined, payload.state),
          recurrence: {
            frequency: recurrenceData.frequency,
            interval: recurrenceData.interval,
            daysOfWeek:
              recurrenceData.frequency === "daily"
                ? undefined
                : recurrenceData.frequency === "monthly"
                  ? recurrenceData.daysOfWeek.slice(0, 1)
                  : recurrenceData.daysOfWeek,
            untilDate: recurrenceData.untilDate
              ? new Date(`${recurrenceData.untilDate}T23:59:59`)
              : undefined,
          },
        });
        if (deferredCoverImageFile) {
          setIsSubmittingImage(true);
          try {
            const uploadedCoverImageUrl = await uploadCoverImage(
              deferredCoverImageFile,
              `event-series/${createdSeries.seriesId}`
            );

            await setEventSeriesCoverImageMutation.mutateAsync({
              seriesId: createdSeries.seriesId,
              coverImageUrl: uploadedCoverImageUrl,
            });
          } catch (error) {
            toast({
              title: "Series created without image",
              description:
                error instanceof Error
                  ? error.message
                  : "The recurring series was created, but the image upload failed.",
              variant: "destructive",
            });
          } finally {
            setIsSubmittingImage(false);
          }
        }
        onSuccess?.(createdSeries.firstEventId ?? undefined);
        return;
      }

      const createdEvent = await createMutation.mutateAsync(payload);
      if (deferredCoverImageFile) {
        setIsSubmittingImage(true);
        try {
          const uploadedCoverImageUrl = await uploadCoverImage(
            deferredCoverImageFile,
            `events/${createdEvent.id}`
          );

          await setEventCoverImageMutation.mutateAsync({
            eventId: createdEvent.id,
            coverImageUrl: uploadedCoverImageUrl,
          });
        } catch (error) {
          toast({
            title: "Event created without image",
            description:
              error instanceof Error
                ? error.message
                : "The event was created, but the image upload failed.",
            variant: "destructive",
          });
        } finally {
          setIsSubmittingImage(false);
        }
      }

      onSuccess?.(createdEvent.id);
    } catch {
      // Mutation-specific toasts are handled in each mutation's onError callback.
    } finally {
      submitLockRef.current = false;
      setIsSubmitLocked(false);
    }
  };

  const handleVenueSelect = (nextVenue: VenueData | null) => {
    setSelectedVenue(nextVenue);
    setShowTitleSuggestions(false);
    if (nextVenue?.categories && nextVenue.categories.length > 0) {
      setFormData((prev) => ({
        ...prev,
        categories: nextVenue.categories || [],
      }));
    }
    const startDate = getDatePart(formData.startAt);
    if (startDate) {
      applyVenueHoursToDate(
        startDate,
        nextVenue?.hours || null,
        nextVenue?.id || nextVenue?.name
      );
    }
  };

  const handleStartDateChange = (date: string) => {
    if (!date) {
      setFormData((prev) => ({ ...prev, startAt: "" }));
      return;
    }

    if (isRecurringDefault && recurrenceData.frequency === "weekly") {
      const weekday = new Date(`${date}T00:00`).getDay();
      if (recurrenceData.daysOfWeek.length === 0) {
        setRecurrenceData((prev) => ({
          ...prev,
          daysOfWeek: [weekday],
        }));
      }
    }

    if (isRecurringDefault && recurrenceData.frequency === "monthly") {
      const weekday = new Date(`${date}T00:00`).getDay();
      setRecurrenceData((prev) => ({
        ...prev,
        daysOfWeek: [weekday],
      }));
    }

    const venueHours = selectedVenue?.hours || (venue?.hours as VenueHours);
    const dayHours = getVenueDayHours(date, venueHours);

    if (dayHours) {
      applyVenueHoursToDate(date, venueHours);
      return;
    }

    setFormData((prev) => {
      const startTime =
        getTimePart(prev.startAt) ||
        suggestedTitleTimeTemplate?.startTime ||
        "19:00";
      const nextStartAt = buildDateTime(date, startTime);
      const endTime =
        getTimePart(prev.endAt) || suggestedTitleTimeTemplate?.endTime;
      const nextEndAt = endTime
        ? buildDateTime(
            formatDatePart(
              addDays(
                new Date(`${date}T00:00`),
                suggestedTitleTimeTemplate?.endDayOffset ?? 0
              )
            ),
            endTime
          )
        : prev.endAt;
      return {
        ...prev,
        startAt: nextStartAt,
        endAt: nextEndAt,
      };
    });
  };

  const handleStartTimeChange = (time: string) => {
    const date = getDatePart(formData.startAt);
    if (!date) return;
    setFormData((prev) => ({
      ...prev,
      startAt: buildDateTime(date, time || "00:00"),
    }));
  };

  const handleEndDateChange = (date: string) => {
    if (!date) {
      setFormData((prev) => ({ ...prev, endAt: "" }));
      return;
    }
    setFormData((prev) => {
      const time =
        getTimePart(prev.endAt) ||
        suggestedTitleTimeTemplate?.endTime ||
        getTimePart(prev.startAt) ||
        "23:00";
      return {
        ...prev,
        endAt: buildDateTime(date, time),
      };
    });
  };

  const handleEndTimeChange = (time: string) => {
    const date = getDatePart(formData.endAt);
    if (!date) return;
    setFormData((prev) => ({
      ...prev,
      endAt: buildDateTime(date, time || "00:00"),
    }));
  };

  const toggleWeekday = (dayIndex: number) => {
    setRecurrenceData((prev) => {
      const exists = prev.daysOfWeek.includes(dayIndex);
      return {
        ...prev,
        daysOfWeek: exists
          ? prev.daysOfWeek.filter((day) => day !== dayIndex)
          : [...prev.daysOfWeek, dayIndex].sort((a, b) => a - b),
      };
    });
  };

  const isSubmitting =
    isSubmitLocked ||
    isSubmittingImage ||
    createMutation.isPending ||
    createRecurringMutation.isPending ||
    createVenueMutation.isPending;

  if ((venueId && isLoadingVenue) || (organizerId && isLoadingOrganizer)) {
    return (
      <div className="flex justify-center py-24">
        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
      </div>
    );
  }

  return (
    <>
      {!venueId && (
        <VenueSelector
          selectedVenue={selectedVenue}
          onVenueSelect={handleVenueSelect}
          isCreatingNew={isCreatingNewVenue}
          setIsCreatingNew={setIsCreatingNewVenue}
        />
      )}

      <OrganizerSelector
        selectedOrganizer={selectedOrganizer}
        onOrganizerSelect={setSelectedOrganizer}
      />

      <Card>
        <CardHeader>
          <CardTitle>
            {isRecurringDefault ? "Recurring Event Details" : "Event Details"}
            {venue && (
              <span className="ml-2 text-sm font-normal text-muted-foreground">
                at {venue.name}
              </span>
            )}
          </CardTitle>
        </CardHeader>
        <CardContent>
          <form onSubmit={handleSubmit} className="space-y-6">
            <div className="space-y-2">
              <Label htmlFor="image">Event Image</Label>
              <S3Uploader
                fileName="cover-image.png"
                currentImageUrl={formData.coverImageUrl}
                deferUpload
                onDeferredFileChange={setDeferredCoverImageFile}
                onUploadComplete={() => {}}
                onRemoveImage={() => {
                  setDeferredCoverImageFile(null);
                  setFormData({ ...formData, coverImageUrl: "" });
                }}
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="title">
                Event Title <span className="text-destructive">*</span>
              </Label>
              <div className="relative">
                <Input
                  id="title"
                  value={formData.title}
                  onFocus={() => setShowTitleSuggestions(true)}
                  onBlur={() => {
                    setTimeout(() => setShowTitleSuggestions(false), 120);
                  }}
                  onChange={(e) => {
                    setSuggestedTitleTimeTemplate(null);
                    setFormData({ ...formData, title: e.target.value });
                  }}
                  placeholder="Summer Music Festival"
                  autoComplete="off"
                  required
                />
                {showTitleSuggestions &&
                  selectedVenue?.id &&
                  titleQuery.length > 0 && (
                    <div className="absolute z-20 mt-1 max-h-64 w-full overflow-auto rounded-md border bg-popover p-1 shadow-md">
                      {isFetchingTitleSuggestions ? (
                        <div className="flex items-center gap-2 px-2 py-2 text-xs text-muted-foreground">
                          <Loader2 className="h-3.5 w-3.5 animate-spin" />
                          Looking up previous event names...
                        </div>
                      ) : visibleTitleSuggestions.length > 0 ? (
                        visibleTitleSuggestions.map((suggestion) => (
                          <button
                            key={suggestion.title}
                            type="button"
                            className="w-full rounded-sm px-2 py-1.5 text-left text-sm hover:bg-accent hover:text-accent-foreground"
                            onMouseDown={(e) => e.preventDefault()}
                            onClick={() => {
                              applySuggestedEventTimes(suggestion);
                              setShowTitleSuggestions(false);
                            }}
                          >
                            {suggestion.title}
                          </button>
                        ))
                      ) : (
                        <div className="px-2 py-2 text-xs text-muted-foreground">
                          No previous event names match this search.
                        </div>
                      )}
                    </div>
                  )}
              </div>
            </div>

            <div className="space-y-2">
              <Label htmlFor="description">Description</Label>
              <Textarea
                id="description"
                value={formData.description}
                onChange={(e) =>
                  setFormData({ ...formData, description: e.target.value })
                }
                placeholder="Describe your event..."
                rows={4}
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="eventUrl">Event URL</Label>
              <Input
                id="eventUrl"
                type="url"
                value={formData.eventUrl}
                onChange={(e) =>
                  setFormData({ ...formData, eventUrl: e.target.value })
                }
                placeholder="https://example.com/event"
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="categories">Categories</Label>
              <CategoryMultiSelect
                value={formData.categories}
                onChange={(categories) =>
                  setFormData({ ...formData, categories })
                }
                placeholder="Select categories..."
              />
            </div>

            <div className="space-y-2">
              <Label>Status</Label>
              <Select
                value={formData.status}
                onValueChange={(value) =>
                  setFormData({ ...formData, status: value as EventStatus })
                }
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {EVENT_STATUS_VALUES.map((status) => (
                    <SelectItem key={status} value={status}>
                      {getEventStatusLabel(status)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-2">
                <Label>
                  Start Date <span className="text-destructive">*</span>
                </Label>
                <DatePicker
                  value={getDatePart(formData.startAt)}
                  onChange={handleStartDateChange}
                  placeholder="Select start date"
                  required
                />
              </div>
              <div className="space-y-2">
                <Label>
                  Start Time <span className="text-destructive">*</span>
                </Label>
                <Input
                  type="time"
                  value={getTimePart(formData.startAt)}
                  onChange={(e) => handleStartTimeChange(e.target.value)}
                  disabled={!getDatePart(formData.startAt)}
                  required
                  className="h-12"
                />
              </div>
              <div className="space-y-2">
                <Label>End Date</Label>
                <DatePicker
                  value={getDatePart(formData.endAt)}
                  onChange={handleEndDateChange}
                  placeholder="Select end date"
                />
              </div>
              <div className="space-y-2">
                <Label>End Time</Label>
                <Input
                  type="time"
                  value={getTimePart(formData.endAt)}
                  onChange={(e) => handleEndTimeChange(e.target.value)}
                  disabled={!getDatePart(formData.endAt)}
                  className="h-12"
                />
              </div>
            </div>

            {isRecurringDefault && (
              <div className="space-y-4 rounded-xl border p-4">
                <div className="grid gap-4 sm:grid-cols-2">
                  <div className="space-y-2">
                    <Label>Repeat</Label>
                    <Select
                      value={recurrenceData.frequency}
                      onValueChange={(value) => {
                        const nextFrequency = value as
                          | "daily"
                          | "weekly"
                          | "monthly";
                        const startDate = getDatePart(formData.startAt);
                        const startWeekday = startDate
                          ? new Date(`${startDate}T00:00`).getDay()
                          : null;
                        setRecurrenceData((prev) => ({
                          ...prev,
                          frequency: nextFrequency,
                          daysOfWeek:
                            nextFrequency === "daily"
                              ? []
                              : nextFrequency === "monthly"
                                ? startWeekday == null
                                  ? []
                                  : [startWeekday]
                                : startWeekday == null
                                  ? []
                                  : prev.daysOfWeek.length > 0
                                    ? prev.daysOfWeek
                                    : [startWeekday],
                        }));
                      }}
                    >
                      <SelectTrigger>
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="daily">Daily</SelectItem>
                        <SelectItem value="weekly">Weekly</SelectItem>
                        <SelectItem value="monthly">Monthly</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="space-y-2">
                    <Label>Every</Label>
                    <Input
                      type="number"
                      min={1}
                      max={12}
                      value={recurrenceData.interval}
                      onChange={(e) =>
                        setRecurrenceData((prev) => ({
                          ...prev,
                          interval: Math.min(
                            12,
                            Math.max(1, Number(e.target.value) || 1)
                          ),
                        }))
                      }
                    />
                  </div>
                </div>

                {recurrenceData.frequency === "weekly" && (
                  <div className="space-y-2">
                    <Label>Days of week</Label>
                    <div className="flex flex-wrap gap-2">
                      {WEEKDAY_LABELS.map((label, index) => {
                        const selected =
                          recurrenceData.daysOfWeek.includes(index);
                        return (
                          <Button
                            key={label}
                            type="button"
                            variant={selected ? "default" : "outline"}
                            size="sm"
                            onClick={() => toggleWeekday(index)}
                          >
                            {label}
                          </Button>
                        );
                      })}
                    </div>
                    <p className="text-sm text-muted-foreground">
                      {weeklyPatternLabel
                        ? `Repeats every ${
                            recurrenceData.interval === 1
                              ? "week"
                              : `${recurrenceData.interval} weeks`
                          } on ${weeklyPatternLabel}.`
                        : "Select one or more weekdays to define weekly recurrence."}
                    </p>
                  </div>
                )}

                {recurrenceData.frequency === "daily" && (
                  <p className="text-sm text-muted-foreground">
                    Repeats every{" "}
                    {recurrenceData.interval === 1
                      ? "day"
                      : `${recurrenceData.interval} days`}{" "}
                    based on the start date.
                  </p>
                )}

                {recurrenceData.frequency === "monthly" && (
                  <div className="space-y-3">
                    <div className="space-y-2">
                      <Label>Pattern Date</Label>
                      <DatePicker
                        value={getDatePart(formData.startAt)}
                        onChange={handleStartDateChange}
                        placeholder="Select pattern date"
                      />
                    </div>
                    <p className="text-sm text-muted-foreground">
                      {monthlyPatternLabel
                        ? `Repeats on the ${monthlyPatternLabel} of every ${
                            recurrenceData.interval === 1
                              ? "month"
                              : `${recurrenceData.interval} months`
                          } based on the pattern date.`
                        : "Pick a pattern date to define monthly recurrence."}
                    </p>
                  </div>
                )}

                <div className="space-y-2">
                  <Label>End Date (optional)</Label>
                  <DatePicker
                    value={recurrenceData.untilDate}
                    onChange={(value) =>
                      setRecurrenceData((prev) => ({
                        ...prev,
                        untilDate: value,
                      }))
                    }
                    placeholder="No end date"
                  />
                </div>
              </div>
            )}

            <div className="flex justify-between gap-2">
              {onCancel && (
                <Button type="button" variant="outline" onClick={onCancel}>
                  Cancel
                </Button>
              )}
              <Button type="submit" disabled={isSubmitting}>
                {isSubmitting && (
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                )}
                {isRecurringDefault ? "Create Recurring Event" : "Create Event"}
              </Button>
            </div>
          </form>
        </CardContent>
      </Card>
    </>
  );
}
