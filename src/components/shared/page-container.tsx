import * as React from "react";

import { cn } from "@/lib/utils";

type PageContainerProps = React.HTMLAttributes<HTMLDivElement>;

export function PageContainer({
  className,
  children,
  ...props
}: PageContainerProps) {
  return (
    <div className={cn("container mx-auto pt-4 pb-6", className)} {...props}>
      {children}
    </div>
  );
}
