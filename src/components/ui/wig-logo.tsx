import Link from "next/link";
import { type MouseEventHandler } from "react";
import { truculenta } from "@/lib/fonts";

interface WigLogoProps {
  asLink?: boolean;
  href?: string;
  onClick?: MouseEventHandler<HTMLAnchorElement>;
}

export function WigLogo({
  asLink = true,
  href = "/home",
  onClick,
}: WigLogoProps) {
  const inner = (
    <span className={"flex items-baseline gap-1"}>
      <span
        className={`${truculenta.className} text-4xl font-black tracking-wide`}
      >
        WIG
      </span>
      <span className="text-sm font-light tracking-wide opacity-50">beta</span>
    </span>
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
