import "server-only";
import { validTelegramId } from "./registry";
import { hasAIAuth } from "../ai-client";

export const coachToken = () => process.env.TELEGRAM_COACH_BOT_TOKEN || process.env.TELEGRAM_BOT_TOKEN;
export const coachUsername = () => (process.env.TELEGRAM_COACH_BOT_USERNAME || process.env.TELEGRAM_BOT_USERNAME || "").replace(/^@/, "");
export const coachSecret = () => process.env.TELEGRAM_COACH_WEBHOOK_SECRET || process.env.TELEGRAM_WEBHOOK_SECRET;
export const paToken = () => process.env.TELEGRAM_PA_BOT_TOKEN;
export const paSecret = () => process.env.TELEGRAM_PA_WEBHOOK_SECRET;
export const paUserId = () => process.env.TELEGRAM_PA_USER_ID || "";
export const paUsername = () => (process.env.TELEGRAM_PA_BOT_USERNAME || "").replace(/^@/, "");
export const paAllowed = (id: string) => validTelegramId(paUserId()) && id === paUserId();
export const separateBots = () => (!paToken() || !coachToken() || paToken() !== coachToken()) && (!paSecret() || !coachSecret() || paSecret() !== coachSecret());
export const coachReady = () => Boolean(coachToken() && coachSecret() && hasAIAuth() && separateBots());
export const paReady = () => Boolean(paToken() && paSecret() && validTelegramId(paUserId()) && hasAIAuth() && separateBots());
