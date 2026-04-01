"use client";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { slugToInstagramHandle } from "@/lib/place-identifiers";

interface SlugInstagramInputProps {
  slug: string;
  instagram: string;
  onSlugChange: (slug: string) => void;
  onInstagramChange: (instagram: string) => void;
  onBothChange?: (slug: string, instagram: string) => void;
  isSynced: boolean;
  onSyncedChange: (synced: boolean) => void;
  slugPlaceholder?: string;
  idPrefix?: string;
  required?: boolean;
  error?: string;
}

export function SlugInstagramInput({
  slug,
  instagram,
  onSlugChange,
  onInstagramChange,
  onBothChange,
  isSynced,
  onSyncedChange,
  slugPlaceholder = "venue-name",
  idPrefix = "slug",
  required = true,
  error,
}: SlugInstagramInputProps) {
  const handleSyncedInputChange = (value: string) => {
    const newInstagram = slugToInstagramHandle(value);
    if (onBothChange) {
      onBothChange(value, newInstagram);
    } else {
      onSlugChange(value);
      onInstagramChange(newInstagram);
    }
  };

  const handleSyncFields = () => {
    onSyncedChange(true);
    onInstagramChange(slugToInstagramHandle(slug));
  };

  const handleSeparateFields = () => {
    onSyncedChange(false);
  };

  if (isSynced) {
    return (
      <div>
        <div className="mb-2 flex items-center justify-between">
          <Label htmlFor={`${idPrefix}-slug-insta`}>
            Slug / Instagram Handle {required && "*"}
          </Label>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="h-auto px-2 py-1 text-xs text-muted-foreground hover:text-foreground"
            onClick={handleSeparateFields}
          >
            Separate Fields
          </Button>
        </div>
        <Input
          id={`${idPrefix}-slug-insta`}
          placeholder={slugPlaceholder}
          value={slug}
          onChange={(e) => handleSyncedInputChange(e.target.value)}
          className={error ? "border-destructive" : ""}
        />
        {error && <p className="mt-1 text-xs text-destructive">{error}</p>}
      </div>
    );
  }

  return (
    <div className="grid grid-cols-2 gap-4">
      <div>
        <div className="mb-2 flex items-center justify-between">
          <Label htmlFor={`${idPrefix}-slug`}>Slug {required && "*"}</Label>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="h-auto px-2 py-1 text-xs text-muted-foreground hover:text-foreground"
            onClick={handleSyncFields}
          >
            Sync with Instagram
          </Button>
        </div>
        <Input
          id={`${idPrefix}-slug`}
          placeholder={slugPlaceholder}
          value={slug}
          onChange={(e) => onSlugChange(e.target.value)}
          className={error ? "border-destructive" : ""}
        />
        {error && <p className="mt-1 text-xs text-destructive">{error}</p>}
      </div>
      <div>
        <Label htmlFor={`${idPrefix}-instagram`}>Instagram</Label>
        <Input
          id={`${idPrefix}-instagram`}
          placeholder={slugPlaceholder.replace(/-/g, "")}
          value={instagram}
          onChange={(e) => onInstagramChange(e.target.value)}
          className="mt-2"
        />
      </div>
    </div>
  );
}
