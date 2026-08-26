"use client";

import { AuthenticateWithRedirectCallback } from "@clerk/nextjs";

export default function SsoCallbackPage() {
  return (
    <main className="flex min-h-screen items-center justify-center bg-black text-white">
      <AuthenticateWithRedirectCallback />
      <p className="text-sm text-white/60">Finishing sign in…</p>
    </main>
  );
}
