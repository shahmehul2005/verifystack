import { ForbiddenState } from "@/components/states";

export default function ForbiddenPage() {
  return (
    <ForbiddenState body="This action requires a different role (lead verifier, independent reviewer, or firm admin)." />
  );
}
