type SafeParseSuccess<T> = {
  success: true;
  data: T;
};

type SafeParseFailure = {
  success: false;
  error: {
    issues: Array<{ message: string }>;
  };
};

type SafeParseResult<T> = SafeParseSuccess<T> | SafeParseFailure;

export type OnboardingProfileInput = {
  username: string;
  city: string;
  state: string;
  gender?: "male" | "female" | "other";
  dateOfBirth?: string;
  avatarImageUrl?: string;
};

export const onboardingProfileSchema = {
  safeParse(input: OnboardingProfileInput): SafeParseResult<OnboardingProfileInput> {
    if (!/^[a-zA-Z0-9_]{3,20}$/.test(input.username)) {
      return {
        success: false,
        error: {
          issues: [
            {
              message:
                "Username must be 3-20 characters and contain only letters, numbers, and underscores",
            },
          ],
        },
      };
    }

    if (!input.city.trim()) {
      return {
        success: false,
        error: {
          issues: [{ message: "City is required" }],
        },
      };
    }

    if (!/^[A-Z]{2}$/.test(input.state)) {
      return {
        success: false,
        error: {
          issues: [{ message: "State must be a 2-letter code" }],
        },
      };
    }

    return {
      success: true,
      data: input,
    };
  },
};
