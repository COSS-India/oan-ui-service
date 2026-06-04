const toText = (value: unknown) => (typeof value === "string" ? value.trim() : "");
const toTelemetryText = (value: unknown) => {
  if (typeof value === "string") {
    return value.trim();
  }

  if (typeof value === "number" && Number.isFinite(value)) {
    return String(value);
  }

  return "";
};

export const DEFAULT_USER_DISPLAY_NAME = "Test User";

const isNumericName = (value: string) => {
  const compactName = value.replace(/[\s()+-]/g, "");
  return compactName.length > 0 && /^\d+$/.test(compactName);
};

export const resolveUserDisplayName = (user: Record<string, unknown>): string => {
  const firstName = toText(user.given_name) || toText(user.first_name);
  const lastName = toText(user.family_name) || toText(user.last_name);
  const fullName = [firstName, lastName].filter(Boolean).join(" ");

  if (fullName && !isNumericName(fullName)) {
    return fullName;
  }

  const fallbackName = toText(user.name) || toText(user.preferred_username) || toText(user.username);

  if (fallbackName && !isNumericName(fallbackName)) {
    return fallbackName;
  }

  return DEFAULT_USER_DISPLAY_NAME;
};

export const resolveTelemetryUsername = (user: Record<string, unknown>): string => {
  return toTelemetryText(user.name);
};

export const getUserInitials = (value?: string | null): string => {
  const parts = toText(value).split(/\s+/).filter(Boolean);

  if (parts.length >= 2) {
    return `${parts[0][0]}${parts[parts.length - 1][0]}`.toUpperCase();
  }

  if (parts.length === 1) {
    return parts[0][0].toUpperCase();
  }

  return "U";
};
