"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Camera, MapPin, RefreshCw, Trash2, Wifi, WifiOff } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Alert } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Input, Label, Select, Textarea } from "@/components/ui/input";
import {
  OBSERVATION_KINDS,
  OBSERVATION_KIND_LABEL,
  ObservationInputSchema,
  type ObservationInput,
  type ObservationKind,
} from "@verifystack/backend/domain/fieldwork/observation";
import {
  applyOutcome,
  discardItem,
  dueItems,
  enqueue,
  parseQueue,
  queueSummary,
  reviseItem,
  type QueueItem,
  type SyncOutcome,
} from "@verifystack/backend/domain/fieldwork/queue";

export interface OpenVisit {
  id: string;
  label: string;
}
export interface PathOption {
  path: string;
  label: string;
  defaultUnit: string;
}

interface Place {
  lat: number;
  lng: number;
  accuracyM?: number;
}

const storageKey = (engagementId: string) => `verifystack:fieldwork-queue:${engagementId}`;

/**
 * Capture an observation, offline if need be. Everything is written to a local
 * queue first and synced when the device is online; the server treats the
 * observation id as an idempotency key, so a retried sync records it once.
 */
export function CaptureForm({
  engagementId,
  visits,
  targets,
}: {
  engagementId: string;
  visits: OpenVisit[];
  targets: PathOption[];
}) {
  const router = useRouter();
  const [queue, setQueue] = useState<QueueItem[]>([]);
  const [online, setOnline] = useState(true);
  const [syncing, setSyncing] = useState(false);
  const [ready, setReady] = useState(false);
  const queueRef = useRef<QueueItem[]>([]);

  const [kind, setKind] = useState<ObservationKind>("meter_reading");
  const [visitId, setVisitId] = useState(visits[0]?.id ?? "");
  const [fieldPath, setFieldPath] = useState("");
  const [value, setValue] = useState("");
  const [unit, setUnit] = useState("");
  const [note, setNote] = useState("");
  const [place, setPlace] = useState<Place | null>(null);
  const [locating, setLocating] = useState(false);
  const [photo, setPhoto] = useState<File | null>(null);
  const [editing, setEditing] = useState<string | null>(null);
  const [errors, setErrors] = useState<string[]>([]);

  const persist = useCallback(
    (next: QueueItem[]) => {
      queueRef.current = next;
      setQueue(next);
      try {
        window.localStorage.setItem(storageKey(engagementId), JSON.stringify(next));
      } catch {
        toast.error("This device could not store the offline queue. Sync before closing the page.");
      }
    },
    [engagementId]
  );

  useEffect(() => {
    const stored = parseQueue(window.localStorage.getItem(storageKey(engagementId)));
    queueRef.current = stored;
    // localStorage and navigator do not exist while rendering on the server, so
    // the queue can only be read after mount.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setQueue(stored);
    setOnline(navigator.onLine);
    setReady(true);
  }, [engagementId]);

  const sync = useCallback(async () => {
    if (syncing || !navigator.onLine) return;
    const due = dueItems(queueRef.current);
    if (due.length === 0) return;
    setSyncing(true);
    let saved = 0;
    for (const item of due) {
      let outcome: SyncOutcome;
      try {
        const res = await fetch("/api/fieldwork/observations", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ engagementId, observation: item.payload }),
        });
        const json = (await res.json().catch(() => ({}))) as { ok?: boolean; duplicate?: boolean; error?: string };
        if (res.ok && json.ok) {
          outcome = json.duplicate ? { kind: "duplicate" } : { kind: "saved" };
          if (!json.duplicate) saved += 1;
        } else if (res.status === 401 || res.status === 429 || res.status >= 500) {
          // Signed out, throttled or the server is struggling: keep it and try again.
          outcome = { kind: "retry", reason: json.error ?? `Server returned ${res.status}` };
        } else {
          outcome = { kind: "rejected", reason: json.error ?? `Rejected (${res.status})` };
        }
      } catch {
        outcome = { kind: "retry", reason: "No connection" };
      }
      persist(applyOutcome(queueRef.current, item.clientId, outcome));
      if (outcome.kind === "retry") break;
    }
    setSyncing(false);
    if (saved > 0) {
      toast.success(`${saved} observation(s) synced`);
      router.refresh();
    }
  }, [engagementId, persist, router, syncing]);

  useEffect(() => {
    const up = () => {
      setOnline(true);
      void sync();
    };
    const down = () => setOnline(false);
    window.addEventListener("online", up);
    window.addEventListener("offline", down);
    const timer = window.setInterval(() => void sync(), 30_000);
    return () => {
      window.removeEventListener("online", up);
      window.removeEventListener("offline", down);
      window.clearInterval(timer);
    };
  }, [sync]);

  function locate() {
    if (!("geolocation" in navigator)) {
      toast.error("This device cannot report a location.");
      return;
    }
    setLocating(true);
    navigator.geolocation.getCurrentPosition(
      (p) => {
        setPlace({ lat: p.coords.latitude, lng: p.coords.longitude, accuracyM: p.coords.accuracy });
        setLocating(false);
      },
      () => {
        setLocating(false);
        toast.error("Could not get a location. You can record without one.");
      },
      { enableHighAccuracy: true, timeout: 15_000, maximumAge: 30_000 }
    );
  }

  function pickTarget(path: string) {
    setFieldPath(path);
    const t = targets.find((x) => x.path === path);
    if (t && !unit) setUnit(t.defaultUnit);
  }

  function reset() {
    setFieldPath("");
    setValue("");
    setUnit("");
    setNote("");
    setPhoto(null);
    setEditing(null);
    setErrors([]);
  }

  async function submit() {
    setErrors([]);
    const evidenceFileIds: string[] = [];
    const existing = editing ? queue.find((q) => q.clientId === editing) : null;
    if (existing) evidenceFileIds.push(...existing.payload.evidenceFileIds);
    if (photo) {
      if (!navigator.onLine) {
        setErrors(["Photographs upload while online. Connect, or record without the photograph."]);
        return;
      }
      const res = await fetch("/api/fieldwork/photo", {
        method: "POST",
        headers: {
          "Content-Type": photo.type || "application/octet-stream",
          "x-engagement-id": engagementId,
          "x-filename": encodeURIComponent(photo.name),
        },
        body: await photo.arrayBuffer(),
      });
      const json = (await res.json().catch(() => ({}))) as { ok?: boolean; documentId?: string; error?: string };
      if (!res.ok || !json.ok || !json.documentId) {
        setErrors([json.error ?? "The photograph did not upload."]);
        return;
      }
      evidenceFileIds.push(json.documentId);
    }

    const trimmed = value.trim();
    const numeric = trimmed !== "" && !Number.isNaN(Number(trimmed.replace(/,/g, "")));
    const candidate = {
      clientId: editing ?? crypto.randomUUID(),
      kind,
      observedAt: existing ? existing.payload.observedAt : new Date().toISOString(),
      visitId: visitId || null,
      location: place,
      fieldPath: fieldPath.trim() || null,
      value: trimmed === "" ? null : numeric ? Number(trimmed.replace(/,/g, "")) : trimmed,
      unit: unit.trim() || null,
      note: note.trim() || null,
      evidenceFileIds,
    };
    const parsed = ObservationInputSchema.safeParse(candidate);
    if (!parsed.success) {
      setErrors(parsed.error.issues.map((i) => i.message));
      return;
    }
    const payload: ObservationInput = parsed.data;
    try {
      persist(editing ? reviseItem(queueRef.current, editing, payload) : enqueue(queueRef.current, payload));
    } catch (e) {
      setErrors([e instanceof Error ? e.message : "Could not queue the observation."]);
      return;
    }
    reset();
    toast.success(navigator.onLine ? "Saved. Syncing…" : "Saved on this device. It will sync when you are online.");
    void sync();
  }

  function fix(item: QueueItem) {
    const p = item.payload;
    setEditing(item.clientId);
    setKind(p.kind);
    setVisitId(p.visitId ?? "");
    setFieldPath(p.fieldPath ?? "");
    setValue(p.value === null || p.value === undefined ? "" : String(p.value));
    setUnit(p.unit ?? "");
    setNote(p.note ?? "");
    setPlace(p.location ?? null);
    setErrors([]);
  }

  const { pending, rejected } = queueSummary(queue);

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center gap-2 text-[13px]">
        <Badge tone={online ? "ok" : "draft"}>
          {online ? <Wifi className="size-3" /> : <WifiOff className="size-3" />}
          {online ? "Online" : "Offline"}
        </Badge>
        {ready && pending > 0 ? <Badge tone="draft">{pending} waiting to sync</Badge> : null}
        {rejected > 0 ? <Badge tone="block">{rejected} need fixing</Badge> : null}
        {pending > 0 ? (
          <Button size="sm" variant="secondary" disabled={!online || syncing} onClick={() => void sync()}>
            <RefreshCw className={syncing ? "animate-spin" : ""} />
            Sync now
          </Button>
        ) : null}
      </div>

      <form
        className="grid gap-4 rounded-lg border border-mist-200 bg-white p-4 shadow-xs sm:grid-cols-2"
        onSubmit={(e) => {
          e.preventDefault();
          void submit();
        }}
      >
        <div>
          <Label>What did you observe?</Label>
          <Select value={kind} onChange={(e) => setKind(e.target.value as ObservationKind)}>
            {OBSERVATION_KINDS.map((k) => (
              <option key={k} value={k}>
                {OBSERVATION_KIND_LABEL[k]}
              </option>
            ))}
          </Select>
        </div>
        <div>
          <Label>Site visit</Label>
          <Select value={visitId} onChange={(e) => setVisitId(e.target.value)}>
            <option value="">Not tied to a visit</option>
            {visits.map((v) => (
              <option key={v.id} value={v.id}>
                {v.label}
              </option>
            ))}
          </Select>
        </div>
        <datalist id="fieldwork-paths">
          {targets.map((t) => (
            <option key={t.path} value={t.path}>
              {t.label}
            </option>
          ))}
        </datalist>
        <div>
          <Label>Field this is for</Label>
          <Input
            list="fieldwork-paths"
            placeholder="electricity.activeEnergy"
            value={fieldPath}
            onChange={(e) => pickTarget(e.target.value)}
          />
        </div>
        <div className="grid grid-cols-[1fr_6rem] gap-2">
          <div>
            <Label>Value</Label>
            <Input inputMode="decimal" value={value} onChange={(e) => setValue(e.target.value)} />
          </div>
          <div>
            <Label>Unit</Label>
            <Input value={unit} onChange={(e) => setUnit(e.target.value)} />
          </div>
        </div>
        <div className="sm:col-span-2">
          <Label>Note</Label>
          <Textarea
            className="min-h-20"
            value={note}
            onChange={(e) => setNote(e.target.value)}
            placeholder="Meter ID, what the nameplate says, what you were told and by whom…"
          />
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Button type="button" variant="secondary" size="sm" onClick={locate} disabled={locating}>
            <MapPin />
            {place ? "Update location" : locating ? "Locating…" : "Add location"}
          </Button>
          {place ? (
            <span className="text-xs text-mist-600">
              {place.lat.toFixed(5)}, {place.lng.toFixed(5)}
              {place.accuracyM ? ` (±${Math.round(place.accuracyM)} m)` : ""}
            </span>
          ) : null}
        </div>
        <div className="flex items-center gap-2">
          <label className="inline-flex cursor-pointer items-center gap-2 text-[13px] text-mist-700">
            <Camera className="size-4" />
            <span>{photo ? photo.name : "Attach a photograph (online only)"}</span>
            <input
              type="file"
              accept="image/*"
              capture="environment"
              className="sr-only"
              onChange={(e) => setPhoto(e.target.files?.[0] ?? null)}
            />
          </label>
        </div>

        {errors.length > 0 ? (
          <div className="sm:col-span-2">
            <Alert tone="error" title="Check the observation">
              <ul className="list-disc pl-4">
                {errors.map((e) => (
                  <li key={e}>{e}</li>
                ))}
              </ul>
            </Alert>
          </div>
        ) : null}
        <div className="flex gap-2 sm:col-span-2">
          <Button type="submit">{editing ? "Save the fix" : "Record observation"}</Button>
          {editing ? (
            <Button type="button" variant="ghost" onClick={reset}>
              Cancel fix
            </Button>
          ) : null}
        </div>
      </form>

      {queue.length > 0 ? (
        <div>
          <p className="mb-2 text-[13px] font-medium text-mist-900">On this device</p>
          <ul className="divide-y divide-mist-100 rounded-lg border border-mist-200 bg-white text-[13px]">
            {queue.map((q) => (
              <li key={q.clientId} className="flex flex-wrap items-center gap-3 px-3 py-2">
                <span className="font-medium">{OBSERVATION_KIND_LABEL[q.payload.kind]}</span>
                <span className="text-mist-600">
                  {q.payload.fieldPath ? `${q.payload.fieldPath} ` : ""}
                  {q.payload.value ?? ""} {q.payload.unit ?? ""}
                </span>
                {q.rejected ? (
                  <Badge tone="block">Rejected: {q.rejected}</Badge>
                ) : q.lastError ? (
                  <Badge tone="draft">Retrying: {q.lastError}</Badge>
                ) : (
                  <Badge tone="neutral">Waiting</Badge>
                )}
                <span className="ml-auto flex gap-1">
                  {q.rejected ? (
                    <Button size="sm" variant="secondary" onClick={() => fix(q)}>
                      Fix
                    </Button>
                  ) : null}
                  <Button
                    size="sm"
                    variant="ghost"
                    aria-label="Discard"
                    onClick={() => {
                      if (window.confirm("Discard this observation? It has not reached the server.")) {
                        persist(discardItem(queueRef.current, q.clientId));
                      }
                    }}
                  >
                    <Trash2 />
                  </Button>
                </span>
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </div>
  );
}
