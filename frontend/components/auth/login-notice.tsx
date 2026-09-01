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
      <p className="mt-4 border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-900">{error}</p>
    );
  }
  if (checkEmail) {
    return (
      <p className="mt-4 border border-stone-200 bg-stone-50 px-3 py-2 text-sm text-stone-700">
        If this email is new, check your inbox to confirm the account. Otherwise sign in or reset
        your password.
      </p>
    );
  }
  if (passwordUpdated) {
    return (
      <p className="mt-4 border border-stone-200 bg-stone-50 px-3 py-2 text-sm text-stone-700">
        Password updated. Sign in with your new password.
      </p>
    );
  }
  if (signedOut) {
    return (
      <p className="mt-4 border border-stone-200 bg-stone-50 px-3 py-2 text-sm text-stone-700">
        You have been signed out.
      </p>
    );
  }
  return null;
}
