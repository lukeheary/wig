import { sanitizeReturnTo } from "@/lib/navigation";
import { SignInPageClient } from "./sign-in-page-client";

export default async function SignInPage({
  searchParams,
}: {
  searchParams?: Promise<{ returnTo?: string }> | { returnTo?: string };
}) {
  const params = searchParams ? await searchParams : undefined;
  const returnTo = sanitizeReturnTo(params?.returnTo);

  return (
    <div className="flex min-h-screen items-center justify-center bg-background">
      <SignInPageClient returnTo={returnTo ?? "/home"} />
    </div>
  );
}
