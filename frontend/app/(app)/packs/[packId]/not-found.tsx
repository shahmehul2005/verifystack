import { FileSearch } from "lucide-react";
import { EmptyState } from "@/components/states";

export default function NotFound() {
  return (
    <EmptyState
      icon={FileSearch}
      title="Methodology pack not found"
      body="No pack with this name is available. Check the link, or pick one from the pack library."
      action={{ href: "/packs", label: "Back to packs" }}
    />
  );
}
