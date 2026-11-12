import {describe,it,expect} from "vitest";
import {aiFailureInfo} from "@/lib/ai-errors";
describe("AI service error classification",()=>{
 it("recognizes the actual gateway verification rejection and common SDK envelopes",()=>{
  for(const value of [{status:403,type:"customer_verification_required"},{status:403,error:{type:"customer_verification_required"}},{status:403,error:{error:{type:"customer_verification_required"}}}])expect(aiFailureInfo(value)).toEqual({status:403,type:"customer_verification_required",verificationRequired:true});
 });
 it("does not mistake generic authorization or capacity errors for payment verification",()=>{for(const value of [null,new Error("other"),{status:401,type:"authentication_error"},{status:429,error:{type:"rate_limit_error"}}])expect(aiFailureInfo(value).verificationRequired).toBe(false);});
 it("returns safe codes without raw messages, tokens or customer content",()=>{const info=aiFailureInfo({status:403,error:{error:{type:"customer_verification_required",message:"private customer text",token:"private token"}}});expect(JSON.stringify(info)).not.toContain("private");});
});
