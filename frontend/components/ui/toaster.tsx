"use client";

import { Toaster } from "sonner";

export function AppToaster() {
  return (
    <Toaster
      theme="light"
      position="bottom-right"
      toastOptions={{
        className: "font-sans text-sm",
      }}
    />
  );
}
