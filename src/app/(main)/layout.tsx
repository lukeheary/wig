"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter, usePathname } from "next/navigation";
import {
  MapPin,
  Building,
  Users,
  Plus,
  User,
  LogOut,
  Menu,
  Home,
  Search,
  Headset,
  Zap,
  CircleUserRound,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { trpc } from "@/lib/trpc";
import { UserAvatar } from "@/components/ui/user-avatar";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
  DropdownMenuSeparator,
} from "@/components/ui/dropdown-menu";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from "@/components/ui/sheet";
import { useAuth, useClerk } from "@clerk/nextjs";
import { NotificationsBell } from "@/components/notifications-bell";
import { WigLogo } from "@/components/ui/wig-logo";
import {
  NavbarSearchProvider,
  useNavbarSearch,
} from "@/contexts/nav-search-context";
import { cn } from "@/lib/utils";
import { buildReturnTo, withReturnTo } from "@/lib/navigation";
import { sendGoogleAnalyticsEvent } from "@/lib/google-analytics";
import * as VisuallyHidden from "@radix-ui/react-visually-hidden";

function MainLayoutContent({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const pathname = usePathname();
  const { signOut } = useClerk();
  const { isSignedIn, userId } = useAuth();
  const [hasMounted, setHasMounted] = useState(false);
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const signInHref = withReturnTo("/sign-in", buildReturnTo(pathname, null));
  const signUpHref = withReturnTo("/sign-up", buildReturnTo(pathname, null));
  const { data: adminCheck } = trpc.user.isAdmin.useQuery(undefined, {
    enabled: Boolean(isSignedIn),
  });
  const isAdmin = adminCheck?.isAdmin ?? false;

  const { data: user } = trpc.user.getCurrentUser.useQuery(undefined, {
    enabled: Boolean(isSignedIn),
  });
  const { data: hasVenues } = trpc.user.hasVenues.useQuery(undefined, {
    enabled: Boolean(isSignedIn),
  });
  const { data: hasOrganizers } = trpc.user.hasOrganizers.useQuery(undefined, {
    enabled: Boolean(isSignedIn),
  });

  // Redirect to onboarding if user hasn't completed it
  useEffect(() => {
    if (user?.isOnboarding) {
      router.push("/onboarding");
    }
  }, [user?.isOnboarding, router]);

  useEffect(() => {
    setHasMounted(true);
  }, []);

  const { showNavbarSearch, scrollToSearchAndFocus } = useNavbarSearch();

  const isHome = pathname === "/home";
  const isPlaces =
    pathname === "/places" ||
    pathname?.startsWith("/places/") ||
    pathname === "/venues-and-organizers" ||
    pathname?.startsWith("/venues-and-organizers/") ||
    pathname?.startsWith("/venue/") ||
    pathname?.startsWith("/organizer/");
  const isPlaceDetail =
    (pathname?.startsWith("/venue/") || pathname?.startsWith("/organizer/")) &&
    !pathname?.includes("/edit");
  const isFriends =
    pathname === "/activity" ||
    pathname?.startsWith("/activity/") ||
    pathname === "/friends" ||
    pathname?.startsWith("/friends/");
  const isProfile =
    pathname === "/profile" || pathname?.startsWith("/profile/");
  const isSupport = pathname === "/support";
  const isMyPlaces = pathname === "/my-places";
  const isAdminPage = pathname?.startsWith("/admin");
  const isEventDetail =
    pathname?.startsWith("/event/") && !pathname?.includes("/edit");
  const isSearchPage = pathname === "/activity/search";
  const shouldShowSignUp = !isSignedIn && isEventDetail;

  const handleSignOut = async () => {
    await signOut();
    window.location.assign("/");
  };

  const closeMobileMenu = () => {
    setMobileMenuOpen(false);
  };

  const handleLogoClick = (event: React.MouseEvent<HTMLAnchorElement>) => {
    if (!isSignedIn || !isHome) return;

    event.preventDefault();
    window.location.assign("/home");
  };

  const trackNavigationClick = (
    destination: string,
    location: "desktop_nav" | "mobile_menu" | "user_menu" | "auth"
  ) => {
    sendGoogleAnalyticsEvent("navigation_item_clicked", userId, {
      destination,
      location,
    });
  };

  return (
    <div className="relative flex min-h-screen flex-col">
      {/* Navigation Bar */}
      <header
        className={cn(
          "sticky top-0 z-40 border-transparent bg-background transition-colors duration-150",
          hasMounted && isSignedIn && "hidden md:block",
          isEventDetail
            ? "border-transparent bg-background md:border-transparent md:bg-transparent"
            : (isHome || isPlaceDetail) && showNavbarSearch
              ? "border-transparent bg-background"
              : "border-border bg-background"
        )}
      >
        <div className="container mx-auto flex h-14 items-center md:h-16">
          {/* Left Side - Logo */}
          <div className="flex items-center">
            <WigLogo
              href={isSignedIn ? "/home" : "/"}
              onClick={handleLogoClick}
            />
          </div>

          {/* Center - Desktop Navigation */}
          {isSignedIn ? (
            <nav className="absolute left-1/2 hidden -translate-x-1/2 items-center gap-2 md:flex">
              <Link
                href="/home"
                onClick={() => trackNavigationClick("/home", "desktop_nav")}
              >
                <Button
                  variant="ghost"
                  size="sm"
                  className={isHome ? "text-primary" : "text-muted-foreground"}
                >
                  Home
                </Button>
              </Link>
              <Link
                href="/places"
                onClick={() => trackNavigationClick("/places", "desktop_nav")}
              >
                <Button
                  variant="ghost"
                  size="sm"
                  className={
                    isPlaces ? "text-primary" : "text-muted-foreground"
                  }
                >
                  Places
                </Button>
              </Link>
              <Link
                href="/activity"
                onClick={() => trackNavigationClick("/activity", "desktop_nav")}
              >
                <Button
                  variant="ghost"
                  size="sm"
                  className={
                    isFriends
                      ? "gap-1 text-primary"
                      : "gap-1 text-muted-foreground"
                  }
                >
                  Activity
                </Button>
              </Link>
            </nav>
          ) : null}

          {/* Right Side - Spacer for mobile */}
          <div className="flex-1" />

          {/* Desktop Right Menu */}
          <div className="hidden items-center gap-2 md:flex md:gap-4">
            {/* Search button - only visible when scrolled on home/places/friends page */}
            <div
              className={cn(
                "overflow-hidden transition-all duration-200",
                (isHome || isPlaces || isFriends) && showNavbarSearch
                  ? "w-10 opacity-100"
                  : "w-0 opacity-0"
              )}
            >
              <Button
                variant="ghost"
                size="icon"
                onClick={scrollToSearchAndFocus}
                className="h-10 w-10"
              >
                <Search className="h-6 w-6" />
              </Button>
            </div>
            {hasMounted && isSignedIn ? (
              <>
                <NotificationsBell />
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <Button
                      variant="ghost"
                      size="icon"
                      className="rounded-full"
                    >
                      <UserAvatar
                        src={user?.avatarImageUrl}
                        name={user?.firstName}
                        identityKey={user?.id}
                        className="h-8 w-8"
                      />
                    </Button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="end" className="w-56">
                    <DropdownMenuItem asChild>
                      <Link
                        href="/profile"
                        onClick={() =>
                          trackNavigationClick("/profile", "user_menu")
                        }
                        className="flex cursor-pointer items-center gap-4"
                      >
                        <User className="h-4 w-4" />
                        My Profile
                      </Link>
                    </DropdownMenuItem>
                    <DropdownMenuItem asChild>
                      <Link
                        href="/support"
                        onClick={() =>
                          trackNavigationClick("/support", "user_menu")
                        }
                        className="flex cursor-pointer items-center gap-4"
                      >
                        <Headset className="h-4 w-4" />
                        Help & Feedback
                      </Link>
                    </DropdownMenuItem>
                    {(hasVenues || hasOrganizers) && (
                      <DropdownMenuItem asChild>
                        <Link
                          href="/my-places"
                          onClick={() =>
                            trackNavigationClick("/my-places", "user_menu")
                          }
                          className="flex cursor-pointer items-center gap-4"
                        >
                          <Building className="h-4 w-4" />
                          My Places
                        </Link>
                      </DropdownMenuItem>
                    )}
                    {isAdmin && (
                      <DropdownMenuItem asChild>
                        <Link
                          href="/admin"
                          onClick={() =>
                            trackNavigationClick("/admin", "user_menu")
                          }
                          className="flex cursor-pointer items-center gap-4"
                        >
                          <Plus className="h-4 w-4" />
                          Admin Settings
                        </Link>
                      </DropdownMenuItem>
                    )}
                    <DropdownMenuSeparator />
                    <DropdownMenuItem
                      onClick={handleSignOut}
                      className="cursor-pointer gap-4 text-red-500"
                    >
                      <LogOut className="h-4 w-4" />
                      Logout
                    </DropdownMenuItem>
                  </DropdownMenuContent>
                </DropdownMenu>
              </>
            ) : (
              <>
                <Link href={signInHref}>
                  <Button
                    variant="ghost"
                    onClick={() => trackNavigationClick(signInHref, "auth")}
                  >
                    Sign In
                  </Button>
                </Link>
                {shouldShowSignUp ? (
                  <Link href={signUpHref}>
                    <Button
                      onClick={() => trackNavigationClick(signUpHref, "auth")}
                    >
                      Sign Up
                    </Button>
                  </Link>
                ) : null}
              </>
            )}
          </div>

          {/* Mobile Right Menu - Bell and Menu */}
          <div className="flex flex-row items-center gap-2 md:hidden">
            {/* Search button - only visible when scrolled on home/places/friends page */}
            <div
              className={cn(
                "overflow-hidden transition-all duration-200",
                (isHome || isPlaces || isFriends) && showNavbarSearch
                  ? "w-10 opacity-100"
                  : "w-0 opacity-0"
              )}
            >
              <Button
                variant="ghost"
                size="icon"
                onClick={scrollToSearchAndFocus}
                className="h-10 w-10"
              >
                <Search className="h-5 w-5" />
              </Button>
            </div>

            {hasMounted && isSignedIn && <NotificationsBell />}

            {/* Mobile Menu */}
            {hasMounted && isSignedIn ? (
              <Sheet open={mobileMenuOpen} onOpenChange={setMobileMenuOpen}>
                <SheetTrigger asChild>
                  <Button variant="ghost" size="icon">
                    <Menu className="h-5" />
                  </Button>
                </SheetTrigger>
                <VisuallyHidden.Root>
                  <SheetTitle></SheetTitle>
                </VisuallyHidden.Root>
                <SheetContent
                  side="right"
                  className="w-[300px] px-4 sm:w-[400px]"
                >
                  <SheetHeader></SheetHeader>
                  <nav className="mt-8 flex flex-col gap-2">
                    <Link
                      href="/home"
                      onClick={() => {
                        trackNavigationClick("/home", "mobile_menu");
                        closeMobileMenu();
                      }}
                    >
                      <Button
                        variant="ghost"
                        className={`w-full justify-start px-4 text-base ${isHome ? "text-primary" : "text-muted-foreground"}`}
                        size="lg"
                      >
                        <Home className="mr-3 h-5 w-5" />
                        Home
                      </Button>
                    </Link>

                    <Link
                      href="/places"
                      onClick={() => {
                        trackNavigationClick("/places", "mobile_menu");
                        closeMobileMenu();
                      }}
                    >
                      <Button
                        variant="ghost"
                        className={`w-full justify-start px-4 text-base ${isPlaces ? "text-primary" : "text-muted-foreground"}`}
                        size="lg"
                      >
                        <MapPin className="mr-3 h-5 w-5" />
                        Places
                      </Button>
                    </Link>
                    <Link
                      href="/activity"
                      onClick={() => {
                        trackNavigationClick("/activity", "mobile_menu");
                        closeMobileMenu();
                      }}
                    >
                      <Button
                        variant="ghost"
                        className={`w-full justify-start px-4 text-base ${isFriends ? "text-primary" : "text-muted-foreground"}`}
                        size="lg"
                      >
                        <Users className="mr-3 h-5 w-5" />
                        Activity
                        {/*{receivedRequestsCount > 0 && (*/}
                        {/*  <span className="ml-2 flex h-5 w-5 items-center justify-center rounded-full bg-primary text-[11px] text-primary-foreground">*/}
                        {/*    {receivedRequestsCount}*/}
                        {/*  </span>*/}
                        {/*)}*/}
                      </Button>
                    </Link>

                    <div className="mt-4 flex flex-col gap-2 border-t pt-4">
                      <Link
                        href="/profile"
                        onClick={() => {
                          trackNavigationClick("/profile", "mobile_menu");
                          closeMobileMenu();
                        }}
                      >
                        <Button
                          variant="ghost"
                          className={`w-full justify-start px-4 text-base ${isProfile ? "text-primary" : "text-muted-foreground"}`}
                          size="lg"
                        >
                          <div className="mr-3 h-5 w-5 shrink-0">
                            <UserAvatar
                              src={user?.avatarImageUrl}
                              name={user?.firstName}
                              identityKey={user?.id}
                              className="h-full w-full"
                            />
                          </div>
                          My Profile
                        </Button>
                      </Link>
                      <Link
                        href="/support"
                        onClick={() => {
                          trackNavigationClick("/support", "mobile_menu");
                          closeMobileMenu();
                        }}
                      >
                        <Button
                          variant="ghost"
                          className={`w-full justify-start px-4 text-base ${isSupport ? "text-foreground" : "text-muted-foreground"}`}
                          size="lg"
                        >
                          <Headset className="mr-3 h-5 w-5" />
                          Help & Feedback
                        </Button>
                      </Link>
                      {(hasVenues || hasOrganizers) && (
                        <Link
                          href="/my-places"
                          onClick={() => {
                            trackNavigationClick("/my-places", "mobile_menu");
                            closeMobileMenu();
                          }}
                        >
                          <Button
                            variant="ghost"
                            className={`w-full justify-start px-4 text-base ${isMyPlaces ? "text-foreground" : "text-muted-foreground"}`}
                            size="lg"
                          >
                            <Building className="mr-3 h-5 w-5" />
                            My Places
                          </Button>
                        </Link>
                      )}
                      {isAdmin && (
                        <Link
                          href="/admin"
                          onClick={() => {
                            trackNavigationClick("/admin", "mobile_menu");
                            closeMobileMenu();
                          }}
                        >
                          <Button
                            variant="ghost"
                            className={`w-full justify-start px-4 text-base ${isAdminPage ? "text-foreground" : "text-muted-foreground"}`}
                            size="lg"
                          >
                            <Plus className="mr-3 h-5 w-5" />
                            Admin Settings
                          </Button>
                        </Link>
                      )}
                      <Button
                        variant="ghost"
                        className="w-full justify-start px-4 text-base text-red-500"
                        size="lg"
                        onClick={() => {
                          closeMobileMenu();
                          handleSignOut();
                        }}
                      >
                        <LogOut className="mr-3 h-5 w-5" />
                        Logout
                      </Button>
                    </div>
                  </nav>
                </SheetContent>
              </Sheet>
            ) : (
              <>
                <Link href={signInHref}>
                  <Button
                    variant="ghost"
                    onClick={() => trackNavigationClick(signInHref, "auth")}
                  >
                    Sign In
                  </Button>
                </Link>
                {shouldShowSignUp ? (
                  <Link href={signUpHref}>
                    <Button
                      onClick={() => trackNavigationClick(signUpHref, "auth")}
                    >
                      Sign Up
                    </Button>
                  </Link>
                ) : null}
              </>
            )}
          </div>
        </div>
      </header>

      {/* Main Content */}
      <main
        className={cn(
          "relative flex-1",
          hasMounted &&
            isSignedIn &&
            (isEventDetail
              ? "bg-black md:bg-background"
              : "mobile-bottom-nav-safe-space bg-black md:bg-background md:pb-0")
        )}
      >
        {children}
      </main>

      {hasMounted && isSignedIn && !isEventDetail ? (
        <>
          <div aria-hidden="true" className="mobile-bottom-nav-backdrop" />
          <nav
            aria-label="Primary navigation"
            className="mobile-bottom-nav fixed inset-x-3 z-50 mx-auto flex h-16 max-w-md items-stretch rounded-[2rem] border border-white/15 bg-[#242426]/85 p-1.5 shadow-[0_18px_50px_rgba(0,0,0,0.55)] backdrop-blur-2xl md:hidden"
          >
            <MobileTabLink href="/home" label="Home" active={isHome}>
              <Home />
            </MobileTabLink>
            <MobileTabLink href="/places" label="Places" active={isPlaces}>
              <Building />
            </MobileTabLink>
            <MobileTabLink
              href="/activity"
              label="Activity"
              active={isFriends && !isSearchPage}
            >
              <Zap />
            </MobileTabLink>
            <MobileTabLink
              href="/activity/search"
              label="Search"
              active={isSearchPage}
            >
              <Search />
            </MobileTabLink>
            <MobileTabLink href="/profile" label="Profile" active={isProfile}>
              <CircleUserRound />
            </MobileTabLink>
          </nav>
        </>
      ) : null}
    </div>
  );
}

function MobileTabLink({
  href,
  label,
  active,
  children,
}: {
  href: string;
  label: string;
  active: boolean;
  children: React.ReactElement<{ className?: string }>;
}) {
  return (
    <Link
      href={href}
      aria-label={label}
      aria-current={active ? "page" : undefined}
      className={cn(
        "flex min-w-0 flex-1 items-center justify-center rounded-full text-white/90 transition-colors active:bg-black/50 [&>svg]:h-7 [&>svg]:w-7 [&>svg]:stroke-[2.35]",
        active && "bg-black/75 text-sky-300"
      )}
    >
      {children}
    </Link>
  );
}

export default function MainLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <NavbarSearchProvider>
      <MainLayoutContent>{children}</MainLayoutContent>
    </NavbarSearchProvider>
  );
}
