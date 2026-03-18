"use client";

import { useRouter } from "next/navigation";
import { Loader2 } from "lucide-react";
import { trpc } from "@/lib/trpc";

export default function AdminLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const router = useRouter();

  const { data: adminCheck, isLoading: adminCheckLoading } =
    trpc.user.isAdmin.useQuery();
  const isAdmin = adminCheck?.isAdmin ?? false;

  if (adminCheckLoading) {
    return (
      <div className="flex h-[50vh] items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (!isAdmin) {
    router.push("/");
    return null;
  }

  return (
    <div className="container mx-auto flex justify-center pb-4">
      <div className="w-full">{children}</div>
    </div>
  );
}
