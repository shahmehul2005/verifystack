import { FileSearch } from "lucide-react";
import { EmptyState } from "@/components/states";

export default function NotFound() {
  return (
    <EmptyState
      icon={FileSearch}
      title="Engagement not found"
      body="It may have been opened under another firm, or the link is incomplete."
      action={{ href: "/engagements", label: "Back to engagements" }}
    />
  );
}
