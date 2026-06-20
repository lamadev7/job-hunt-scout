import { z } from "zod";

export const roleSchema = z.object({
  title: z.string().default(""),
  company: z.string().default(""),
  years: z.number().min(0).max(60).default(0),
  startDate: z.string().default("").optional(),
  endDate: z.string().default("").optional(),
  description: z.string().default("").optional(),
});

export const educationSchema = z.object({
  degree: z.string().default(""),
  field: z.string().default(""),
  institution: z.string().default(""),
  year: z.string().default("").optional(),
});

/** Strict shape the LLM must return. Validated before we trust any of it. */
export const extractedProfileSchema = z.object({
  fullName: z.string().default(""),
  title: z.string().default(""),
  email: z.string().default(""),
  phone: z.string().default(""),
  summary: z.string().default(""),
  yearsExperience: z.number().min(0).max(60).default(0),
  skills: z.array(z.string()).default([]),
  tools: z.array(z.string()).default([]),
  domains: z.array(z.string()).default([]),
  roles: z.array(roleSchema).default([]),
  education: z.array(educationSchema).default([]),
  certifications: z.array(z.string()).default([]),
});

export type ExtractedProfile = z.infer<typeof extractedProfileSchema>;
