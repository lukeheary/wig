"use client";

import { useEffect, useState } from "react";

const FALLBACK_CARD_COLOR = "rgb(18, 20, 26)";

function readableColorFromRgb(red: number, green: number, blue: number) {
  const darken = 0.46;
  const floor = 16;

  return `rgb(${Math.max(floor, Math.round(red * darken))}, ${Math.max(
    floor,
    Math.round(green * darken)
  )}, ${Math.max(floor, Math.round(blue * darken))})`;
}

function getSampleImageUrl(imageUrl: string) {
  if (imageUrl.startsWith("data:") || imageUrl.startsWith("blob:")) {
    return imageUrl;
  }

  return `/_next/image?url=${encodeURIComponent(imageUrl)}&w=64&q=75`;
}

export function useImageDominantColor(imageUrl: string | null | undefined) {
  const [color, setColor] = useState(FALLBACK_CARD_COLOR);

  useEffect(() => {
    if (!imageUrl) {
      setColor(FALLBACK_CARD_COLOR);
      return;
    }

    let isCancelled = false;
    const image = new window.Image();
    image.decoding = "async";

    image.onload = () => {
      if (isCancelled) return;

      const canvas = document.createElement("canvas");
      const width = 24;
      const height = 24;
      canvas.width = width;
      canvas.height = height;

      const context = canvas.getContext("2d", {
        willReadFrequently: true,
      });
      if (!context) return;

      try {
        context.drawImage(image, 0, 0, width, height);
        const pixels = context.getImageData(0, 0, width, height).data;
        let red = 0;
        let green = 0;
        let blue = 0;
        let count = 0;

        for (let y = Math.floor(height * 0.45); y < height; y += 1) {
          for (let x = 0; x < width; x += 1) {
            const index = (y * width + x) * 4;
            const alpha = pixels[index + 3];
            if (alpha < 128) continue;

            red += pixels[index];
            green += pixels[index + 1];
            blue += pixels[index + 2];
            count += 1;
          }
        }

        if (count > 0 && !isCancelled) {
          setColor(
            readableColorFromRgb(red / count, green / count, blue / count)
          );
        }
      } catch {
        if (!isCancelled) {
          setColor(FALLBACK_CARD_COLOR);
        }
      }
    };

    image.onerror = () => {
      if (!isCancelled) {
        setColor(FALLBACK_CARD_COLOR);
      }
    };

    image.src = getSampleImageUrl(imageUrl);

    return () => {
      isCancelled = true;
    };
  }, [imageUrl]);

  return color;
}
