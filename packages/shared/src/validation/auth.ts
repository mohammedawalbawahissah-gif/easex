import { z } from "zod";

export const registerSchema = z.object({
  username: z.string().min(3).max(30),
  email: z.string().email(),
  phone_number: z.string().regex(/^\+?[0-9]{9,15}$/, "Enter a valid phone number"),
  // Mirrors Django's MinimumLengthValidator (min_length=10 in settings.py)
  password: z.string().min(10, "Password must be at least 10 characters"),
});

export const loginSchema = z.object({
  username: z.string().min(1, "Username is required"),
  password: z.string().min(1, "Password is required"),
});

export type RegisterFormValues = z.infer<typeof registerSchema>;
export type LoginFormValues = z.infer<typeof loginSchema>;

export const changePasswordSchema = z.object({
  old_password: z.string().min(1, "Current password is required"),
  new_password: z.string().min(10, "Password must be at least 10 characters"),
});

export const passwordResetRequestSchema = z.object({
  email: z.string().email(),
});

export const passwordResetConfirmSchema = z.object({
  new_password: z.string().min(10, "Password must be at least 10 characters"),
});

export type ChangePasswordFormValues = z.infer<typeof changePasswordSchema>;
export type PasswordResetRequestFormValues = z.infer<typeof passwordResetRequestSchema>;
export type PasswordResetConfirmFormValues = z.infer<typeof passwordResetConfirmSchema>;
