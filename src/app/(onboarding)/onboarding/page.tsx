"use client";

import { useState, useCallback, useEffect } from "react";
import { useRouter } from "next/navigation";
import { useUser } from "@clerk/nextjs";
import { trpc } from "@/lib/trpc";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  CardDescription,
} from "@/components/ui/card";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Loader2 } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { GooglePlacesAutocomplete } from "@/components/google-places-autocomplete";
import { S3Uploader } from "@/components/ui/s3-uploader";
import { UserAvatar } from "@/components/ui/user-avatar";
import { DateOfBirthInput } from "@/components/ui/date-of-birth-input";

const RESERVED_USERNAMES = new Set(["luke"]);

export default function OnboardingPage() {
  const router = useRouter();
  const { user: clerkUser, isLoaded } = useUser();
  const { toast } = useToast();
  const [formData, setFormData] = useState({
    username: "",
    city: "",
    state: "",
    gender: "" as "male" | "female" | "other" | "",
    dobDay: "",
    dobMonth: "",
    dobYear: "",
    avatarImageUrl: "",
  });
  const [searchCity, setSearchCity] = useState("");
  const [isRedirecting, setIsRedirecting] = useState(false);

  // Check if user has already completed onboarding
  const { data: user } = trpc.user.getCurrentUser.useQuery(undefined, {
    enabled: isLoaded && !!clerkUser,
    retry: false,
    refetchOnWindowFocus: false,
  });

  // Redirect to home if user has already completed onboarding
  useEffect(() => {
    if (user && !user.isOnboarding && !isRedirecting) {
      setIsRedirecting(true);
      router.push("/home");
    }
  }, [user, router, isRedirecting]);

  const updateUserMutation = trpc.user.updateUsername.useMutation({
    onSuccess: async () => {
      setIsRedirecting(true);
      // Redirect with a param to bypass middleware onboarding check
      // (session claims don't update immediately after metadata change)
      window.location.href = "/home?from=onboarding";
    },
    onError: (error) => {
      toast({
        title: "Error",
        description: error.message,
        variant: "destructive",
      });
    },
  });

  // Check if form is valid for enabling submit button
  const isValidUsername = /^[a-zA-Z0-9_]{3,20}$/.test(formData.username);
  const normalizedUsername = formData.username.trim().toLowerCase();
  const isReservedUsername = RESERVED_USERNAMES.has(normalizedUsername);
  const isValidDateOfBirth = () => {
    const day = Number.parseInt(formData.dobDay, 10);
    const month = Number.parseInt(formData.dobMonth, 10);
    const year = Number.parseInt(formData.dobYear, 10);

    if (!day || !month || !year) return false;
    if (year < 1900 || year > new Date().getFullYear()) return false;
    if (month < 1 || month > 12) return false;
    if (day < 1 || day > 31) return false;

    const candidate = new Date(Date.UTC(year, month - 1, day));
    return (
      candidate.getUTCFullYear() === year &&
      candidate.getUTCMonth() === month - 1 &&
      candidate.getUTCDate() === day
    );
  };
  const isDobValid = isValidDateOfBirth();
  const isFormValid =
    isValidUsername &&
    !isReservedUsername &&
    formData.city &&
    formData.state &&
    formData.gender &&
    isDobValid;

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();

    // Validate username
    if (!formData.username) {
      toast({
        title: "Validation Error",
        description: "Please enter a username",
        variant: "destructive",
      });
      return;
    }

    // Validate username format
    if (!/^[a-zA-Z0-9_]{3,20}$/.test(formData.username)) {
      toast({
        title: "Invalid Username",
        description:
          "Username must be 3-20 characters and contain only letters, numbers, and underscores",
        variant: "destructive",
      });
      return;
    }

    if (isReservedUsername) {
      toast({
        title: "Username Taken",
        description: "Username is already taken",
        variant: "destructive",
      });
      return;
    }

    // Validate city
    if (!formData.city || !formData.state) {
      toast({
        title: "Validation Error",
        description: "Please select your city",
        variant: "destructive",
      });
      return;
    }

    // Validate gender
    if (!formData.gender) {
      toast({
        title: "Validation Error",
        description: "Please select your gender",
        variant: "destructive",
      });
      return;
    }

    // Validate date of birth
    if (!isDobValid) {
      toast({
        title: "Validation Error",
        description: "Please enter a valid date of birth",
        variant: "destructive",
      });
      return;
    }

    const dateOfBirth = `${formData.dobYear.padStart(4, "0")}-${formData.dobMonth.padStart(2, "0")}-${formData.dobDay.padStart(2, "0")}`;

    // Submit username and location
    updateUserMutation.mutate({
      username: formData.username,
      city: formData.city,
      state: formData.state,
      gender: formData.gender as "male" | "female" | "other",
      dateOfBirth,
      avatarImageUrl: formData.avatarImageUrl || undefined,
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
      setFormData((prev) => ({
        ...prev,
        city: place.city,
        state: place.state,
      }));
      setSearchCity(`${place.city}, ${place.state}`);
    },
    []
  );

  // Wait only for Clerk to hydrate the auth state.
  if (!isLoaded) {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
      </div>
    );
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-background p-4">
      <Card className="w-full max-w-md">
        <CardHeader className="text-center">
          {/*<div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-full bg-primary/10">*/}
          {/*  <UserCircle className="h-6 w-6 text-primary" />*/}
          {/*</div>*/}
          <CardTitle className="text-2xl">Complete Your Profile</CardTitle>
          <CardDescription>Set up your profile to get started</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="mb-6 flex flex-col items-center">
            <div className="relative mb-4 h-24 w-24">
              <UserAvatar
                src={formData.avatarImageUrl}
                name={clerkUser?.firstName || formData.username}
                className="h-24 w-24 border-2 border-primary/10"
              />
            </div>
            <S3Uploader
              variant="button"
              buttonText={
                formData.avatarImageUrl ? "Change Picture" : "Upload Picture"
              }
              onUploadComplete={(url) =>
                setFormData({ ...formData, avatarImageUrl: url })
              }
              onRemoveImage={() =>
                setFormData({ ...formData, avatarImageUrl: "" })
              }
              folder={`users/${clerkUser?.id ?? user?.id ?? "pending-user"}`}
              fileName="avatar-image.png"
              className="w-full max-w-[200px]"
            />
            {!formData.avatarImageUrl && (
              <p className="mt-2 text-xs text-muted-foreground">
                You can add a profile picture later in settings
              </p>
            )}
          </div>
          <form onSubmit={handleSubmit} className="space-y-6">
            {/* Username */}
            <div className="space-y-2">
              <Label htmlFor="username">
                Username <span className="text-destructive">*</span>
              </Label>
              <Input
                id="username"
                value={formData.username}
                onChange={(e) =>
                  setFormData({
                    ...formData,
                    username: e.target.value.toLowerCase(),
                  })
                }
                placeholder="johndoe"
                autoComplete="off"
                maxLength={20}
              />
              <p
                className={`text-xs ${
                  isReservedUsername
                    ? "text-destructive"
                    : "text-muted-foreground"
                }`}
              >
                {isReservedUsername
                  ? "This username has already been taken"
                  : "3-20 characters, letters/numbers/underscores only"}
              </p>
            </div>

            {/* City */}
            <div className="space-y-2">
              <Label htmlFor="city">
                City <span className="text-destructive">*</span>
              </Label>
              <GooglePlacesAutocomplete
                value={searchCity}
                onChange={setSearchCity}
                onPlaceSelect={handleCitySelect}
                placeholder="Search for your city..."
                searchType="cities"
              />
            </div>

            {/* Gender */}
            <div className="space-y-2">
              <Label htmlFor="gender">
                Gender <span className="text-destructive">*</span>
              </Label>
              <Select
                value={formData.gender}
                onValueChange={(value: "male" | "female" | "other") =>
                  setFormData({ ...formData, gender: value })
                }
              >
                <SelectTrigger id="gender">
                  <SelectValue placeholder="Select gender" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="male">Male</SelectItem>
                  <SelectItem value="female">Female</SelectItem>
                  <SelectItem value="other">Other</SelectItem>
                </SelectContent>
              </Select>
            </div>

            {/* Date of Birth */}
            <DateOfBirthInput
              required
              day={formData.dobDay}
              month={formData.dobMonth}
              year={formData.dobYear}
              onDayChange={(value) =>
                setFormData({ ...formData, dobDay: value })
              }
              onMonthChange={(value) =>
                setFormData({ ...formData, dobMonth: value })
              }
              onYearChange={(value) =>
                setFormData({ ...formData, dobYear: value })
              }
            />

            <Button
              type="submit"
              disabled={!isFormValid || updateUserMutation.isPending}
              className="w-full"
            >
              {updateUserMutation.isPending && (
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              )}
              Complete Setup
            </Button>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}
