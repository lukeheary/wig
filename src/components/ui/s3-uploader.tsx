"use client";

import { useState, useRef, useEffect } from "react";
import { Button } from "@/components/ui/button";
import { Upload, Loader2, X, ImageIcon } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { cn } from "@/lib/utils";
import Image from "next/image";

interface S3UploaderProps {
  onUploadComplete: (url: string) => void;
  folder?: string;
  fileName?: string;
  currentImageUrl?: string;
  onRemoveImage?: () => void;
  variant?: "button" | "dropzone";
  className?: string;
  buttonText?: string;
  maxSizeMB?: number;
  aspectRatio?: "video" | "square";
}

export function S3Uploader({
  onUploadComplete,
  folder = "uploads",
  fileName,
  currentImageUrl,
  onRemoveImage,
  variant = "dropzone",
  className,
  buttonText = "Upload Image",
  maxSizeMB = 4,
  aspectRatio = "video",
}: S3UploaderProps) {
  const { toast } = useToast();
  const [isUploading, setIsUploading] = useState(false);
  const [dragActive, setDragActive] = useState(false);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [localPreviewUrl, setLocalPreviewUrl] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const getDroppedFile = (dataTransfer: DataTransfer) => {
    if (dataTransfer.files && dataTransfer.files.length > 0) {
      return dataTransfer.files[0];
    }

    if (dataTransfer.items && dataTransfer.items.length > 0) {
      for (const item of Array.from(dataTransfer.items)) {
        if (item.kind !== "file") continue;
        const file = item.getAsFile();
        if (file) return file;
      }
    }

    return null;
  };

  const isHttpUrl = (value: string) => {
    try {
      const parsed = new URL(value);
      return parsed.protocol === "http:" || parsed.protocol === "https:";
    } catch {
      return false;
    }
  };

  const getDroppedImageUrl = (dataTransfer: DataTransfer) => {
    const uriList = dataTransfer.getData("text/uri-list");
    if (uriList) {
      const firstUri = uriList
        .split("\n")
        .map((line) => line.trim())
        .find((line) => line.length > 0 && !line.startsWith("#"));
      if (firstUri && isHttpUrl(firstUri)) {
        return firstUri;
      }
    }

    const plainText = dataTransfer.getData("text/plain")?.trim();
    if (plainText && isHttpUrl(plainText)) {
      return plainText;
    }

    const html = dataTransfer.getData("text/html");
    if (html) {
      const srcMatch = html.match(/<img[^>]+src=["']([^"']+)["']/i);
      const src = srcMatch?.[1];
      if (src && isHttpUrl(src)) {
        return src;
      }
    }

    return null;
  };

  useEffect(() => {
    return () => {
      if (localPreviewUrl) {
        URL.revokeObjectURL(localPreviewUrl);
      }
    };
  }, [localPreviewUrl]);

  const handleFile = async (file: File) => {
    // Validate file type
    if (!file.type.startsWith("image/")) {
      toast({
        title: "Invalid file type",
        description: "Please select an image file",
        variant: "destructive",
      });
      return;
    }

    // Validate file size
    const maxSize = maxSizeMB * 1024 * 1024;
    if (file.size > maxSize) {
      toast({
        title: "File too large",
        description: `Please select an image smaller than ${maxSizeMB}MB`,
        variant: "destructive",
      });
      return;
    }

    const objectUrl = URL.createObjectURL(file);
    setLocalPreviewUrl((prev) => {
      if (prev) {
        URL.revokeObjectURL(prev);
      }
      return objectUrl;
    });
    setIsUploading(true);

    try {
      // Create form data
      const formData = new FormData();
      formData.append("file", file);
      formData.append("folder", folder);
      if (fileName) {
        formData.append("filename", fileName);
      }

      // Upload to API
      const response = await fetch("/api/upload", {
        method: "POST",
        body: formData,
      });

      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.error || "Upload failed");
      }

      const data = await response.json();

      toast({
        title: "Upload complete",
        description: "Image uploaded successfully",
      });

      // Store clean URL without cache-busting parameter
      onUploadComplete(data.url);

      // Force update the preview by setting local state with cache-busted URL
      setPreviewUrl(`${data.url}?t=${Date.now()}`);
    } catch (error) {
      console.error("Upload error:", error);
      toast({
        title: "Upload failed",
        description: error instanceof Error ? error.message : "Unknown error",
        variant: "destructive",
      });
    } finally {
      setIsUploading(false);
    }
  };

  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      handleFile(file);
    }
    // Allow selecting the same file again in a later attempt.
    e.target.value = "";
  };

  const handleDrag = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    if (e.type === "dragenter" || e.type === "dragover") {
      setDragActive(true);
    } else if (e.type === "dragleave") {
      setDragActive(false);
    }
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setDragActive(false);

    const file = getDroppedFile(e.dataTransfer);
    if (file) {
      handleFile(file);
      return;
    }

    const imageUrl = getDroppedImageUrl(e.dataTransfer);
    if (imageUrl) {
      handleUrlUpload(imageUrl);
      return;
    }

    toast({
      title: "No image found",
      description:
        "Drop an image file or image URL from a website to upload",
      variant: "destructive",
    });
  };

  const handleUrlUpload = async (imageUrl: string) => {
    setIsUploading(true);

    try {
      const response = await fetch("/api/upload-from-url", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          imageUrl,
          folder,
          filename: fileName,
        }),
      });

      const data = await response.json();
      if (!response.ok) {
        throw new Error(data.error || "Upload failed");
      }

      toast({
        title: "Upload complete",
        description: "Image uploaded successfully",
      });

      onUploadComplete(data.url);
      setPreviewUrl(`${data.url}?t=${Date.now()}`);
      setLocalPreviewUrl((prev) => {
        if (prev) {
          URL.revokeObjectURL(prev);
        }
        return null;
      });
    } catch (error) {
      console.error("Upload-from-url error:", error);
      toast({
        title: "Upload failed",
        description: error instanceof Error ? error.message : "Unknown error",
        variant: "destructive",
      });
    } finally {
      setIsUploading(false);
    }
  };

  const handleClick = () => {
    fileInputRef.current?.click();
  };

  const handleRemove = (e: React.MouseEvent) => {
    e.stopPropagation();
    setPreviewUrl(null);
    setLocalPreviewUrl((prev) => {
      if (prev) {
        URL.revokeObjectURL(prev);
      }
      return null;
    });
    if (onRemoveImage) {
      onRemoveImage();
    }
  };

  if (variant === "button") {
    return (
      <>
        <Button
          type="button"
          variant="outline"
          onClick={handleClick}
          disabled={isUploading}
          className={className}
        >
          {isUploading ? (
            <>
              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              Uploading...
            </>
          ) : (
            <>
              <Upload className="mr-2 h-4 w-4" />
              {buttonText}
            </>
          )}
        </Button>
        <input
          ref={fileInputRef}
          type="file"
          accept="image/*"
          className="hidden"
          onChange={handleChange}
          disabled={isUploading}
        />
      </>
    );
  }

  // Dropzone variant
  const displayUrl = previewUrl || localPreviewUrl || currentImageUrl;
  if (displayUrl) {
    return (
      <div
        className={cn("relative w-full", className)}
        onDragEnter={handleDrag}
        onDragLeave={handleDrag}
        onDragOver={handleDrag}
        onDrop={handleDrop}
        onClick={handleClick}
      >
        <input
          ref={fileInputRef}
          type="file"
          accept="image/*"
          className="hidden"
          onChange={handleChange}
          disabled={isUploading}
        />
        <div
          className={cn(
            "relative w-full overflow-hidden rounded-lg border",
            aspectRatio === "square" ? "aspect-square" : "aspect-video"
          )}
        >
          <Image
            src={displayUrl}
            alt="Uploaded image"
            fill
            className="object-cover"
            unoptimized
            onError={() => {
              // If the remote URL fails to load (common on some mobile browsers),
              // fall back to the local object URL preview when available.
              if (previewUrl) {
                setPreviewUrl(null);
              }
            }}
          />
          {dragActive && (
            <div className="absolute inset-0 flex items-center justify-center bg-background/70 text-sm font-medium">
              Drop image to replace
            </div>
          )}
        </div>
        {onRemoveImage && (
          <Button
            type="button"
            variant="destructive"
            size="icon"
            className="absolute right-2 top-2"
            onClick={handleRemove}
            disabled={isUploading}
          >
            <X className="h-4 w-4" />
          </Button>
        )}
      </div>
    );
  }

  return (
    <div
      className={cn(
        "relative w-full rounded-lg border-2 border-dashed p-6 text-center transition-colors hover:cursor-pointer hover:border-solid",
        dragActive && "border-primary bg-primary/5",
        isUploading && "opacity-50",
        className
      )}
      onDragEnter={handleDrag}
      onDragLeave={handleDrag}
      onDragOver={handleDrag}
      onDrop={handleDrop}
      onClick={handleClick}
    >
      <input
        ref={fileInputRef}
        type="file"
        accept="image/*"
        className="hidden"
        onChange={handleChange}
        disabled={isUploading}
      />

      {isUploading ? (
        <div className="flex flex-col items-center gap-2">
          <Loader2 className="h-12 w-12 animate-spin text-muted-foreground" />
          <p className="text-sm text-muted-foreground">Uploading...</p>
        </div>
      ) : (
        <div className="flex flex-col items-center gap-2">
          <ImageIcon className="h-12 w-12 text-muted-foreground" />
          <div>
            <p className="text-sm font-medium">
              Drop your image here or click to browse
            </p>
            <p className="mt-1 text-xs text-muted-foreground">
              Max {maxSizeMB}MB • PNG, JPG, GIF
            </p>
          </div>
        </div>
      )}
    </div>
  );
}
