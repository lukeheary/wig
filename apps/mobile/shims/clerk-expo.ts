import type { PropsWithChildren } from "react";

export function ClerkProvider({ children }: PropsWithChildren) {
  return children;
}

export function SignedIn() {
  return null;
}

export function SignedOut({ children }: PropsWithChildren) {
  return children;
}

export function useAuth() {
  return {
    isLoaded: true,
    isSignedIn: false,
    userId: null,
    getToken: async () => null,
    signOut: async () => {},
  };
}

export function useSignIn() {
  return {
    isLoaded: false,
    signIn: null,
    setActive: undefined,
  };
}

export function useSignUp() {
  return {
    isLoaded: false,
    signUp: null,
    setActive: undefined,
  };
}
