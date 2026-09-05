import { Suspense } from "react";
import { SignupForm } from "./signup-form";
import { LoadingState } from "@/components/states";

export default function SignupPage() {
  return (
    <Suspense fallback={<LoadingState label="Loading create account…" />}>
      <SignupForm />
    </Suspense>
  );
}
