import { z } from "zod";

export const submitGiftCardSchema = z.object({
  // The subcategory the seller picked from the dropdown (brand, currency and rate follow from it).
  subcategory: z.string().min(1, "Choose the card type"),
  card_code: z.string().min(4, "Card code looks too short").max(50),
  // Sent as strings to match backend decimal handling, but validated as
  // numeric strings here so both frontends reject garbage before it
  // ever reaches the API.
  face_value: z
    .string()
    .refine((v) => !isNaN(Number(v)) && Number(v) > 0, "Enter a valid amount"),
});

export type SubmitGiftCardFormValues = z.infer<typeof submitGiftCardSchema>;
