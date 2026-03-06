import { SignUp } from "@clerk/nextjs";

export default function SignUpPage() {
  return (
    <div className="flex min-h-screen items-center justify-center bg-background">
      <SignUp
        forceRedirectUrl="/onboarding"
        appearance={{
          elements: {
            rootBox: "w-full flex justify-center bg-transparent",
            cardBox: "shadow-none",
            card: "border border-border bg-card shadow-none",
          },
        }}
      />
    </div>
  );
}
