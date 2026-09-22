import { z } from "zod";

// Amounts travel as strings (never floats). GHS allows 2 decimal places,
// crypto 8 — the server enforces the exact rule per currency; these give
// instant feedback before a request is made.
const amount = z
  .string()
  .refine((v) => /^\d+(\.\d{1,8})?$/.test(v.trim()) && Number(v) > 0, "Enter an amount greater than 0");

const password = z.string().min(1, "Enter your password to confirm");
export const PIN_LENGTH = 6;
const pin = z.string().regex(/^\d{6}$/, "Enter your 6-digit PIN");

export const loadWalletSchema = z.object({
  amount: amount.refine((v) => /^\d+(\.\d{1,2})?$/.test(v.trim()), "Use at most 2 decimal places"),
  network: z.string().min(1, "Choose a network"),
  phone_number: z.string().regex(/^(\+?233|0)[235]\d{8}$/, "Enter a valid Ghana mobile money number"),
});

export const transferSchema = z.object({
  recipient: z.string().min(2, "Enter a username or phone number").max(150),
  amount,
  note: z.string().max(140).optional(),
  pin,
});

export const scheduleTransferSchema = transferSchema.extend({
  run_date: z.string().min(1, "Choose a date"),
  run_time: z.string().min(1, "Choose a time"),
});

export const cryptoWithdrawSchema = z.object({
  amount,
  network: z.string().min(1, "Choose a network"),
  address: z.string().min(10, "Enter the destination address").max(200),
  memo: z.string().regex(/^\d*$/, "The tag must be a number").optional(),
  pin,
});

export const ghsWithdrawSchema = z.object({
  amount: amount.refine((v) => /^\d+(\.\d{1,2})?$/.test(v.trim()), "Use at most 2 decimal places"),
  destination_id: z.string().min(1, "Choose where to send your money"),
  pin,
});

export const payoutDestinationSchema = z.object({
  network: z.string().min(1, "Choose a network"),
  account_number: z.string().regex(/^(\+?233|0)[235]\d{8}$/, "Enter a valid Ghana mobile money number"),
  account_name: z.string().min(2, "Enter the name on the account").max(100),
  password,
});

export type LoadWalletFormValues = z.infer<typeof loadWalletSchema>;
export type TransferFormValues = z.infer<typeof transferSchema>;
export type ScheduleTransferFormValues = z.infer<typeof scheduleTransferSchema>;
export type CryptoWithdrawFormValues = z.infer<typeof cryptoWithdrawSchema>;
export type GhsWithdrawFormValues = z.infer<typeof ghsWithdrawSchema>;
export type PayoutDestinationFormValues = z.infer<typeof payoutDestinationSchema>;

export const setPinSchema = z
  .object({
    password,
    pin,
    confirm_pin: z.string(),
  })
  .refine((v) => v.pin === v.confirm_pin, { path: ["confirm_pin"], message: "The PINs don't match" });

export type SetPinFormValues = z.infer<typeof setPinSchema>;
