"use client";

import { useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

export function DeclaredForm({
  engagementId,
  paths,
}: {
  engagementId: string;
  paths: { path: string; label: string }[];
}) {
  const [fieldPath, setFieldPath] = useState("");
  const [value, setValue] = useState("");
  const [unit, setUnit] = useState("");
  const [pending, setPending] = useState(false);

  async function submit() {
    setPending(true);
    const trimmed = value.trim();
    const asNumber = trimmed !== "" && !Number.isNaN(Number(trimmed.replace(/,/g, "")));
    const res = await fetch("/api/declared", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        engagementId,
        fieldPath,
        value: asNumber ? Number(trimmed.replace(/,/g, "")) : trimmed,
        unit: unit || undefined,
      }),
    });
    const json = (await res.json().catch(() => ({}))) as { ok?: boolean; error?: string };
    setPending(false);
    if (!res.ok || !json.ok) {
      toast.error(json.error ?? "Could not record the declared value");
      return;
    }
    toast.success("Declared value recorded");
    window.location.reload();
  }

  return (
    <form
      className="mt-3 grid gap-2 sm:grid-cols-[1.5fr_1fr_6rem_auto]"
      onSubmit={(e) => {
        e.preventDefault();
        void submit();
      }}
    >
      <datalist id="declared-paths">
        {paths.map((p) => (
          <option key={p.path} value={p.path}>
            {p.label}
          </option>
        ))}
      </datalist>
      <Input
        aria-label="Field path"
        list="declared-paths"
        placeholder="coal.quantity"
        value={fieldPath}
        onChange={(e) => setFieldPath(e.target.value)}
      />
      <Input aria-label="Declared value" placeholder="Declared value" value={value} onChange={(e) => setValue(e.target.value)} />
      <Input aria-label="Unit" placeholder="unit" value={unit} onChange={(e) => setUnit(e.target.value)} />
      <Button type="submit" variant="secondary" size="sm" disabled={pending || !fieldPath || !value}>
        Record declared value
      </Button>
    </form>
  );
}
