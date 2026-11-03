export function AuthHeading({
  title,
  description,
}: {
  title: string;
  description?: React.ReactNode;
}) {
  return (
    <div>
      <h1 className="text-2xl font-semibold tracking-tight text-mist-950">{title}</h1>
      {description ? (
        <p className="mt-2 text-sm leading-relaxed text-mist-600">{description}</p>
      ) : null}
    </div>
  );
}

export function AuthFooter({ children }: { children: React.ReactNode }) {
  return <p className="mt-8 text-center text-[13px] text-mist-500">{children}</p>;
}

export const authLinkClass = "font-medium text-teal-700 hover:text-teal-900 hover:underline";
