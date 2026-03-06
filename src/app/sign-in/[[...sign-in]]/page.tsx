import { SignIn } from "@clerk/nextjs";

export default function SignInPage() {
  return (
    <div className="flex min-h-screen items-center justify-center bg-background">
      <SignIn
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
