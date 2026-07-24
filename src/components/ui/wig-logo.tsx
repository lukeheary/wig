import Link from "next/link";
import Image from "next/image";
import { type MouseEventHandler } from "react";

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
    <Image
      src="/wig-logo.svg"
      alt="WIG"
      width={1024}
      height={1024}
      priority
      className="size-9 rounded-[0.28rem] md:size-10"
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
