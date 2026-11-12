import "server-only";

export function isMomoAvatarAccount(email?: string | null): boolean {
  const configuredEmail = process.env.ZEST_MOMO_AVATAR_EMAIL?.trim().toLowerCase();
  return Boolean(configuredEmail && email?.trim().toLowerCase() === configuredEmail);
}
