"use client";

import { useState, useEffect, useCallback } from "react";
import { useRouter } from "next/navigation";
import { trpc } from "@/lib/trpc";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent } from "@/components/ui/card";
import { UserAvatar } from "@/components/ui/user-avatar";
import { Separator } from "@/components/ui/separator";
import { useUser, useReverification } from "@clerk/nextjs";
import {
  CalendarDays,
  ChevronLeft,
  ChevronRight,
  Loader2,
  Mail,
  MapPin,
} from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { GooglePlacesAutocomplete } from "@/components/google-places-autocomplete";
import { S3Uploader } from "@/components/ui/s3-uploader";
import { DateOfBirthInput } from "@/components/ui/date-of-birth-input";
import { PageContainer } from "@/components/shared/page-container";
import { StickySectionHeader } from "@/components/ui/sticky-section-header";
import { isReservedUsername } from "@/lib/reserved-usernames";
import { isAtLeastMinimumAge } from "@/lib/age-requirement";

export default function ProfilePage() {
  const router = useRouter();
  const { toast } = useToast();
  const utils = trpc.useUtils();
  const { user: clerkUser, isLoaded: isClerkLoaded } = useUser();

  const {
    data: user,
    isLoading,
    isError,
  } = trpc.user.getCurrentUser.useQuery();
  const { data: myPartner } = trpc.partners.getMyPartner.useQuery();
  const { data: pendingPartnerRequests } =
    trpc.partners.getPendingPartnerRequests.useQuery();
  const { data: acceptedFriends } = trpc.friends.listFriends.useQuery({
    statusFilter: "accepted",
  });

  const [firstName, setFirstName] = useState("");
  const [lastName, setLastName] = useState("");
  const [username, setUsername] = useState("");
  const [avatarImageUrl, setImageUrl] = useState("");
  const [city, setCity] = useState("");
  const [state, setState] = useState("");
  const [gender, setGender] = useState<"male" | "female" | "other" | "">("");
  const [searchCity, setSearchCity] = useState("");
  const [dobDay, setDobDay] = useState("");
  const [dobMonth, setDobMonth] = useState("");
  const [dobYear, setDobYear] = useState("");
  const [initialDob, setInitialDob] = useState("");
  const [newEmail, setNewEmail] = useState("");
  const [emailCode, setEmailCode] = useState("");
  const [emailStep, setEmailStep] = useState<"idle" | "code">("idle");
  const [pendingEmail, setPendingEmail] = useState<any>(null);
  const [isEmailLoading, setIsEmailLoading] = useState(false);
  const [isDeletingAccount, setIsDeletingAccount] = useState(false);
  const [partnerSearch, setPartnerSearch] = useState("");

  const createEmailAddress = useReverification((email: string) =>
    clerkUser?.createEmailAddress({ email })
  );

  // Restore email change flow after Clerk reverification reload
  useEffect(() => {
    const savedEmail = sessionStorage.getItem("wig_pending_email");
    if (savedEmail && isClerkLoaded && clerkUser) {
      sessionStorage.removeItem("wig_pending_email");
      setNewEmail(savedEmail);
      setIsEmailLoading(true);

      (async () => {
        try {
          const res = await clerkUser.createEmailAddress({ email: savedEmail });
          await clerkUser.reload();
          const emailAddress = clerkUser.emailAddresses.find(
            (a) => a.id === res?.id
          );
          if (!emailAddress)
            throw new Error("Could not find the new email address");
          await emailAddress.prepareVerification({ strategy: "email_code" });
          setPendingEmail(emailAddress);
          setEmailStep("code");
          toast({
            title: "Verification sent",
            description: "Check your email for the verification code",
          });
        } catch (error: any) {
          toast({
            title: "Error",
            description:
              error?.errors?.[0]?.message ||
              error?.message ||
              "Failed to start email update",
            variant: "destructive",
          });
          setNewEmail("");
        } finally {
          setIsEmailLoading(false);
        }
      })();
    }
  }, [isClerkLoaded, clerkUser]);
  // const [isEditing, setIsEditing] = useState(false);

  const normalizeDob = (value?: string | Date | null) => {
    if (!value) return "";
    if (value instanceof Date) {
      const year = value.getUTCFullYear();
      const month = String(value.getUTCMonth() + 1).padStart(2, "0");
      const day = String(value.getUTCDate()).padStart(2, "0");
      return `${year}-${month}-${day}`;
    }
    const match = value.match(/^(\d{4})-(\d{2})-(\d{2})/);
    if (!match) return "";
    return `${match[1]}-${match[2]}-${match[3]}`;
  };

  const isValidDateOfBirth = (
    dayValue: string,
    monthValue: string,
    yearValue: string
  ) => {
    const day = Number.parseInt(dayValue, 10);
    const month = Number.parseInt(monthValue, 10);
    const year = Number.parseInt(yearValue, 10);

    if (!day && !month && !year) return true;
    if (!day || !month || !year) return false;
    if (year < 1900 || year > new Date().getFullYear()) return false;
    if (month < 1 || month > 12) return false;
    if (day < 1 || day > 31) return false;

    const candidate = new Date(Date.UTC(year, month - 1, day));
    const dateOfBirth = `${String(year).padStart(4, "0")}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
    return (
      candidate.getUTCFullYear() === year &&
      candidate.getUTCMonth() === month - 1 &&
      candidate.getUTCDate() === day &&
      isAtLeastMinimumAge(dateOfBirth)
    );
  };

  // Initialize form when user data loads
  useEffect(() => {
    if (user) {
      setFirstName(user.firstName || "");
      setLastName(user.lastName || "");
      setUsername(user.username || "");
      setImageUrl(user.avatarImageUrl || "");
      setCity(user.city || "");
      setState(user.state || "");
      setGender(user.gender || "");
      setSearchCity(user.city || "");

      const dob = normalizeDob(user.dateOfBirth);
      if (dob) {
        const [year, month, day] = dob.split("-");
        setDobYear(year);
        setDobMonth(month);
        setDobDay(day);
      } else {
        setDobYear("");
        setDobMonth("");
        setDobDay("");
      }
      setInitialDob(dob);
    }
  }, [user]);

  const updateProfileMutation = trpc.user.updateProfile.useMutation({
    onSuccess: (data) => {
      console.log("Profile updated successfully:", data);
      // toast({
      //   title: "Profile updated",
      //   description: "Your profile has been updated successfully",
      // });
      // Invalidate all user-related queries to refresh data
      utils.user.getCurrentUser.invalidate();
      utils.user.isAdmin.invalidate();
      // setIsEditing(false);
    },
    onError: (error) => {
      console.error("Profile update error:", error);
      toast({
        title: "Error",
        description: error.message,
        variant: "destructive",
      });
    },
  });

  const updateEmailMutation = trpc.user.updateEmail.useMutation({
    onSuccess: () => {
      toast({
        title: "Email updated",
        description: "Your email has been updated successfully",
      });
      utils.user.getCurrentUser.invalidate();
    },
    onError: (error) => {
      toast({
        title: "Error",
        description: error.message,
        variant: "destructive",
      });
    },
  });

  const invalidatePartnerQueries = () => {
    utils.partners.getMyPartner.invalidate();
    utils.partners.getPendingPartnerRequests.invalidate();
    utils.friends.listFriends.invalidate();
  };

  const sendPartnerRequestMutation =
    trpc.partners.sendPartnerRequest.useMutation({
      onSuccess: () => {
        toast({
          title: "Partner request sent",
          description: "Your partner request has been sent",
        });
        setPartnerSearch("");
        invalidatePartnerQueries();
      },
      onError: (error) => {
        toast({
          title: "Error",
          description: error.message,
          variant: "destructive",
        });
      },
    });

  const acceptPartnerRequestMutation =
    trpc.partners.acceptPartnerRequest.useMutation({
      onSuccess: () => {
        toast({
          title: "Partner request accepted",
          description: "Your partner has been set",
        });
        invalidatePartnerQueries();
      },
      onError: (error) => {
        toast({
          title: "Error",
          description: error.message,
          variant: "destructive",
        });
      },
    });

  const declinePartnerRequestMutation =
    trpc.partners.declinePartnerRequest.useMutation({
      onSuccess: () => {
        toast({
          title: "Partner request removed",
        });
        invalidatePartnerQueries();
      },
      onError: (error) => {
        toast({
          title: "Error",
          description: error.message,
          variant: "destructive",
        });
      },
    });

  const removePartnerMutation = trpc.partners.removePartner.useMutation({
    onSuccess: () => {
      toast({
        title: "Partner removed",
      });
      invalidatePartnerQueries();
    },
    onError: (error) => {
      toast({
        title: "Error",
        description: error.message,
        variant: "destructive",
      });
    },
  });

  const handleImageUpload = (url: string) => {
    setImageUrl(url);
    // Immediately update the profile with the new image URL
    updateProfileMutation.mutate({
      avatarImageUrl: url,
    });
  };

  const handleCitySelect = useCallback(
    (place: {
      name: string;
      address: string;
      city: string;
      state: string;
      formattedAddress: string;
    }) => {
      setCity(place.city);
      setState(place.state);
      setSearchCity(place.city);
    },
    []
  );

  const handleSave = () => {
    const normalizedUsername = username.trim().toLowerCase();
    const isValidUsername = /^[a-zA-Z0-9_]{3,20}$/.test(normalizedUsername);

    if (!isValidUsername) {
      toast({
        title: "Validation Error",
        description:
          "Username must be 3-20 characters and contain only letters, numbers, and underscores",
        variant: "destructive",
      });
      return;
    }

    if (isReservedUsername(normalizedUsername)) {
      toast({
        title: "Username Taken",
        description: "Username is already taken",
        variant: "destructive",
      });
      return;
    }

    if (!isValidDateOfBirth(dobDay, dobMonth, dobYear)) {
      toast({
        title: "Validation Error",
        description: "You must be at least 13 years old to use WIG",
        variant: "destructive",
      });
      return;
    }

    const dateOfBirth =
      dobDay && dobMonth && dobYear
        ? `${dobYear.padStart(4, "0")}-${dobMonth.padStart(2, "0")}-${dobDay.padStart(2, "0")}`
        : undefined;

    updateProfileMutation.mutate({
      username: normalizedUsername,
      firstName: firstName || undefined,
      lastName: lastName || undefined,
      avatarImageUrl: avatarImageUrl || undefined,
      city: city || undefined,
      state: state || undefined,
      gender: gender || undefined,
      dateOfBirth,
    });
  };

  const handleStartEmailUpdate = async () => {
    if (!isClerkLoaded || !clerkUser) {
      toast({
        title: "Please wait",
        description: "Account details are still loading",
      });
      return;
    }

    if (!newEmail) {
      toast({
        title: "Validation Error",
        description: "Please enter a new email address",
        variant: "destructive",
      });
      return;
    }

    setIsEmailLoading(true);
    // Save to sessionStorage in case Clerk reverification causes a page reload
    sessionStorage.setItem("wig_pending_email", newEmail);
    try {
      const res = await createEmailAddress(newEmail);
      sessionStorage.removeItem("wig_pending_email");
      await clerkUser.reload();
      const emailAddress = clerkUser.emailAddresses.find(
        (a) => a.id === res?.id
      );
      if (!emailAddress) {
        throw new Error("Could not find the new email address");
      }
      await emailAddress.prepareVerification({ strategy: "email_code" });
      setPendingEmail(emailAddress);
      setEmailStep("code");
      toast({
        title: "Verification sent",
        description: "Check your email for the verification code",
      });
    } catch (error: any) {
      sessionStorage.removeItem("wig_pending_email");
      toast({
        title: "Error",
        description:
          error?.errors?.[0]?.message ||
          error?.message ||
          "Failed to start email update",
        variant: "destructive",
      });
    } finally {
      setIsEmailLoading(false);
    }
  };

  const handleVerifyEmail = async () => {
    if (!pendingEmail) return;
    if (!emailCode) {
      toast({
        title: "Validation Error",
        description: "Please enter the verification code",
        variant: "destructive",
      });
      return;
    }

    setIsEmailLoading(true);
    try {
      const verifiedEmail = await pendingEmail.attemptVerification({
        code: emailCode,
      });

      if (verifiedEmail?.verification?.status !== "verified") {
        toast({
          title: "Verification Failed",
          description: "Please check the code and try again",
          variant: "destructive",
        });
        setIsEmailLoading(false);
        return;
      }

      await clerkUser?.update({
        primaryEmailAddressId: verifiedEmail.id,
      });

      await updateEmailMutation.mutateAsync({
        email: verifiedEmail.emailAddress,
      });

      setEmailStep("idle");
      setEmailCode("");
      setPendingEmail(null);
      setNewEmail("");
    } catch (error: any) {
      toast({
        title: "Error",
        description: error?.errors?.[0]?.message || "Failed to verify email",
        variant: "destructive",
      });
    } finally {
      setIsEmailLoading(false);
    }
  };

  const handleCancel = () => {
    if (user) {
      setFirstName(user.firstName || "");
      setLastName(user.lastName || "");
      setUsername(user.username || "");
      setImageUrl(user.avatarImageUrl || "");
      setCity(user.city || "");
      setState(user.state || "");
      setGender(user.gender || "");
      setSearchCity(user.city || "");

      const dob = normalizeDob(user.dateOfBirth);
      if (dob) {
        const [year, month, day] = dob.split("-");
        setDobYear(year);
        setDobMonth(month);
        setDobDay(day);
      } else {
        setDobYear("");
        setDobMonth("");
        setDobDay("");
      }
      setInitialDob(dob);
    }
    // setIsEditing(false);
  };

  const handleDeleteAccount = async () => {
    const confirmation = window.prompt(
      "This permanently deletes your profile and all associated data. Type DELETE to confirm."
    );
    if (confirmation !== "DELETE" || !clerkUser) return;

    setIsDeletingAccount(true);
    try {
      const response = await fetch("/api/mobile/account", { method: "DELETE" });
      if (!response.ok) {
        const result = await response.json().catch(() => null);
        throw new Error(result?.error || "We couldn't delete your account.");
      }
      await clerkUser.delete();
      window.location.assign("/");
    } catch (error) {
      toast({
        title: "Account deletion failed",
        description:
          error instanceof Error ? error.message : "Please try again.",
        variant: "destructive",
      });
      setIsDeletingAccount(false);
    }
  };

  if (isLoading) {
    return (
      <div className="flex justify-center py-12">
        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (!user || isError) {
    return (
      <div className="container mx-auto py-12 text-center">
        <p className="text-muted-foreground">
          {isError
            ? "Error loading profile. Please try again."
            : "User not found"}
        </p>
      </div>
    );
  }

  const partnerMutationsBusy =
    sendPartnerRequestMutation.isPending ||
    acceptPartnerRequestMutation.isPending ||
    declinePartnerRequestMutation.isPending ||
    removePartnerMutation.isPending;

  const pendingSentRelationship =
    myPartner?.status === "pending" && myPartner.isRequester ? myPartner : null;
  const pendingReceivedRelationship =
    myPartner?.status === "pending" && !myPartner.isRequester
      ? myPartner
      : pendingPartnerRequests?.[0]
        ? {
            id: pendingPartnerRequests[0].id,
            partner: pendingPartnerRequests[0].partner,
            status: pendingPartnerRequests[0].status,
            isRequester: false,
          }
        : null;
  const acceptedRelationship =
    myPartner?.status === "accepted" ? myPartner : null;

  const acceptedFriendCandidates = (acceptedFriends || [])
    .map((friendship) => friendship.friend)
    .filter((friend): friend is NonNullable<typeof friend> => Boolean(friend));
  const filteredPartnerCandidates = acceptedFriendCandidates.filter(
    (friend) => {
      const fullName = `${friend.firstName || ""} ${friend.lastName || ""}`
        .trim()
        .toLowerCase();
      const query = partnerSearch.trim().toLowerCase();
      return (
        query.length === 0 ||
        fullName.includes(query) ||
        (friend.username || "").toLowerCase().includes(query)
      );
    }
  );

  const dateOfBirthValue =
    dobYear && dobMonth && dobDay
      ? `${dobYear.padStart(4, "0")}-${dobMonth.padStart(2, "0")}-${dobDay.padStart(2, "0")}`
      : "";
  const latestAllowedBirthday = new Date(
    new Date().setFullYear(new Date().getFullYear() - 13)
  )
    .toISOString()
    .slice(0, 10);
  const profileIsUnchanged =
    username === (user.username || "") &&
    firstName === (user.firstName || "") &&
    lastName === (user.lastName || "") &&
    city === (user.city || "") &&
    state === (user.state || "") &&
    gender === (user.gender || "") &&
    dateOfBirthValue === initialDob;
  const mobileFieldClass =
    "h-12 rounded-[14px] border-white/[0.09] bg-white/[0.065] px-4 text-[15px] font-medium text-white placeholder:text-white/45 focus:border-white/20";
  const mobileLabelClass = "text-[14px] font-semibold text-white/80";

  return (
    <>
      <main className="min-h-screen bg-gradient-to-b from-black to-[#0e0e11] pb-8 md:hidden">
        <header className="sticky top-0 z-30 grid h-[70px] grid-cols-[1fr_auto_1fr] items-center bg-black/90 px-4 backdrop-blur-xl">
          <Button
            type="button"
            variant="ghost"
            size="icon"
            onClick={() => router.back()}
            aria-label="Back"
            className="h-[46px] w-[46px] rounded-full border border-white/15 bg-[#242426]/85 text-white backdrop-blur-2xl"
          >
            <ChevronLeft className="h-[17px] w-[17px] stroke-[3]" />
          </Button>
          <h1 className="text-[17px] font-semibold text-white">Edit Profile</h1>
          <Button
            type="button"
            onClick={handleSave}
            disabled={updateProfileMutation.isPending || profileIsUnchanged}
            className="ml-auto h-[46px] rounded-full bg-white px-[18px] text-[15px] font-bold text-black hover:bg-white disabled:opacity-35"
          >
            {updateProfileMutation.isPending && (
              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
            )}
            Save
          </Button>
        </header>

        <div className="space-y-6 px-4 pt-4">
          <section className="space-y-2">
            <Label className={mobileLabelClass}>Name</Label>
            <div className="grid grid-cols-2 gap-2">
              <Input
                aria-label="First name"
                value={firstName}
                onChange={(event) => setFirstName(event.target.value)}
                placeholder="First name"
                className={mobileFieldClass}
              />
              <Input
                aria-label="Last name"
                value={lastName}
                onChange={(event) => setLastName(event.target.value)}
                placeholder="Last name"
                className={mobileFieldClass}
              />
            </div>
          </section>

          <section className="space-y-2">
            <Label className={mobileLabelClass}>Email</Label>
            {emailStep === "idle" && !newEmail ? (
              <button
                type="button"
                onClick={() => setNewEmail(user.email)}
                className="flex h-12 w-full items-center gap-3 rounded-[14px] border border-white/[0.09] bg-white/[0.065] px-4 text-left"
              >
                <Mail className="h-[17px] w-[17px] text-white/60" />
                <span className="min-w-0 flex-1 truncate text-[15px] font-medium text-white">
                  {user.email}
                </span>
                <ChevronRight className="h-4 w-4 text-white/35" />
              </button>
            ) : emailStep === "idle" ? (
              <div className="space-y-2">
                <Input
                  type="email"
                  value={newEmail}
                  onChange={(event) => setNewEmail(event.target.value)}
                  className={mobileFieldClass}
                  placeholder="New email address"
                />
                <div className="flex gap-2">
                  <Button
                    type="button"
                    size="sm"
                    onClick={handleStartEmailUpdate}
                    disabled={isEmailLoading || newEmail === user.email}
                  >
                    Send verification code
                  </Button>
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    onClick={() => setNewEmail("")}
                  >
                    Cancel
                  </Button>
                </div>
              </div>
            ) : (
              <div className="space-y-2">
                <Input
                  inputMode="numeric"
                  value={emailCode}
                  onChange={(event) => setEmailCode(event.target.value)}
                  className={mobileFieldClass}
                  placeholder="Verification code"
                />
                <Button
                  type="button"
                  size="sm"
                  onClick={handleVerifyEmail}
                  disabled={isEmailLoading || !emailCode}
                >
                  Verify and update
                </Button>
              </div>
            )}
            <p className="text-[12px] font-medium text-white/40">
              Used to sign in and receive account emails
            </p>
          </section>

          <section className="space-y-2">
            <Label htmlFor="mobile-username" className={mobileLabelClass}>
              Username
            </Label>
            <Input
              id="mobile-username"
              value={username}
              onChange={(event) =>
                setUsername(event.target.value.toLowerCase())
              }
              className={mobileFieldClass}
            />
            <p className="text-[12px] font-medium text-white/40">
              3-20 characters · letters, numbers, and underscores
            </p>
          </section>

          <section className="space-y-2">
            <Label className={mobileLabelClass}>City</Label>
            <div className="relative">
              <MapPin className="pointer-events-none absolute left-4 top-1/2 z-10 h-[17px] w-[17px] -translate-y-1/2 text-white/60" />
              <GooglePlacesAutocomplete
                value={searchCity}
                onChange={setSearchCity}
                onPlaceSelect={handleCitySelect}
                placeholder="Search for your city"
                searchType="cities"
                className={`${mobileFieldClass} pl-11 pr-10`}
              />
              <ChevronRight className="pointer-events-none absolute right-4 top-1/2 h-4 w-4 -translate-y-1/2 text-white/35" />
            </div>
          </section>

          <section className="space-y-2">
            <Label className={mobileLabelClass}>Gender</Label>
            <div className="grid h-12 grid-cols-3 gap-1 rounded-2xl border border-white/[0.07] bg-white/[0.08] p-1">
              {(["male", "female", "other"] as const).map((option) => (
                <button
                  type="button"
                  key={option}
                  onClick={() => setGender(option)}
                  className={`rounded-[13px] text-[15px] capitalize text-white/70 transition-colors ${gender === option ? "bg-white/20 font-semibold text-white" : "font-medium"}`}
                >
                  {option}
                </button>
              ))}
            </div>
          </section>

          <section className="space-y-2">
            <Label htmlFor="mobile-birthday" className={mobileLabelClass}>
              Birthday
            </Label>
            <p className="text-[11px] font-medium text-white/40">
              You must be at least 13 years old to use WIG.
            </p>
            <div className="relative">
              <CalendarDays className="pointer-events-none absolute left-4 top-1/2 z-10 h-[17px] w-[17px] -translate-y-1/2 text-white/60" />
              <Input
                id="mobile-birthday"
                type="date"
                min="1900-01-01"
                max={latestAllowedBirthday}
                value={dateOfBirthValue}
                onChange={(event) => {
                  const [year, month, day] = event.target.value.split("-");
                  setDobYear(year || "");
                  setDobMonth(month || "");
                  setDobDay(day || "");
                }}
                className={`${mobileFieldClass} pl-11 [color-scheme:dark]`}
              />
            </div>
          </section>

          <section className="space-y-1 pt-3">
            <h2 className={mobileLabelClass}>Delete Account</h2>
            <p className="text-[11px] font-medium leading-relaxed text-white/35">
              Permanently removes your account and all associated data. This
              action cannot be reversed.
            </p>
            <button
              type="button"
              onClick={() => void handleDeleteAccount()}
              disabled={isDeletingAccount}
              className="h-[34px] text-[13px] font-semibold text-red-500/75 disabled:opacity-40"
            >
              {isDeletingAccount ? "Deleting Account…" : "Delete Account"}
            </button>
          </section>
        </div>
      </main>

      <PageContainer className="hidden max-w-2xl pt-0 md:block">
        {/*<div className="flex items-center justify-between">*/}
        {/*  <h1 className="text-3xl font-bold">Profile</h1>*/}
        {/*  /!*<UserButton afterSignOutUrl="/sign-in" />*!/*/}
        {/*</div>*/}

        <StickySectionHeader className="-mx-4">
          <h2 className="tracking-tight">Profile Settings</h2>
        </StickySectionHeader>
        <Card>
          <CardContent className="space-y-6 pt-4">
            {/* Profile Image */}
            <div className="flex items-center gap-6">
              <UserAvatar
                src={avatarImageUrl || user.avatarImageUrl}
                name={firstName || user.firstName}
                identityKey={user.id}
                className="h-24 w-24"
              />
              <div className="space-y-2">
                <S3Uploader
                  folder={`users/${user.id}/avatars`}
                  fileName="avatar-image.jpg"
                  onUploadComplete={handleImageUpload}
                  variant="button"
                  buttonText="Upload Profile Image"
                  maxSizeMB={4}
                />
                <p className="text-xs text-muted-foreground">Max 4MB.</p>
              </div>
            </div>

            <Separator />

            {/* Form Fields */}
            <div className="space-y-4">
              <div className={"flex flex-col gap-2 md:flex-row"}>
                <div className="w-full space-y-2">
                  <Label htmlFor="firstName">First Name</Label>
                  <Input
                    id="firstName"
                    value={firstName}
                    onChange={(e) => setFirstName(e.target.value)}
                    // disabled={!isEditing}
                    placeholder="Enter your first name"
                  />
                </div>

                <div className="w-full space-y-2">
                  <Label htmlFor="lastName">Last Name</Label>
                  <Input
                    id="lastName"
                    value={lastName}
                    onChange={(e) => setLastName(e.target.value)}
                    // disabled={!isEditing}
                    placeholder="Enter your last name"
                  />
                </div>
              </div>

              <div className="space-y-2">
                <Label htmlFor="city">City</Label>
                <GooglePlacesAutocomplete
                  value={searchCity}
                  onChange={setSearchCity}
                  onPlaceSelect={handleCitySelect}
                  placeholder="Search for your city..."
                  searchType="cities"
                />
                {city && state && (
                  <p className="text-xs text-muted-foreground">
                    Selected: {city}, {state}
                  </p>
                )}
              </div>

              <div className="space-y-2">
                <Label htmlFor="email">Email</Label>
                {emailStep === "idle" && !newEmail && (
                  <>
                    <div className="flex items-center gap-2">
                      <Input
                        id="email"
                        value={user.email}
                        disabled
                        className="bg-muted"
                      />
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        className="shrink-0"
                        onClick={() => setNewEmail(user.email)}
                      >
                        Change
                      </Button>
                    </div>
                  </>
                )}
                {emailStep === "idle" && newEmail && (
                  <div className="space-y-3 rounded-lg border p-4">
                    <div className="space-y-2">
                      <Label
                        htmlFor="new-email"
                        className="text-sm text-muted-foreground"
                      >
                        New email address
                      </Label>
                      <Input
                        id="new-email"
                        type="email"
                        value={newEmail}
                        onChange={(e) => setNewEmail(e.target.value)}
                        placeholder="you@example.com"
                      />
                    </div>
                    <div className="flex gap-2">
                      <Button
                        type="button"
                        size="sm"
                        onClick={handleStartEmailUpdate}
                        disabled={
                          isEmailLoading || !newEmail || newEmail === user.email
                        }
                      >
                        {isEmailLoading && (
                          <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                        )}
                        Send Verification Code
                      </Button>
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        onClick={() => setNewEmail("")}
                      >
                        Cancel
                      </Button>
                    </div>
                  </div>
                )}
                {emailStep === "code" && (
                  <div className="space-y-3 rounded-lg border p-4">
                    <p className="text-sm text-muted-foreground">
                      A verification code was sent to{" "}
                      <span className="font-medium text-foreground">
                        {newEmail}
                      </span>
                    </p>
                    <div className="space-y-2">
                      <Label
                        htmlFor="email-code"
                        className="text-sm text-muted-foreground"
                      >
                        Verification code
                      </Label>
                      <Input
                        id="email-code"
                        value={emailCode}
                        onChange={(e) => setEmailCode(e.target.value)}
                        placeholder="Enter code"
                      />
                    </div>
                    <div className="flex gap-2">
                      <Button
                        type="button"
                        size="sm"
                        onClick={handleVerifyEmail}
                        disabled={isEmailLoading || !emailCode}
                      >
                        {isEmailLoading && (
                          <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                        )}
                        Verify & Update
                      </Button>
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        onClick={() => {
                          setEmailStep("idle");
                          setEmailCode("");
                          setPendingEmail(null);
                          setNewEmail("");
                        }}
                      >
                        Cancel
                      </Button>
                    </div>
                  </div>
                )}
              </div>

              <div className="space-y-2">
                <Label htmlFor="username">Username</Label>
                <Input
                  id="username"
                  value={username}
                  onChange={(e) => setUsername(e.target.value.toLowerCase())}
                />
                <p className="text-xs text-muted-foreground">
                  3-20 characters, letters, numbers, and underscores only
                </p>
              </div>

              <DateOfBirthInput
                day={dobDay}
                month={dobMonth}
                year={dobYear}
                onDayChange={setDobDay}
                onMonthChange={setDobMonth}
                onYearChange={setDobYear}
                disabled
              />
            </div>

            <Separator />

            {/* Action Buttons */}
            <div className="flex w-full justify-between gap-2">
              {/*{!isEditing ? (*/}
              {/*  <Button onClick={() => setIsEditing(true)}>Edit Profile</Button>*/}
              {/*) : (*/}
              <>
                <Button
                  variant="outline"
                  onClick={handleCancel}
                  disabled={updateProfileMutation.isPending}
                >
                  Cancel
                </Button>
                <Button
                  onClick={handleSave}
                  disabled={
                    updateProfileMutation.isPending ||
                    (username === (user.username || "") &&
                      firstName === (user.firstName || "") &&
                      lastName === (user.lastName || "") &&
                      city === (user.city || "") &&
                      state === (user.state || "") &&
                      (dobDay && dobMonth && dobYear
                        ? `${dobYear.padStart(4, "0")}-${dobMonth.padStart(2, "0")}-${dobDay.padStart(2, "0")}`
                        : "") === initialDob)
                  }
                >
                  {updateProfileMutation.isPending && (
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  )}
                  Save Changes
                </Button>
              </>
              {/*)}*/}
            </div>
          </CardContent>
        </Card>

        <StickySectionHeader className="-mx-4 pt-6">
          <h2 className="tracking-tight">My Partner</h2>
        </StickySectionHeader>
        <Card>
          <CardContent className="space-y-4 pt-4">
            {acceptedRelationship ? (
              <>
                <div className="flex items-center gap-3 rounded-lg border p-3">
                  <UserAvatar
                    src={acceptedRelationship.partner.avatarImageUrl}
                    name={acceptedRelationship.partner.firstName}
                    identityKey={acceptedRelationship.partner.id}
                    className="h-12 w-12"
                  />
                  <div>
                    <p className="font-medium">
                      {acceptedRelationship.partner.firstName}{" "}
                      {acceptedRelationship.partner.lastName}
                    </p>
                    <p className="text-sm text-muted-foreground">
                      @{acceptedRelationship.partner.username}
                    </p>
                  </div>
                </div>
                <Button
                  variant="outline"
                  onClick={() => {
                    if (
                      !window.confirm(
                        `Remove ${acceptedRelationship.partner.firstName} as your partner?`
                      )
                    ) {
                      return;
                    }
                    removePartnerMutation.mutate();
                  }}
                  disabled={partnerMutationsBusy}
                >
                  {removePartnerMutation.isPending && (
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  )}
                  Remove Partner
                </Button>
              </>
            ) : pendingSentRelationship ? (
              <>
                <p className="text-sm text-muted-foreground">
                  Partner request pending, waiting for{" "}
                  <span className="font-medium text-foreground">
                    {pendingSentRelationship.partner.firstName}
                  </span>{" "}
                  to accept.
                </p>
                <Button
                  variant="outline"
                  onClick={() =>
                    declinePartnerRequestMutation.mutate({
                      partnerId: pendingSentRelationship.id,
                    })
                  }
                  disabled={partnerMutationsBusy}
                >
                  {declinePartnerRequestMutation.isPending && (
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  )}
                  Cancel Request
                </Button>
              </>
            ) : pendingReceivedRelationship ? (
              <>
                <p className="text-sm text-muted-foreground">
                  <span className="font-medium text-foreground">
                    {pendingReceivedRelationship.partner.firstName}
                  </span>{" "}
                  sent you a partner request.
                </p>
                <div className="flex gap-2">
                  <Button
                    onClick={() =>
                      acceptPartnerRequestMutation.mutate({
                        partnerId: pendingReceivedRelationship.id,
                      })
                    }
                    disabled={partnerMutationsBusy}
                  >
                    {acceptPartnerRequestMutation.isPending && (
                      <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                    )}
                    Accept
                  </Button>
                  <Button
                    variant="outline"
                    onClick={() =>
                      declinePartnerRequestMutation.mutate({
                        partnerId: pendingReceivedRelationship.id,
                      })
                    }
                    disabled={partnerMutationsBusy}
                  >
                    {declinePartnerRequestMutation.isPending && (
                      <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                    )}
                    Decline
                  </Button>
                </div>
              </>
            ) : (
              <>
                <div className="space-y-2">
                  <Label htmlFor="partner-search">
                    Choose from your friends
                  </Label>
                  <Input
                    id="partner-search"
                    value={partnerSearch}
                    onChange={(event) => setPartnerSearch(event.target.value)}
                    placeholder="Search accepted friends..."
                  />
                </div>
                {acceptedFriendCandidates.length === 0 ? (
                  <p className="text-sm text-muted-foreground">
                    You need an accepted friend before you can choose a partner.
                  </p>
                ) : filteredPartnerCandidates.length === 0 ? (
                  <p className="text-sm text-muted-foreground">
                    No friends found.
                  </p>
                ) : (
                  <div className="space-y-2">
                    {filteredPartnerCandidates.slice(0, 6).map((friend) => (
                      <div
                        key={friend.id}
                        className="flex items-center justify-between rounded-lg border p-3"
                      >
                        <div className="flex items-center gap-3">
                          <UserAvatar
                            src={friend.avatarImageUrl}
                            name={friend.firstName}
                            identityKey={friend.id}
                            className="h-10 w-10"
                          />
                          <div>
                            <p className="font-medium">
                              {friend.firstName} {friend.lastName}
                            </p>
                            <p className="text-sm text-muted-foreground">
                              @{friend.username}
                            </p>
                          </div>
                        </div>
                        <Button
                          size="sm"
                          onClick={() =>
                            sendPartnerRequestMutation.mutate({
                              recipientId: friend.id,
                            })
                          }
                          disabled={partnerMutationsBusy}
                        >
                          {sendPartnerRequestMutation.isPending && (
                            <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                          )}
                          Send Request
                        </Button>
                      </div>
                    ))}
                  </div>
                )}
              </>
            )}
          </CardContent>
        </Card>

        {/* Account Settings Card */}
        {/*<Card>*/}
        {/*  <CardHeader>*/}
        {/*    <CardTitle>Account Settings</CardTitle>*/}
        {/*  </CardHeader>*/}
        {/*  <CardContent>*/}
        {/*    <p className="text-sm text-muted-foreground mb-4">*/}
        {/*      Manage your account security, email preferences, and authentication settings.*/}
        {/*    </p>*/}
        {/*    <div className="flex items-center gap-2">*/}
        {/*      <UserButton afterSignOutUrl="/sign-in" appearance={{*/}
        {/*        elements: {*/}
        {/*          rootBox: "inline-flex",*/}
        {/*          userButtonAvatarBox: "w-10 h-10"*/}
        {/*        }*/}
        {/*      }} />*/}
        {/*      <div className="text-sm">*/}
        {/*        <p className="font-medium">Account Management</p>*/}
        {/*        <p className="text-muted-foreground">Click to manage your account settings</p>*/}
        {/*      </div>*/}
        {/*    </div>*/}
        {/*  </CardContent>*/}
        {/*</Card>*/}
      </PageContainer>
    </>
  );
}
