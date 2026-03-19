"use client";

type ActivityIconProps = {
  className?: string;
};

export function GoingActivityIcon({ className }: ActivityIconProps) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      aria-hidden="true"
      className={className}
    >
      <path
        d="M5 12.5l4.2 4.2L19 7"
        stroke="currentColor"
        strokeWidth="3"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

export function InterestedActivityIcon({ className }: ActivityIconProps) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="currentColor"
      aria-hidden="true"
      className={className}
    >
      <path d="M12 2.75l2.75 5.57 6.15.89-4.45 4.33 1.05 6.12L12 16.77 6.5 19.66l1.05-6.12L3.1 9.21l6.15-.89L12 2.75z" />
    </svg>
  );
}

export function NotGoingActivityIcon({ className }: ActivityIconProps) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      aria-hidden="true"
      className={className}
    >
      <path
        d="M7 7l10 10M17 7L7 17"
        stroke="currentColor"
        strokeWidth="2.75"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}
