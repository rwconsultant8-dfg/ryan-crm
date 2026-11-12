import "server-only";
import { createHash } from "node:crypto";

export function isMomoAvatarAccount(email?: string | null): boolean {
  const configuredEmail = process.env.ZEST_MOMO_AVATAR_EMAIL?.trim().toLowerCase();
  return Boolean(configuredEmail && email?.trim().toLowerCase() === configuredEmail);
}

/** The existing Ryan briefing binding pins the verified manager's account, independent of display names. */
export function canViewTeamCalendar(profile: { role: string; active: boolean; email: string }): boolean {
  const accountHash = process.env.ZEST_RYAN_CALENDAR_EMAIL_HASH || process.env.ZEST_BRIEF_RECIPIENT?.split(":")[1];
  if (!profile.active || profile.role !== "admin" || !accountHash) return false;
  return createHash("sha256").update(profile.email.trim().toLowerCase()).digest("hex") === accountHash;
}
