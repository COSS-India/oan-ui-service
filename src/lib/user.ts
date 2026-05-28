const toText = (value: unknown) => (typeof value === "string" ? value.trim() : "");

export const resolveUserDisplayName = (user: Record<string, unknown>): string => {
  const firstName = toText(user.given_name) || toText(user.first_name);
  const lastName = toText(user.family_name) || toText(user.last_name);
  const fullName = [firstName, lastName].filter(Boolean).join(" ");

  if (fullName) {
    return fullName;
  }

  const fallbackName = toText(user.name) || toText(user.preferred_username) || toText(user.username);
  const compactName = fallbackName.replace(/[\s()+-]/g, "");

  if (fallbackName && !(compactName.length >= 8 && /^\d+$/.test(compactName))) {
    return fallbackName;
  }

  return "Anonymous User";
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
