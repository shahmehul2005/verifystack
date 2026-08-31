export default function AuthLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex min-h-screen items-center justify-center bg-stone-100 px-4">
      <div className="w-full max-w-md border border-stone-300 bg-white p-8">{children}</div>
    </div>
  );
}
