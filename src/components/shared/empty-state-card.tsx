"use client";

import type { LucideIcon } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";

interface EmptyStateCardProps {
  icon: LucideIcon;
  title: string;
  description?: string;
  className?: string;
  showCard?: boolean;
}

export function EmptyStateCard({
  icon: Icon,
  title,
  description,
  className,
  showCard = true,
}: EmptyStateCardProps) {
  const content = (
    <div className={showCard ? "py-8 text-center" : "py-6 text-center"}>
      <Icon className="mx-auto mb-4 h-12 w-12 text-muted-foreground" />
      <p className="text-muted-foreground">{title}</p>
      {description ? (
        <p className="mt-2 text-sm text-muted-foreground">{description}</p>
      ) : null}
    </div>
  );

  if (!showCard) {
    return <div className={className}>{content}</div>;
  }

  return (
    <Card className={className}>
      <CardContent className="pt-6">{content}</CardContent>
    </Card>
  );
}
