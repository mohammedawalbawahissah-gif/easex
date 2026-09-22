import { z } from "zod";

export const kycIdTypeSchema = z.enum(["national_id", "passport", "voters_id", "drivers_license"]);

export const submitKYCSchema = z.object({
  full_name: z.string().min(2, "Enter your full legal name").max(150),
  date_of_birth: z
    .string()
    .refine((v) => !isNaN(Date.parse(v)), "Enter a valid date")
    .refine((v) => {
      const age = (Date.now() - new Date(v).getTime()) / (1000 * 60 * 60 * 24 * 365.25);
      return age >= 18;
    }, "You must be at least 18 years old"),
  id_type: kycIdTypeSchema,
  id_number: z.string().min(3, "Enter your ID number").max(64),
});

export type SubmitKYCFormValues = z.infer<typeof submitKYCSchema>;
