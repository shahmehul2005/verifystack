import { Suspense } from "react";
import { SignupForm } from "./signup-form";
import { LoadingState } from "@/components/states";

export const metadata = { title: "Create account" };

export default function SignupPage() {
  return (
    <Suspense fallback={<LoadingState label="Loading create account…" />}>
      <SignupForm />
    </Suspense>
  );
}
