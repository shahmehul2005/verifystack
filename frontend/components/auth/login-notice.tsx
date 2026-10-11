import { Alert } from "@/components/ui/alert";

export function LoginNotice({
  error,
  checkEmail,
  passwordUpdated,
  signedOut,
}: {
  error: string | null;
  checkEmail: boolean;
  passwordUpdated: boolean;
  signedOut: boolean;
}) {
  if (error) {
    return (
      <Alert tone="error" className="mt-5">
        {error}
      </Alert>
    );
  }
  if (checkEmail) {
    return (
      <Alert tone="info" className="mt-5">
        If this email is new, check your inbox to confirm the account. Otherwise sign in or reset
        your password.
      </Alert>
    );
  }
  if (passwordUpdated) {
    return (
      <Alert tone="ok" className="mt-5">
        Password updated. Sign in with your new password.
      </Alert>
    );
  }
  if (signedOut) {
    return (
      <Alert tone="info" className="mt-5">
        You have been signed out.
      </Alert>
    );
  }
  return null;
}
