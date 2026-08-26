import Link from "next/link";
import Image from "next/image";
import { type MouseEventHandler } from "react";
import { cn } from "@/lib/utils";

interface WigLogoProps {
  asLink?: boolean;
  href?: string;
  onClick?: MouseEventHandler<HTMLAnchorElement>;
  className?: string;
}

export function WigLogo({
  asLink = true,
  href = "/home",
  onClick,
  className,
}: WigLogoProps) {
  const inner = (
    <Image
      src="/wig-logo.svg"
      alt="WIG"
      width={1024}
      height={1024}
      priority
      className={cn("size-9 rounded-[0.28rem] md:size-10", className)}
    />
  );

  if (asLink) {
    return (
      <Link href={href} onClick={onClick}>
        {inner}
      </Link>
    );
  }

  return <div>{inner}</div>;
}
