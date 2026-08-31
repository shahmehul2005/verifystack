"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { createBrowserSupabase } from "@verifystack/backend/lib/supabase/client";
import { Button } from "@/components/ui/button";
import { Input, Label } from "@/components/ui/input";
import { ConfigureSupabase, ErrorState } from "@/components/states";

export default function InvitePage() {
  const router = useRouter();
  const supabase = createBrowserSupabase();
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  if (!supabase) return <ConfigureSupabase />;

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setPending(true);
    const { error: err } = await supabase!.auth.updateUser({ password });
    setPending(false);
    if (err) setError(err.message);
    else {
      router.push("/engagements");
      router.refresh();
    }
  }

  return (
    <div>
      <p className="text-[11px] uppercase tracking-[0.2em] text-stone-500">Invite</p>
      <h1 className="mt-1 text-lg font-semibold">Set your password</h1>
      <p className="mt-1 text-sm text-stone-600">
        Open this page from the invite email so the recovery session is present.
      </p>
      {error ? (
        <div className="mt-4">
          <ErrorState body={error} />
        </div>
      ) : null}
      <form onSubmit={onSubmit} className="mt-6 space-y-3">
        <div>
          <Label htmlFor="password">New password</Label>
          <Input
            id="password"
            type="password"
            minLength={10}
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            required
          />
        </div>
        <Button type="submit" className="w-full" disabled={pending}>
          Accept invite
        </Button>
      </form>
      <p className="mt-6 text-center text-[12px] text-stone-500">
        <Link href="/login" className="underline">
          Back to sign in
        </Link>
      </p>
    </div>
  );
}
