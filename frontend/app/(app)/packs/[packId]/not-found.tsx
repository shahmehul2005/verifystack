import { EmptyState } from "@/components/states";

export default function NotFound() {
  return (
    <EmptyState
      title="Unknown methodology pack"
      body="No pack with this id is in the registry. Packs are code records, not database rows, so a missing pack is a registration gap rather than a permission problem."
      action={{ href: "/packs", label: "Back to packs" }}
    />
  );
}
