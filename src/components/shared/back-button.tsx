import Link from "next/link";
import type { MouseEventHandler } from "react";
import { ArrowLeft } from "lucide-react";

import { Button } from "@/components/ui/button";
import { resolveBackHref } from "@/lib/navigation";

type SharedBackButtonProps = {
  href?: string;
  fallbackHref?: string;
  returnTo?: string | null;
  backLabel?: string;
  className?: string;
  iconClassName?: string;
  variant?: "ghost" | "secondary" | "outline" | "default";
  size?: "default" | "sm" | "lg" | "icon";
  onClick?: MouseEventHandler<HTMLAnchorElement>;
};

export function SharedBackButton({
  href,
  fallbackHref = "/",
  returnTo,
  backLabel = "Back",
  className,
  iconClassName = "h-5 w-5",
  variant = "ghost",
  size = "icon",
  onClick,
}: SharedBackButtonProps) {
  const targetHref =
    href ??
    resolveBackHref({
      returnTo,
      fallbackHref,
    });

  return (
    <Button
      asChild
      variant={variant}
      size={size}
      aria-label={backLabel}
      className={className}
    >
      <Link href={targetHref} onClick={onClick}>
        <ArrowLeft className={iconClassName} />
      </Link>
    </Button>
  );
}
