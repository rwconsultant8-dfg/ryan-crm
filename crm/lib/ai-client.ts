import "server-only";
import Anthropic from "@anthropic-ai/sdk";
import { headers } from "next/headers";
import { AsyncLocalStorage } from "node:async_hooks";

const identity=new AsyncLocalStorage<string>();
export const withAIIdentity = <T>(token:string|null, task:()=>Promise<T>) => identity.run(token || "",task);
async function gatewayToken(){
  const configured=process.env.AI_GATEWAY_API_KEY || process.env.VERCEL_OIDC_TOKEN || identity.getStore();
  if(configured)return configured;
  try{return(await headers()).get("x-vercel-oidc-token") || undefined;}catch{return undefined;}
}
export const hasAIAuth = () => Boolean(process.env.ANTHROPIC_API_KEY || process.env.AI_GATEWAY_API_KEY || process.env.VERCEL_OIDC_TOKEN || process.env.VERCEL === "1");
export const hasAIRequestAuth = async () => Boolean(process.env.ANTHROPIC_API_KEY || await gatewayToken());
export const usesGateway = () => !process.env.ANTHROPIC_API_KEY;
export async function aiClient() {
  if (!usesGateway()) return new Anthropic();
  const token=await gatewayToken();
  if (!token) throw new Error("AI 連線未設定");
  return new Anthropic({baseURL:"https://ai-gateway.vercel.sh",apiKey:null,authToken:token});
}
export const aiModel = () => usesGateway() ? process.env.AI_GATEWAY_MODEL || "anthropic/claude-opus-5.5" : process.env.AI_MODEL || "claude-opus-5-5";
