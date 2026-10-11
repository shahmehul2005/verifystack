import { ForbiddenState } from "@/components/states";

export const metadata = { title: "Not available" };

export default function ForbiddenPage() {
  return (
    <ForbiddenState body="This needs a different role: lead verifier, independent reviewer or firm admin. Ask your firm admin if you think you should have access." />
  );
}
