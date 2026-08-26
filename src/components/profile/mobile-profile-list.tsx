"use client";

import Image from "next/image";
import Link from "next/link";
import { Building2, ChevronLeft, MoreHorizontal } from "lucide-react";
import { UserAvatar } from "@/components/ui/user-avatar";

export function MobileProfileListHeader({ title }: { title: string }) {
  return (
    <div className="relative flex h-16 items-center justify-center">
      <Link
        href="/profile"
        aria-label="Back to profile"
        className="absolute left-0 flex h-12 w-12 items-center justify-center rounded-3xl border border-white/15 bg-[#242426]/85 text-white shadow-[0_18px_50px_rgba(0,0,0,0.55)] backdrop-blur-2xl"
      >
        <ChevronLeft className="h-6 w-6" />
      </Link>
      <h1 className="text-xl font-semibold text-white">{title}</h1>
    </div>
  );
}

export type MobileProfileUser = {
  id: string;
  firstName: string | null;
  lastName: string | null;
  username: string | null;
  avatarImageUrl: string | null;
};

export function MobileProfileUserRow({
  user,
  action,
}: {
  user: MobileProfileUser;
  action?: React.ReactNode;
}) {
  const name =
    [user.firstName, user.lastName].filter(Boolean).join(" ").trim() ||
    user.username ||
    "Wig user";
  const content = (
    <>
      <UserAvatar
        src={user.avatarImageUrl}
        name={name}
        identityKey={user.id}
        className="h-11 w-11 rounded-full"
        size={44}
      />
      <div className="min-w-0 flex-1">
        <p className="truncate text-[13px] font-semibold leading-tight text-white">
          {name}
        </p>
        {user.username ? (
          <p className="mt-0.5 truncate text-[10px] font-medium leading-tight text-white/50">
            @{user.username}
          </p>
        ) : null}
      </div>
    </>
  );

  return (
    <div className="flex min-h-[3.75rem] items-center gap-2.5 rounded-xl px-2 py-2">
      {user.username ? (
        <Link
          href={`/${user.username}`}
          className="flex min-w-0 flex-1 items-center gap-2.5"
        >
          {content}
        </Link>
      ) : (
        <div className="flex min-w-0 flex-1 items-center gap-2.5">
          {content}
        </div>
      )}
      {action ?? <MoreHorizontal className="h-5 w-5 text-white/85" />}
    </div>
  );
}

export function MobileFollowingRow({ place }: { place: any }) {
  return (
    <Link
      href={`/${place.type === "organizer" ? "organizer" : "venue"}/${place.slug}`}
      className="flex min-h-[3.75rem] items-center gap-2.5 rounded-xl px-2 py-2 active:bg-white/[0.06]"
    >
      <div className="relative h-11 w-11 shrink-0 overflow-hidden rounded-xl border border-white/10 bg-[#111113]">
        {place.logoImageUrl ? (
          <Image
            src={place.logoImageUrl}
            alt=""
            fill
            sizes="44px"
            className="object-cover"
          />
        ) : (
          <div className="flex h-full items-center justify-center">
            <Building2 className="h-5 w-5 text-white/25" />
          </div>
        )}
      </div>
      <div className="min-w-0 flex-1">
        <p className="truncate text-[13px] font-semibold leading-tight text-white">
          {place.name}
        </p>
        <p className="mt-0.5 text-[10px] font-medium capitalize leading-tight text-white/50">
          {place.type} · Following
        </p>
      </div>
    </Link>
  );
}

export function MobileProfileEmpty({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <div className="mt-4 flex min-h-40 items-center justify-center rounded-[1.75rem] border border-dashed border-white/15 px-6 text-center text-sm font-medium text-white/50">
      {children}
    </div>
  );
}
