import * as React from "react";
import { ArrowLeft } from "lucide-react";

import { Button } from "@/components/ui/button";
import { SharedBackButton } from "@/components/shared/back-button";
import { cn } from "@/lib/utils";

type BackButtonHeaderProps = {
  title?: string;
  subtitle?: string;
  backHref?: string;
  backFallbackHref?: string;
  returnTo?: string | null;
  onBack?: () => void;
  backLabel?: string;
  className?: string;
  titleClassName?: string;
  subtitleClassName?: string;
  children?: React.ReactNode;
};

export function BackButtonHeader({
  title,
  subtitle,
  backHref,
  backFallbackHref,
  returnTo,
  onBack,
  backLabel = "Back",
  className,
  titleClassName,
  subtitleClassName,
  children,
}: BackButtonHeaderProps) {
  const showBack = Boolean(backHref || backFallbackHref || onBack);

  return (
    <div className={cn("flex items-center gap-4", className)}>
      {showBack ? (
        onBack ? (
          <Button
            variant="ghost"
            size="icon"
            aria-label={backLabel}
            onClick={onBack}
            type="button"
          >
            <ArrowLeft className="h-5 w-5" />
          </Button>
        ) : (
          <SharedBackButton
            href={backHref}
            fallbackHref={backFallbackHref}
            returnTo={returnTo}
            backLabel={backLabel}
          />
        )
      ) : null}

      <div className="min-w-0">
        {children ? (
          children
        ) : (
          <div className="space-y-1">
            {title ? (
              <h1
                className={cn(
                  "text-[17px] font-bold tracking-tight md:text-3xl",
                  titleClassName
                )}
              >
                {title}
              </h1>
            ) : null}
            {subtitle ? (
              <p className={cn("text-muted-foreground", subtitleClassName)}>
                {subtitle}
              </p>
            ) : null}
          </div>
        )}
      </div>
    </div>
  );
}
