"use server";

import { redirect } from "next/navigation";
import { login } from "@/lib/api-client";

export interface LoginState {
  message: string | null;
}

export async function signIn(_previous: LoginState, formData: FormData): Promise<LoginState> {
  const email = String(formData.get("email") ?? "");
  const password = String(formData.get("password") ?? "");

  if (!email || !password) {
    return { message: "Enter your email and password" };
  }

  const result = await login(email, password);
  if (!result.ok) return { message: result.message };

  redirect("/");
}
