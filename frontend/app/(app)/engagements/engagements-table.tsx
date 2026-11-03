"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { Search } from "lucide-react";
import { Badge, type BadgeTone } from "@/components/ui/badge";
import { Input, Select } from "@/components/ui/input";
import { Table, Td, Th } from "@/components/ui/table";

export interface EngagementRow {
  id: string;
  clientName: string;
  plantName: string | null;
  scheme: string;
  sector: string;
  year: string;
  packId: string;
  status: string;
  statusLabel: string;
  opened: string;
}

export function statusTone(status: string): BadgeTone {
  if (status === "submitted") return "ok";
  if (status === "setup") return "neutral";
  if (status === "signoff") return "draft";
  return "ink";
}

export function EngagementsTable({
  rows,
  statuses,
}: {
  rows: EngagementRow[];
  statuses: { id: string; label: string }[];
}) {
  const router = useRouter();
  const [query, setQuery] = useState("");
  const [scheme, setScheme] = useState("all");
  const [status, setStatus] = useState("all");
  const schemes = useMemo(() => [...new Set(rows.map((r) => r.scheme))].sort(), [rows]);

  const visible = useMemo(() => {
    const q = query.trim().toLowerCase();
    return rows.filter((r) => {
      if (scheme !== "all" && r.scheme !== scheme) return false;
      if (status !== "all" && r.status !== status) return false;
      if (!q) return true;
      return [r.clientName, r.plantName ?? "", r.sector, r.packId, r.year]
        .join(" ")
        .toLowerCase()
        .includes(q);
    });
  }, [rows, query, scheme, status]);

  return (
    <div>
      <div className="mb-4 flex flex-wrap items-center gap-2">
        <div className="relative min-w-60 flex-1 sm:max-w-sm">
          <Search
            aria-hidden
            className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-mist-400"
          />
          <Input
            type="search"
            aria-label="Search engagements"
            placeholder="Search client, plant or sector"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            className="pl-9"
          />
        </div>
        <Select
          aria-label="Scheme"
          value={scheme}
          onChange={(e) => setScheme(e.target.value)}
          className="w-auto"
        >
          <option value="all">All schemes</option>
          {schemes.map((s) => (
            <option key={s} value={s}>
              {s}
            </option>
          ))}
        </Select>
        <Select
          aria-label="Status"
          value={status}
          onChange={(e) => setStatus(e.target.value)}
          className="w-auto"
        >
          <option value="all">All statuses</option>
          {statuses.map((s) => (
            <option key={s.id} value={s.id}>
              {s.label}
            </option>
          ))}
        </Select>
        <p className="ml-auto text-xs text-mist-500 tabular">
          {visible.length} of {rows.length}
        </p>
      </div>
      <Table>
        <thead>
          <tr>
            <Th>Client and plant</Th>
            <Th>Scheme</Th>
            <Th>Year</Th>
            <Th>Status</Th>
            <Th className="text-right">Opened</Th>
          </tr>
        </thead>
        <tbody>
          {visible.length === 0 ? (
            <tr>
              <Td colSpan={5} className="py-10 text-center text-mist-500">
                No engagements match these filters.
              </Td>
            </tr>
          ) : (
            visible.map((e) => (
              <tr
                key={e.id}
                className="cursor-pointer"
                onClick={(ev) => {
                  if ((ev.target as HTMLElement).closest("a")) return;
                  router.push(`/engagements/${e.id}`);
                }}
              >
                <Td>
                  <Link
                    href={`/engagements/${e.id}`}
                    className="font-medium text-mist-950 hover:text-teal-800"
                  >
                    {e.clientName}
                  </Link>
                  {e.plantName ? <div className="mt-0.5 text-xs text-mist-500">{e.plantName}</div> : null}
                </Td>
                <Td>
                  <span className="text-mist-900">{e.scheme}</span>
                  <div className="mt-0.5 text-xs text-mist-500">{e.sector}</div>
                </Td>
                <Td className="tabular">{e.year}</Td>
                <Td>
                  <Badge tone={statusTone(e.status)} dot>
                    {e.statusLabel}
                  </Badge>
                </Td>
                <Td className="whitespace-nowrap text-right text-xs text-mist-500">{e.opened}</Td>
              </tr>
            ))
          )}
        </tbody>
      </Table>
    </div>
  );
}
