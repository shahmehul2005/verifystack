"use client";

import Link from "next/link";
import { useState } from "react";
import { toast } from "sonner";
import { Download, FileSpreadsheet, Upload } from "lucide-react";
import { Alert } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button, buttonVariants } from "@/components/ui/button";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { Table, Td, Th } from "@/components/ui/table";

interface PreviewRow {
  row: number;
  ok: boolean;
  clientName: string | null;
  plantName: string | null;
  packId: string | null;
  complianceYear: string | null;
  errors: string[];
  warnings: string[];
}

interface Preview {
  headerProblems: string[];
  unmappedHeaders: string[];
  validCount: number;
  invalidCount: number;
  rows: PreviewRow[];
}

interface Committed {
  created: Array<{ row: number; id: string; clientName: string }>;
  failed: Array<{ row: number; error: string }>;
}

export function ImportClient() {
  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState<Preview | null>(null);
  const [done, setDone] = useState<Committed | null>(null);
  const [busy, setBusy] = useState(false);

  async function post(commit: boolean) {
    if (!file || busy) return;
    setBusy(true);
    try {
      const data = new FormData();
      data.set("file", file);
      data.set("commit", String(commit));
      data.set("skipInvalid", "true");
      const res = await fetch("/api/engagements/import", { method: "POST", body: data });
      const json = (await res.json().catch(() => null)) as
        | ({ ok: boolean; error?: string; preview?: Preview } & Partial<Committed>)
        | null;
      if (!res.ok || !json?.ok) {
        if (json?.preview) setPreview(json.preview);
        toast.error(json?.error ?? "Import failed");
        return;
      }
      if (commit) {
        setDone({ created: json.created ?? [], failed: json.failed ?? [] });
        toast.success(`${json.created?.length ?? 0} engagements created`);
      } else if (json.preview) {
        setPreview(json.preview);
        setDone(null);
      }
    } finally {
      setBusy(false);
    }
  }

  if (done) {
    return (
      <div className="space-y-4">
        <Alert tone={done.failed.length ? "warn" : "ok"} title={`${done.created.length} engagements created`}>
          {done.failed.length > 0 ? `${done.failed.length} could not be created and are listed below.` : "All rows were imported."}
        </Alert>
        {done.created.length > 0 && (
          <Card>
            <CardBody>
              <ul className="divide-y divide-mist-100 text-sm">
                {done.created.map((c) => (
                  <li key={c.id} className="flex items-center justify-between py-2">
                    <span>
                      <span className="mr-2 text-xs text-mist-500">Row {c.row}</span>
                      {c.clientName}
                    </span>
                    <Link href={`/engagements/${c.id}`} className="text-[13px] font-medium text-teal-700 hover:underline">
                      Open
                    </Link>
                  </li>
                ))}
              </ul>
            </CardBody>
          </Card>
        )}
        {done.failed.map((f) => (
          <Alert key={f.row} tone="error" title={`Row ${f.row}`}>
            {f.error}
          </Alert>
        ))}
        <Link href="/engagements" className={buttonVariants({ variant: "secondary" })}>
          Back to engagements
        </Link>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader
          title="1. Choose a file"
          description="A CSV or XLSX with one engagement per row. Required columns: packId, clientName, complianceYear."
          actions={
            // A file download from a route handler, not a page to navigate to.
            <a href="/api/engagements/import" download className={buttonVariants({ variant: "secondary", size: "sm" })}>
              <Download />
              Template
            </a>
          }
        />
        <CardBody className="flex flex-wrap items-center gap-3">
          <label className="inline-flex cursor-pointer items-center gap-2 rounded-md border border-dashed border-mist-300 bg-mist-50/60 px-3 py-2 text-sm text-mist-700 hover:border-teal-500">
            <FileSpreadsheet className="size-4 text-mist-500" aria-hidden />
            {file ? file.name : "Choose a file"}
            <input
              type="file"
              accept=".csv,.xlsx,text/csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
              className="sr-only"
              onChange={(e) => {
                setFile(e.target.files?.[0] ?? null);
                setPreview(null);
              }}
            />
          </label>
          <Button disabled={!file || busy} onClick={() => void post(false)}>
            <Upload />
            {busy && !preview ? "Checking…" : "Check the file"}
          </Button>
        </CardBody>
      </Card>

      {preview ? (
        <Card>
          <CardHeader
            title="2. Review"
            description="Rows with problems are skipped, never fixed for you."
            actions={
              <>
                <Badge tone="ok" dot>
                  {preview.validCount} valid
                </Badge>
                {preview.invalidCount > 0 ? (
                  <Badge tone="block" dot>
                    {preview.invalidCount} with problems
                  </Badge>
                ) : null}
              </>
            }
          />
          <CardBody className="space-y-4">
            {preview.headerProblems.map((p) => (
              <Alert key={p} tone="error">
                {p}
              </Alert>
            ))}
            {preview.unmappedHeaders.length > 0 ? (
              <Alert tone="info" title="Columns that were not used">
                {preview.unmappedHeaders.join(", ")}
              </Alert>
            ) : null}
            {preview.rows.length > 0 ? (
              <Table>
                <thead>
                  <tr>
                    <Th>Row</Th>
                    <Th>Client</Th>
                    <Th>Pack</Th>
                    <Th>Year</Th>
                    <Th>Result</Th>
                  </tr>
                </thead>
                <tbody>
                  {preview.rows.map((r) => (
                    <tr key={r.row}>
                      <Td className="tabular">{r.row}</Td>
                      <Td>
                        {r.clientName ?? "—"}
                        {r.plantName ? <span className="text-mist-500"> · {r.plantName}</span> : null}
                      </Td>
                      <Td className="font-mono text-xs">{r.packId ?? "—"}</Td>
                      <Td>{r.complianceYear ?? "—"}</Td>
                      <Td>
                        {r.ok ? (
                          <Badge tone="ok">Ready</Badge>
                        ) : (
                          <ul className="space-y-0.5 text-xs text-red-800">
                            {r.errors.map((e) => (
                              <li key={e}>{e}</li>
                            ))}
                          </ul>
                        )}
                        {r.warnings.map((w) => (
                          <p key={w} className="mt-0.5 text-xs text-amber-800">
                            {w}
                          </p>
                        ))}
                      </Td>
                    </tr>
                  ))}
                </tbody>
              </Table>
            ) : null}
            <div>
              <Button disabled={busy || preview.validCount === 0} onClick={() => void post(true)}>
                {busy ? "Creating…" : `Create ${preview.validCount} ${preview.validCount === 1 ? "engagement" : "engagements"}`}
              </Button>
            </div>
          </CardBody>
        </Card>
      ) : null}
    </div>
  );
}
