"use client";

import { Toaster } from "sonner";

export function AppToaster() {
  return (
    <Toaster
      theme="light"
      position="bottom-right"
      offset={{ bottom: 92, right: 20 }}
      mobileOffset={{ bottom: 92 }}
      toastOptions={{
        classNames: {
          toast:
            "font-sans text-sm rounded-lg border border-mist-200 bg-white text-mist-900 shadow-md",
          description: "text-mist-600",
          success: "[&_[data-icon]]:text-green-700",
          error: "[&_[data-icon]]:text-red-700",
        },
      }}
    />
  );
}
