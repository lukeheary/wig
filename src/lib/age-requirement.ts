export const MINIMUM_USER_AGE = 13;

const ISO_DATE_PATTERN = /^(\d{4})-(\d{2})-(\d{2})$/;

export function isValidIsoDate(value: string): boolean {
  const match = ISO_DATE_PATTERN.exec(value);
  if (!match) return false;

  const year = Number.parseInt(match[1], 10);
  const month = Number.parseInt(match[2], 10);
  const day = Number.parseInt(match[3], 10);
  const candidate = new Date(Date.UTC(year, month - 1, day));

  return (
    year >= 1900 &&
    candidate.getUTCFullYear() === year &&
    candidate.getUTCMonth() === month - 1 &&
    candidate.getUTCDate() === day
  );
}

export function isAtLeastMinimumAge(
  dateOfBirth: string,
  today: Date = new Date()
): boolean {
  if (!isValidIsoDate(dateOfBirth)) return false;

  const [year, month, day] = dateOfBirth.split("-").map(Number);
  const cutoffYear = today.getUTCFullYear() - MINIMUM_USER_AGE;
  const cutoffMonth = today.getUTCMonth() + 1;
  const cutoffDay = today.getUTCDate();

  return (
    year < cutoffYear ||
    (year === cutoffYear &&
      (month < cutoffMonth || (month === cutoffMonth && day <= cutoffDay)))
  );
}
