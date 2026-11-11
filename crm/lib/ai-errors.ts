export const AI_VERIFICATION_URL = "https://vercel.com/mowlhouseware-6546s-projects/~/ai-gateway";

/** Return service codes only: never expose request text, credentials or raw SDK errors. */
export function aiFailureInfo(error: unknown) {
  const value=error as {status?:unknown;type?:unknown;error?:{type?:unknown;error?:{type?:unknown}}}|null;
  const candidate=value?.error?.error?.type || value?.error?.type || value?.type;
  const type=typeof candidate==="string" && /^[A-Za-z0-9_-]{1,80}$/.test(candidate)?candidate:"unknown";
  const status=typeof value?.status==="number"?value.status:undefined;
  return {type,status,verificationRequired:type==="customer_verification_required"};
}
