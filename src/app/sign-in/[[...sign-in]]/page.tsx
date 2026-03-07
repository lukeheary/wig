import { SignIn } from "@clerk/nextjs";
import { sanitizeReturnTo } from "@/lib/navigation";

export default async function SignInPage({
  searchParams,
}: {
  searchParams?: Promise<{ returnTo?: string }> | { returnTo?: string };
}) {
  const params = searchParams ? await searchParams : undefined;
  const returnTo = sanitizeReturnTo(params?.returnTo);

  return (
    <div className="flex min-h-screen items-center justify-center bg-background">
      <SignIn
        fallbackRedirectUrl={returnTo ?? "/home"}
        forceRedirectUrl={returnTo ?? "/home"}
      />
    </div>
  );
}
