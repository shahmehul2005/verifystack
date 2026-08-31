import { Suspense } from "react";
import { LoginForm } from "./login-form";
import { LoadingState } from "@/components/states";

export default function LoginPage() {
  return (
    <Suspense fallback={<LoadingState label="Loading sign-in…" />}>
      <LoginForm />
    </Suspense>
  );
}
