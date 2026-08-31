import { serve } from "inngest/next";
import { inngest } from "@verifystack/backend/inngest/client";
import { intakeDocument } from "@verifystack/backend/inngest/functions/intake";
import { extractDocument } from "@verifystack/backend/inngest/functions/extract";

export const { GET, POST, PUT } = serve({
  client: inngest,
  functions: [intakeDocument, extractDocument],
});
