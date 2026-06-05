"use client";

import { useState, useEffect } from "react";
import { useParams, useRouter, useSearchParams } from "next/navigation";
import { trpc } from "@/lib/trpc";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Card, CardContent } from "@/components/ui/card";
import { Calendar, Loader2 } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { S3Uploader } from "@/components/ui/s3-uploader";
import { format } from "date-fns";
import { eventTimeZone } from "@/lib/utils";
import { VenueSelector, VenueData } from "@/components/events/venue-selector";
import {
  OrganizerSelector,
  type OrganizerData,
} from "@/components/events/organizer-selector";
import { CategoryMultiSelect } from "@/components/category-multi-select";
import { DatePicker } from "@/components/ui/date-picker";
import { BackButtonHeader } from "@/components/shared/back-button-header";
import { PageContainer } from "@/components/shared/page-container";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  EVENT_STATUS_VALUES,
  getEventStatusLabel,
  type EventStatus,
} from "@/lib/event-status";
import { resolveBackHref, withReturnTo } from "@/lib/navigation";
import { withImageVersion } from "@/components/events/event-card-helpers";

export default function EditEventPage() {
  const params = useParams();
  const searchParams = useSearchParams();
  const eventId = params.id as string;
  const router = useRouter();
  const { toast } = useToast();
  const utils = trpc.useUtils();
  const returnTo = searchParams.get("returnTo");
  const eventDetailHref = withReturnTo(`/event/${eventId}`, returnTo);
  const afterDeleteHref = resolveBackHref({ returnTo, fallbackHref: "/home" });

  // Fetch event data
  const { data: event, isLoading: eventLoading } =
    trpc.event.getEventById.useQuery({
      eventId,
    });

  // Check if user is admin
  const { data: adminCheck } = trpc.user.isAdmin.useQuery();
  const isAdmin = adminCheck?.isAdmin ?? false;

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

  const [selectedVenue, setSelectedVenue] = useState<VenueData | null>(null);
  const [selectedOrganizer, setSelectedOrganizer] =
    useState<OrganizerData | null>(null);
  const [isCreatingNewVenue, setIsCreatingNewVenue] = useState(false);
  const [isDeleteDialogOpen, setIsDeleteDialogOpen] = useState(false);

  const createVenueMutation = trpc.place.createPlace.useMutation();

  const getDatePart = (value: string) => (value ? value.split("T")[0] : "");
  const getTimePart = (value: string) => (value ? value.split("T")[1] : "");
  const buildDateTime = (date: string, time: string) =>
    date ? `${date}T${time}` : "";

  const handleStartDateChange = (date: string) => {
    if (!date) {
      setFormData((prev) => ({ ...prev, startAt: "" }));
      return;
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

  const updateMutation = trpc.event.updateEvent.useMutation({
    onSuccess: async () => {
      await Promise.all([
        utils.event.getEventById.invalidate({ eventId }),
        utils.event.listEventsByRange.invalidate(),
        utils.event.getRecentlyAddedEvents.invalidate(),
      ]);

      // toast({
      //   title: "Success",
      //   description: "Event updated successfully",
      // });
      router.push(eventDetailHref);
    },
    onError: (error) => {
      toast({
        title: "Error",
        description: error.message,
        variant: "destructive",
      });
    },
  });

  const deleteMutation = trpc.event.deleteEvent.useMutation({
    onSuccess: (data) => {
      const deletedFutureCount = Math.max(0, data.deletedEvents - 1);
      const description = data.deletedRecurring
        ? deletedFutureCount > 0
          ? `Deleted this event and ${deletedFutureCount} upcoming occurrence${
              deletedFutureCount === 1 ? "" : "s"
            }.`
          : "Deleted this recurring event occurrence."
        : "The event has been removed from the platform";

      toast({
        title: "Event deleted",
        description,
      });

      void Promise.all([
        utils.event.getEventById.invalidate({ eventId }),
        utils.event.listEventsByRange.invalidate(),
        utils.event.getRecentlyAddedEvents.invalidate(),
      ]);

      router.push(afterDeleteHref);
    },
    onError: (error) => {
      toast({
        title: "Error",
        description: error.message,
        variant: "destructive",
      });
    },
  });

  // Populate form when event loads
  useEffect(() => {
    if (event) {
      setFormData({
        title: event.title || "",
        description: event.description || "",
        eventUrl: event.eventUrl || "",
        coverImageUrl: event.coverImageUrl || "",
        categories: event.categories || [],
        status: event.status,
        startAt: format(new Date(event.startAt), "yyyy-MM-dd'T'HH:mm"),
        endAt: event.endAt
          ? format(new Date(event.endAt), "yyyy-MM-dd'T'HH:mm")
          : "",
        address: event.address || "",
        city: event.city || "",
        state: event.state || "",
      });
      setSelectedVenue({
        id: event.venueId || undefined,
        name: event.venue?.name || "",
        address: event.address || "",
        city: event.city || "",
        state: event.state || "",
        slug: event.venue?.slug || "",
        instagram: event.venue?.instagram || "",
      });
      // If no venue ID, it was a manual entry, so we show it as "creating new" mode
      if (!event.venueId) {
        setIsCreatingNewVenue(true);
      }

      setSelectedOrganizer(
        event.organizerId && event.organizer
          ? {
              id: event.organizerId,
              name: event.organizer.name || "",
              city: event.organizer.city || "",
              state: event.organizer.state || "",
              slug: event.organizer.slug || "",
              instagram: event.organizer.instagram || "",
            }
          : null
      );
    }
  }, [event]);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();

    if (
      !formData.title ||
      !formData.startAt ||
      !formData.city ||
      !formData.state
    ) {
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

    const performUpdate = async () => {
      let finalVenueId = selectedVenue?.id;

      if (isCreatingNewVenue && selectedVenue) {
        try {
          const newVenue = await createVenueMutation.mutateAsync({
            type: "venue",
            name: selectedVenue.name,
            address: selectedVenue.address || undefined,
            city: selectedVenue.city,
            state: selectedVenue.state,
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

      updateMutation.mutate({
        eventId,
        title: formData.title,
        description: formData.description || undefined,
        eventUrl: formData.eventUrl || undefined,
        coverImageUrl: formData.coverImageUrl,
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
        venueId: finalVenueId,
        organizerId: selectedOrganizer?.id ?? null,
      });
    };

    performUpdate();
  };

  const handleDelete = () => {
    setIsDeleteDialogOpen(false);
    deleteMutation.mutate({ eventId });
  };

  if (eventLoading) {
    return (
      <div className="flex justify-center py-12">
        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (!event) {
    return (
      <div className="container mx-auto py-12 text-center">
        <Calendar className="mx-auto mb-4 h-12 w-12 text-muted-foreground" />
        <h2 className="mb-2 text-2xl font-bold">Event not found</h2>
        <p className="mb-4 text-muted-foreground">
          The event you&apos;re looking for doesn&apos;t exist
        </p>
      </div>
    );
  }

  return (
    <PageContainer className="max-w-2xl space-y-2">
      <Dialog open={isDeleteDialogOpen} onOpenChange={setIsDeleteDialogOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Delete Event?</DialogTitle>
            <DialogDescription>
              {event.seriesId
                ? "This will remove this occurrence and all future occurrences in the series."
                : "This event will be hidden across the platform."}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter className="gap-2">
            <Button
              type="button"
              variant="outline"
              onClick={() => setIsDeleteDialogOpen(false)}
              disabled={deleteMutation.isPending}
              className="w-full sm:w-auto"
            >
              Cancel
            </Button>
            <Button
              type="button"
              variant="destructive"
              onClick={handleDelete}
              disabled={deleteMutation.isPending}
              className="w-full sm:w-auto"
            >
              {deleteMutation.isPending && (
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              )}
              Delete Event
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <div className="flex flex-wrap items-center justify-between gap-3">
        <BackButtonHeader backHref={eventDetailHref} title="Edit Event" />
        <Button
          type="submit"
          form="edit-event-form"
          disabled={updateMutation.isPending || deleteMutation.isPending}
        >
          {updateMutation.isPending && (
            <Loader2 className="mr-2 h-4 w-4 animate-spin" />
          )}
          Update Event
        </Button>
      </div>

      <Card>
        <CardContent>
          <form
            id="edit-event-form"
            onSubmit={handleSubmit}
            className="space-y-6"
          >
            {/* Event Image */}
            <div className="space-y-2 pt-6">
              <Label htmlFor="image">Event Image</Label>
              <S3Uploader
                folder={`events/${eventId}`}
                fileName="cover-image.png"
                currentImageUrl={
                  withImageVersion(formData.coverImageUrl, event?.updatedAt) ||
                  undefined
                }
                onUploadComplete={(url) =>
                  setFormData({ ...formData, coverImageUrl: url })
                }
                onRemoveImage={() =>
                  setFormData({ ...formData, coverImageUrl: "" })
                }
              />
            </div>

            {/* Title */}
            <div className="space-y-2">
              <Label htmlFor="title">
                Event Title <span className="text-destructive">*</span>
              </Label>
              <Input
                id="title"
                value={formData.title}
                onChange={(e) =>
                  setFormData({ ...formData, title: e.target.value })
                }
                placeholder="Enter event title"
                required
              />
            </div>

            {/* Categories */}
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

            {/* Description */}
            <div className="space-y-2">
              <Label htmlFor="description">Description</Label>
              <Textarea
                id="description"
                value={formData.description}
                onChange={(e) =>
                  setFormData({ ...formData, description: e.target.value })
                }
                placeholder="Describe your event"
                rows={5}
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

            {/* Date & Time */}
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

            {/* Venue Details */}
            <VenueSelector
              selectedVenue={selectedVenue}
              onVenueSelect={setSelectedVenue}
              isCreatingNew={isCreatingNewVenue}
              setIsCreatingNew={setIsCreatingNewVenue}
            />

            <OrganizerSelector
              selectedOrganizer={selectedOrganizer}
              onOrganizerSelect={setSelectedOrganizer}
            />

            {/* Submit Button */}
            <div className="flex gap-3">
              <Button
                type="button"
                variant="outline"
                onClick={() => setIsDeleteDialogOpen(true)}
                disabled={updateMutation.isPending || deleteMutation.isPending}
                className="text-destructive hover:bg-destructive/10 hover:text-destructive"
              >
                {deleteMutation.isPending && (
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                )}
                Delete Event
              </Button>
              <Button
                type="button"
                variant="outline"
                onClick={() => router.push(eventDetailHref)}
                disabled={updateMutation.isPending || deleteMutation.isPending}
              >
                Cancel
              </Button>
              <Button
                type="submit"
                disabled={updateMutation.isPending || deleteMutation.isPending}
                className="flex-1"
              >
                {updateMutation.isPending && (
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                )}
                Update Event
              </Button>
            </div>
          </form>
        </CardContent>
      </Card>
    </PageContainer>
  );
}
