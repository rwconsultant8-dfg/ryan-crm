import {z} from "zod";
import {isDate} from "./weeks";
export const meetingSchema=z.object({
  occurred:z.boolean(),summary:z.string().max(1500),response:z.string().max(1000),blocker:z.string().max(1000),needs_help:z.boolean(),next_step:z.string().max(1000),next_day:z.string().refine(v=>!v||isDate(v)),
});
export type MeetingSummary=z.infer<typeof meetingSchema>;
export const meetingJsonSchema={type:"object",additionalProperties:false,required:["occurred","summary","response","blocker","needs_help","next_step","next_day"],properties:{occurred:{type:"boolean"},summary:{type:"string"},response:{type:"string"},blocker:{type:"string"},needs_help:{type:"boolean"},next_step:{type:"string"},next_day:{type:"string"}}} as const;
