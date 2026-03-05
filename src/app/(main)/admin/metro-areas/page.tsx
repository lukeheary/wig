"use client";

import { useState, useCallback } from "react";
import { trpc } from "@/lib/trpc";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent } from "@/components/ui/card";
import { useToast } from "@/hooks/use-toast";
import { MapPin, Plus, Pencil, Trash2 } from "lucide-react";
import { GooglePlacesAutocomplete } from "@/components/google-places-autocomplete";
import { BackButtonHeader } from "@/components/shared/back-button-header";

type ViewMode = "list" | "create" | "edit";

interface MetroFormData {
  name: string;
  state: string;
  latitude: string;
  longitude: string;
  radiusMiles: string;
}

const emptyForm: MetroFormData = {
  name: "",
  state: "",
  latitude: "",
  longitude: "",
  radiusMiles: "20",
};

export default function AdminMetroAreasPage() {
  const { toast } = useToast();
  const utils = trpc.useUtils();

  const [viewMode, setViewMode] = useState<ViewMode>("list");
  const [editingId, setEditingId] = useState<string | null>(null);
  const [form, setForm] = useState<MetroFormData>(emptyForm);
  const [citySearch, setCitySearch] = useState("");

  const { data: metroAreas } = trpc.admin.listMetroAreas.useQuery();

  const createMutation = trpc.admin.createMetroArea.useMutation({
    onSuccess: () => {
      // toast({ title: "Success", description: "Metro area created" });
      setViewMode("list");
      setForm(emptyForm);
      setCitySearch("");
      utils.admin.listMetroAreas.invalidate();
      utils.event.getAvailableCities.invalidate();
    },
    onError: (error) => {
      toast({
        title: "Error",
        description: error.message,
        variant: "destructive",
      });
    },
  });

  const updateMutation = trpc.admin.updateMetroArea.useMutation({
    onSuccess: () => {
      // toast({ title: "Success", description: "Metro area updated" });
      setViewMode("list");
      setEditingId(null);
      setForm(emptyForm);
      setCitySearch("");
      utils.admin.listMetroAreas.invalidate();
      utils.event.getAvailableCities.invalidate();
    },
    onError: (error) => {
      toast({
        title: "Error",
        description: error.message,
        variant: "destructive",
      });
    },
  });

  const deleteMutation = trpc.admin.deleteMetroArea.useMutation({
    onSuccess: () => {
      toast({ title: "Success", description: "Metro area deleted" });
      utils.admin.listMetroAreas.invalidate();
      utils.event.getAvailableCities.invalidate();
    },
    onError: (error) => {
      toast({
        title: "Error",
        description: error.message,
        variant: "destructive",
      });
    },
  });

  const handleCitySelect = useCallback(
    (place: {
      name: string;
      address: string;
      city: string;
      state: string;
      formattedAddress: string;
      latitude?: number;
      longitude?: number;
    }) => {
      setForm((f) => ({
        ...f,
        name: place.city,
        state: place.state,
        latitude: place.latitude != null ? String(place.latitude) : f.latitude,
        longitude:
          place.longitude != null ? String(place.longitude) : f.longitude,
      }));
      setCitySearch(place.city);
    },
    []
  );

  const handleCreate = () => {
    setForm(emptyForm);
    setCitySearch("");
    setViewMode("create");
  };

  const handleEdit = (metro: {
    id: string;
    name: string;
    state: string;
    latitude: number;
    longitude: number;
    radiusMiles: number;
  }) => {
    setEditingId(metro.id);
    setForm({
      name: metro.name,
      state: metro.state,
      latitude: String(metro.latitude),
      longitude: String(metro.longitude),
      radiusMiles: String(metro.radiusMiles),
    });
    setCitySearch(metro.name);
    setViewMode("edit");
  };

  const handleBack = () => {
    setViewMode("list");
    setEditingId(null);
    setForm(emptyForm);
    setCitySearch("");
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();

    const data = {
      name: form.name.trim(),
      state: form.state.trim().toUpperCase(),
      latitude: parseFloat(form.latitude),
      longitude: parseFloat(form.longitude),
      radiusMiles: parseFloat(form.radiusMiles),
    };

    if (
      !data.name ||
      !data.state ||
      isNaN(data.latitude) ||
      isNaN(data.longitude) ||
      isNaN(data.radiusMiles)
    ) {
      toast({
        title: "Error",
        description: "Please select a city and fill in all fields",
        variant: "destructive",
      });
      return;
    }

    if (viewMode === "edit" && editingId) {
      updateMutation.mutate({ id: editingId, ...data });
    } else {
      createMutation.mutate(data);
    }
  };

  const handleDelete = (id: string, name: string) => {
    if (window.confirm(`Delete metro area "${name}"?`)) {
      deleteMutation.mutate({ id });
    }
  };

  const isSubmitting = createMutation.isPending || updateMutation.isPending;

  // List View
  if (viewMode === "list") {
    return (
      <div className="space-y-6">
        <div className="flex items-center justify-between gap-3">
          <BackButtonHeader
            backHref="/admin"
            title="Metro Areas"
            className="min-w-0"
          />
          <Button onClick={handleCreate}>
            <Plus className="mr-2 h-4 w-4" />
            <span className="sm:hidden">Add</span>
            <span className="hidden sm:inline">Add Metro Area</span>
          </Button>
        </div>

        <div className="space-y-3">
          {metroAreas?.map((metro) => (
            <Card key={metro.id}>
              <CardContent className="flex flex-col justify-between gap-4 p-4 md:flex-row md:items-center">
                <div className="flex items-center gap-4">
                  <div className="flex h-12 w-12 items-center justify-center rounded-md border bg-muted">
                    <MapPin className="h-6 w-6 text-muted-foreground" />
                  </div>
                  <div>
                    <div className="font-medium">
                      {metro.name}, {metro.state}
                    </div>
                    <div className="text-sm text-muted-foreground">
                      {metro.latitude.toFixed(4)}, {metro.longitude.toFixed(4)}{" "}
                      &middot; {metro.radiusMiles} mi radius
                    </div>
                  </div>
                </div>

                <div className="flex gap-2">
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => handleEdit(metro)}
                  >
                    <Pencil className="mr-2 h-4 w-4" />
                    Edit
                  </Button>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => handleDelete(metro.id, metro.name)}
                    disabled={deleteMutation.isPending}
                  >
                    <Trash2 className="mr-2 h-4 w-4" />
                    Delete
                  </Button>
                </div>
              </CardContent>
            </Card>
          ))}
          {!metroAreas?.length && (
            <p className="py-8 text-center text-sm text-muted-foreground">
              No metro areas configured yet
            </p>
          )}
        </div>
      </div>
    );
  }

  // Create/Edit View
  return (
    <div className="space-y-6">
      <BackButtonHeader
        onBack={handleBack}
        title={viewMode === "edit" ? "Edit Metro Area" : "Add Metro Area"}
      />

      <Card>
        <CardContent className="pt-6">
          <form onSubmit={handleSubmit} className="space-y-4">
            <div className="space-y-2">
              <Label>City</Label>
              <GooglePlacesAutocomplete
                value={citySearch}
                onChange={setCitySearch}
                onPlaceSelect={handleCitySelect}
                placeholder="Search for a city..."
                searchType="cities"
              />
              {form.name && form.state && (
                <p className="text-xs text-muted-foreground">
                  Selected: {form.name}, {form.state}
                  {form.latitude && form.longitude && (
                    <>
                      {" "}
                      &middot; {parseFloat(form.latitude).toFixed(4)},{" "}
                      {parseFloat(form.longitude).toFixed(4)}
                    </>
                  )}
                </p>
              )}
            </div>

            <div className="space-y-2">
              <Label htmlFor="radiusMiles">Radius (miles)</Label>
              <Input
                id="radiusMiles"
                type="number"
                step="any"
                min="1"
                max="200"
                placeholder="e.g. 20"
                value={form.radiusMiles}
                onChange={(e) =>
                  setForm((f) => ({ ...f, radiusMiles: e.target.value }))
                }
              />
              <p className="text-xs text-muted-foreground">
                Events within this radius of the city center will be included
              </p>
            </div>

            <div className="flex gap-3 pt-2">
              <Button type="submit" disabled={isSubmitting}>
                {isSubmitting
                  ? "Saving..."
                  : viewMode === "edit"
                    ? "Update Metro Area"
                    : "Add Metro Area"}
              </Button>
              <Button type="button" variant="outline" onClick={handleBack}>
                Cancel
              </Button>
            </div>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}
