"use client";

import { useEffect, useState } from "react";
import { useParams, useRouter, useSearchParams } from "next/navigation";
import { format } from "date-fns";
import { Loader2, Repeat } from "lucide-react";
import { trpc } from "@/lib/trpc";
import { useToast } from "@/hooks/use-toast";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { S3Uploader } from "@/components/ui/s3-uploader";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { CategoryMultiSelect } from "@/components/category-multi-select";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { DatePicker } from "@/components/ui/date-picker";
import { Button } from "@/components/ui/button";
import { BackButtonHeader } from "@/components/shared/back-button-header";
import {
  EVENT_STATUS_VALUES,
  getEventStatusLabel,
  type EventStatus,
} from "@/lib/event-status";
import { resolveBackHref } from "@/lib/navigation";

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

export default function EditEventSeriesPage() {
  const params = useParams();
  const searchParams = useSearchParams();
  const seriesId = params.id as string;
  const router = useRouter();
  const { toast } = useToast();
  const utils = trpc.useUtils();
  const returnTo = searchParams.get("returnTo");
  const backHref = resolveBackHref({ returnTo, fallbackHref: "/home" });

  const { data: series, isLoading } = trpc.event.getEventSeriesById.useQuery({
    seriesId,
  });

  const updateSeriesMutation = trpc.event.updateEventSeries.useMutation({
    onSuccess: async (data) => {
      await Promise.all([
        utils.event.getEventSeriesById.invalidate({ seriesId }),
        utils.place.getPlaceBySlug.invalidate(),
      ]);
      toast({
        title: "Recurring series updated",
        description:
          data.createdEvents > 0
            ? `Rebuilt ${data.createdEvents} upcoming occurrences`
            : "Changes saved",
      });
      router.push(backHref);
    },
    onError: (error) => {
      toast({
        title: "Error",
        description: error.message,
        variant: "destructive",
      });
    },
  });

  const deleteSeriesMutation = trpc.event.deleteEventSeries.useMutation({
    onSuccess: async (data) => {
      await Promise.all([
        utils.event.getEventSeriesById.invalidate({ seriesId }),
        utils.place.getPlaceBySlug.invalidate(),
      ]);
      toast({
        title: "Recurring series deleted",
        description:
          data.deletedEvents > 0
            ? `Deleted series and ${data.deletedEvents} occurrence${
                data.deletedEvents === 1 ? "" : "s"
              }`
            : "Deleted series",
      });
      router.push(backHref);
    },
    onError: (error) => {
      toast({
        title: "Error",
        description: error.message,
        variant: "destructive",
      });
    },
  });

  const [formData, setFormData] = useState({
    title: "",
    description: "",
    coverImageUrl: "",
    categories: [] as string[],
    status: "active" as EventStatus,
    visibility: "public" as "public" | "private",
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

  const getDatePart = (value: string) => (value ? value.split("T")[0] : "");
  const getTimePart = (value: string) => (value ? value.split("T")[1] : "");
  const buildDateTime = (date: string, time: string) =>
    date ? `${date}T${time}` : "";

  useEffect(() => {
    if (!series) return;

    const startAt = new Date(series.startAt);
    const endAt =
      typeof series.durationMinutes === "number" && series.durationMinutes > 0
        ? new Date(startAt.getTime() + series.durationMinutes * 60 * 1000)
        : null;

    const { categories: rawCategories } = series as { categories?: unknown };
    const categories = Array.isArray(rawCategories)
      ? rawCategories.filter(
          (value): value is string => typeof value === "string"
        )
      : [];
    const daysOfWeek = Array.isArray(series.daysOfWeek)
      ? series.daysOfWeek.filter(
          (value): value is number =>
            typeof value === "number" && value >= 0 && value <= 6
        )
      : [];

    setFormData({
      title: series.title || "",
      description: series.description || "",
      coverImageUrl: series.coverImageUrl || "",
      categories,
      status: series.status as EventStatus,
      visibility: series.visibility,
      startAt: format(startAt, "yyyy-MM-dd'T'HH:mm"),
      endAt: endAt ? format(endAt, "yyyy-MM-dd'T'HH:mm") : "",
      address: series.address || "",
      city: series.city || "",
      state: series.state || "",
    });

    setRecurrenceData({
      frequency: series.frequency,
      interval: series.interval,
      daysOfWeek,
      untilDate: series.untilDate
        ? format(new Date(series.untilDate), "yyyy-MM-dd")
        : "",
    });
  }, [series]);

  const monthlyPatternLabel = (() => {
    if (recurrenceData.frequency !== "monthly") return null;
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
    if (recurrenceData.frequency !== "weekly") return null;
    if (recurrenceData.daysOfWeek.length === 0) return null;
    return recurrenceData.daysOfWeek
      .map((day) => FULL_WEEKDAY_LABELS[day] ?? WEEKDAY_LABELS[day])
      .join(", ");
  })();

  const handleStartDateChange = (date: string) => {
    if (!date) {
      setFormData((prev) => ({ ...prev, startAt: "" }));
      return;
    }

    if (
      recurrenceData.frequency === "weekly" &&
      recurrenceData.daysOfWeek.length === 0
    ) {
      const weekday = new Date(`${date}T00:00`).getDay();
      setRecurrenceData((prev) => ({
        ...prev,
        daysOfWeek: [weekday],
      }));
    }

    if (recurrenceData.frequency === "monthly") {
      const weekday = new Date(`${date}T00:00`).getDay();
      setRecurrenceData((prev) => ({
        ...prev,
        daysOfWeek: [weekday],
      }));
    }

    setFormData((prev) => {
      const startTime = getTimePart(prev.startAt) || "19:00";
      const endDate = getDatePart(prev.endAt);
      const endTime = getTimePart(prev.endAt) || "23:00";
      return {
        ...prev,
        startAt: buildDateTime(date, startTime),
        endAt: endDate ? buildDateTime(date, endTime) : prev.endAt,
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
        getTimePart(prev.endAt) || getTimePart(prev.startAt) || "23:00";
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

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();

    if (
      !formData.title ||
      !formData.startAt ||
      !formData.city ||
      !formData.state
    ) {
      toast({
        title: "Validation error",
        description: "Please fill in all required fields",
        variant: "destructive",
      });
      return;
    }

    const startDate = new Date(formData.startAt);
    const endDate = formData.endAt ? new Date(formData.endAt) : null;

    if (endDate && endDate <= startDate) {
      toast({
        title: "Validation error",
        description: "End time must be after start time",
        variant: "destructive",
      });
      return;
    }

    if (
      recurrenceData.frequency === "weekly" &&
      recurrenceData.daysOfWeek.length === 0
    ) {
      toast({
        title: "Validation error",
        description: "Select at least one weekday for a weekly recurrence",
        variant: "destructive",
      });
      return;
    }

    if (recurrenceData.untilDate) {
      const untilDate = new Date(`${recurrenceData.untilDate}T23:59:59`);
      if (untilDate < startDate) {
        toast({
          title: "Validation error",
          description: "Series end date must be on or after the start date",
          variant: "destructive",
        });
        return;
      }
    }

    updateSeriesMutation.mutate({
      seriesId,
      title: formData.title,
      description: formData.description || undefined,
      coverImageUrl: formData.coverImageUrl,
      categories: formData.categories,
      status: formData.status,
      visibility: formData.visibility,
      startAt: startDate,
      endAt: endDate || undefined,
      address: formData.address || undefined,
      city: formData.city,
      state: formData.state,
      timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone || undefined,
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
  };

  const handleDeleteSeries = () => {
    const confirmed = window.confirm(
      "Delete this recurring series? This will permanently delete the series and all events generated from it."
    );
    if (!confirmed) return;
    deleteSeriesMutation.mutate({ seriesId });
  };

  if (isLoading) {
    return (
      <div className="flex justify-center py-12">
        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (!series) {
    return (
      <div className="container mx-auto py-12 text-center">
        <Repeat className="mx-auto mb-4 h-12 w-12 text-muted-foreground" />
        <h2 className="mb-2 text-2xl font-bold">Recurring series not found</h2>
        <p className="mb-4 text-muted-foreground">
          The recurring event series you&apos;re looking for doesn&apos;t exist
        </p>
      </div>
    );
  }

  const isSaving = updateSeriesMutation.isPending;
  const isDeleting = deleteSeriesMutation.isPending;
  const isSubmitting = isSaving || isDeleting;

  return (
    <div className="container mx-auto max-w-2xl space-y-6 pb-4">
      <BackButtonHeader
        backFallbackHref="/home"
        returnTo={returnTo}
        title="Edit Recurring Event"
      />

      <Card>
        <CardHeader>
          <CardTitle>Recurring Event Details</CardTitle>
        </CardHeader>
        <CardContent>
          <form onSubmit={handleSubmit} className="space-y-6">
            <div className="space-y-2">
              <Label htmlFor="image">Event Image</Label>
              <S3Uploader
                folder={`event-series/${seriesId}`}
                fileName="cover-image.png"
                currentImageUrl={formData.coverImageUrl}
                onUploadComplete={(url: string) =>
                  setFormData((prev) => ({ ...prev, coverImageUrl: url }))
                }
                onRemoveImage={() =>
                  setFormData((prev) => ({ ...prev, coverImageUrl: "" }))
                }
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="title">
                Event Title <span className="text-destructive">*</span>
              </Label>
              <Input
                id="title"
                value={formData.title}
                onChange={(e) =>
                  setFormData((prev) => ({ ...prev, title: e.target.value }))
                }
                required
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="description">Description</Label>
              <Textarea
                id="description"
                value={formData.description}
                onChange={(e) =>
                  setFormData((prev) => ({
                    ...prev,
                    description: e.target.value,
                  }))
                }
                rows={4}
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="categories">Categories</Label>
              <CategoryMultiSelect
                value={formData.categories}
                onChange={(categories) =>
                  setFormData((prev) => ({ ...prev, categories }))
                }
                placeholder="Select categories..."
              />
            </div>

            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-2">
                <Label>Status</Label>
                <Select
                  value={formData.status}
                  onValueChange={(value) =>
                    setFormData((prev) => ({
                      ...prev,
                      status: value as EventStatus,
                    }))
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

              <div className="space-y-2">
                <Label>Visibility</Label>
                <Select
                  value={formData.visibility}
                  onValueChange={(value) =>
                    setFormData((prev) => ({
                      ...prev,
                      visibility: value as "public" | "private",
                    }))
                  }
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="public">Public</SelectItem>
                    <SelectItem value="private">Private</SelectItem>
                  </SelectContent>
                </Select>
              </div>
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

            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-2">
                <Label>
                  City <span className="text-destructive">*</span>
                </Label>
                <Input
                  value={formData.city}
                  onChange={(e) =>
                    setFormData((prev) => ({ ...prev, city: e.target.value }))
                  }
                  required
                />
              </div>
              <div className="space-y-2">
                <Label>
                  State <span className="text-destructive">*</span>
                </Label>
                <Input
                  value={formData.state}
                  maxLength={2}
                  onChange={(e) =>
                    setFormData((prev) => ({
                      ...prev,
                      state: e.target.value.toUpperCase(),
                    }))
                  }
                  required
                />
              </div>
            </div>

            <div className="space-y-2">
              <Label>Address</Label>
              <Input
                value={formData.address}
                onChange={(e) =>
                  setFormData((prev) => ({ ...prev, address: e.target.value }))
                }
                placeholder="Street address"
              />
            </div>

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
                <p className="text-sm text-muted-foreground">
                  {monthlyPatternLabel
                    ? `Repeats on the ${monthlyPatternLabel} of every ${
                        recurrenceData.interval === 1
                          ? "month"
                          : `${recurrenceData.interval} months`
                      } based on the pattern date.`
                    : "Pick a pattern date to define monthly recurrence."}
                </p>
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

            <div className="flex justify-between gap-2">
              <div className="flex gap-2">
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => router.push(backHref)}
                  disabled={isSubmitting}
                >
                  Cancel
                </Button>
                <Button
                  type="button"
                  variant="destructive"
                  onClick={handleDeleteSeries}
                  disabled={isSubmitting}
                >
                  {isDeleting && (
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  )}
                  Delete Series
                </Button>
              </div>
              <Button type="submit" disabled={isSubmitting}>
                {isSaving && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                Save Recurring Event
              </Button>
            </div>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}
