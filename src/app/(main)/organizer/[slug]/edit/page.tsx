"use client";

import { useParams, useRouter, useSearchParams } from "next/navigation";
import { trpc } from "@/lib/trpc";
import { Button } from "@/components/ui/button";
import { Building, Loader2 } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import {
  PlaceEditForm,
  type PlaceFormData,
} from "@/components/places/place-edit-form";
import Link from "next/link";
import { BackButtonHeader } from "@/components/shared/back-button-header";
import { PageContainer } from "@/components/shared/page-container";
import { resolveBackHref } from "@/lib/navigation";

export default function EditPlacePage() {
  const params = useParams();
  const searchParams = useSearchParams();
  const slug = params.slug as string;
  const router = useRouter();
  const { toast } = useToast();
  const returnTo = searchParams.get("returnTo");
  const backHref = resolveBackHref({
    returnTo,
    fallbackHref: `/organizer/${slug}`,
  });

  // Fetch place data
  const { data: place, isLoading: placeLoading } =
    trpc.place.getPlaceBySlug.useQuery({ slug });

  // Check if user is admin
  const { data: adminCheck } = trpc.user.isAdmin.useQuery();
  const isAdmin = adminCheck?.isAdmin ?? false;

  // Get current user
  const { data: currentUser } = trpc.user.getCurrentUser.useQuery();
  const { data: scraperConfigs = [] } = trpc.admin.listScrapers.useQuery(
    { placeId: place?.id ?? "" },
    { enabled: isAdmin && !!place?.id }
  );

  const updateMutation = trpc.place.updatePlace.useMutation();
  const replaceScrapersMutation = trpc.admin.replacePlaceScrapers.useMutation();

  // Check if user can edit this place
  const isMember =
    currentUser &&
    place?.members?.some((member: any) => member.userId === currentUser.id);
  const canEdit = isAdmin || isMember;

  const handleSubmit = async (formData: PlaceFormData) => {
    if (!place) return;

    if (!formData.slug || !formData.name) {
      toast({
        title: "Validation Error",
        description: "Please fill in all required fields",
        variant: "destructive",
      });
      return;
    }

    const isVenue = place.type === "venue";
    if (isVenue && (!formData.city || !formData.state)) {
      toast({
        title: "Validation Error",
        description: "City and state are required for venues",
        variant: "destructive",
      });
      return;
    }

    try {
      await updateMutation.mutateAsync({
        placeId: place.id,
        slug: formData.slug,
        name: formData.name,
        description: formData.description || undefined,
        logoImageUrl: formData.logoImageUrl,
        coverImageUrl: formData.coverImageUrl,
        address: formData.address || undefined,
        city: formData.city || undefined,
        state: formData.state || undefined,
        website: formData.website || undefined,
        instagram: formData.instagram || undefined,
        latitude: formData.latitude ?? undefined,
        longitude: formData.longitude ?? undefined,
        hours: formData.hours ?? undefined,
        categories: formData.categories,
      });

      if (isAdmin) {
        await replaceScrapersMutation.mutateAsync({
          placeId: place.id,
          scrapers: formData.scrapers,
        });
      }

      router.push(`/organizer/${formData.slug || slug}`);
    } catch (error) {
      toast({
        title: "Error",
        description:
          error instanceof Error ? error.message : "Failed to update place",
        variant: "destructive",
      });
    }
  };

  if (placeLoading) {
    return (
      <div className="flex justify-center py-12">
        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (!place) {
    return (
      <div className="container mx-auto py-12 text-center">
        <Building className="mx-auto mb-4 h-12 w-12 text-muted-foreground" />
        <h2 className="mb-2 text-2xl font-bold">Place not found</h2>
        <p className="mb-4 text-muted-foreground">
          The place you&apos;re looking for doesn&apos;t exist
        </p>
        <Link href="/places">
          <Button>Browse Places</Button>
        </Link>
      </div>
    );
  }

  if (!canEdit) {
    return (
      <div className="container mx-auto py-12 text-center">
        <Building className="mx-auto mb-4 h-12 w-12 text-muted-foreground" />
        <h2 className="mb-2 text-2xl font-bold">Access Denied</h2>
        <p className="mb-4 text-muted-foreground">
          You don&apos;t have permission to edit this place
        </p>
        <Link href={`/organizer/${slug}`}>
          <Button>Back to Place</Button>
        </Link>
      </div>
    );
  }

  const isVenue = place.type === "venue";
  const typeLabel = isVenue ? "Venue" : "Organizer";

  const initialData: Partial<PlaceFormData> = {
    type: place.type as "venue" | "organizer",
    slug: place.slug || "",
    name: place.name || "",
    description: place.description || "",
    logoImageUrl: place.logoImageUrl || "",
    coverImageUrl: (place as any).coverImageUrl || "",
    address: place.address || "",
    city: place.city || "",
    state: place.state || "",
    website: place.website || "",
    instagram: place.instagram || "",
    latitude: place.latitude || null,
    longitude: place.longitude || null,
    hours: (place as any).hours || null,
    categories: place.categories || [],
    scrapers: scraperConfigs.map((scraperConfig) => ({
      id: scraperConfig.id,
      scraper: scraperConfig.scraper,
      searchString: scraperConfig.searchString,
      classificationName: scraperConfig.classificationName ?? "",
    })),
  };

  return (
    <PageContainer className="max-w-2xl space-y-2">
      <BackButtonHeader backHref={backHref} title={`Edit ${typeLabel}`} />

      <PlaceEditForm
        initialData={initialData}
        placeType={place.type as "venue" | "organizer"}
        placeId={place.id}
        mode="edit"
        onSubmit={handleSubmit}
        onCancel={() => router.push(backHref)}
        isSubmitting={updateMutation.isPending || replaceScrapersMutation.isPending}
        showScraperFields={isAdmin}
      />
    </PageContainer>
  );
}
