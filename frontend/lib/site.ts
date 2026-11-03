/**
 * Facts about the public site that more than one page needs.
 *
 * `contactEmail` is read from NEXT_PUBLIC_CONTACT_EMAIL so a real address is
 * configured per deployment rather than invented here. When it is unset the
 * footer and legal pages point to the demo form instead of showing an address.
 */
export const SITE = {
  name: "VerifyStack",
  tagline: "Verification workbench for CCTS and ADEETIE",
  contactEmail: process.env.NEXT_PUBLIC_CONTACT_EMAIL?.trim() || null,
  /** Last review date shown on the legal pages. Change it when the text changes. */
  legalUpdated: "10 October 2026",
} as const;

export const FOOTER_NAV = [
  {
    title: "Product",
    links: [
      { label: "How it works", href: "/#how-it-works" },
      { label: "Capabilities", href: "/#capabilities" },
      { label: "Schemes", href: "/#schemes" },
      { label: "Trust and security", href: "/#trust" },
      { label: "FAQ", href: "/#faq" },
    ],
  },
  {
    title: "Schemes",
    links: [
      { label: "CCTS", href: "/#schemes" },
      { label: "ADEETIE", href: "/#schemes" },
      { label: "CBAM (in design)", href: "/#schemes" },
      { label: "Green hydrogen (in design)", href: "/#schemes" },
    ],
  },
  {
    title: "Get started",
    links: [
      { label: "Request a demo", href: "/#demo" },
      { label: "Create an account", href: "/signup" },
      { label: "Sign in", href: "/login" },
    ],
  },
  {
    title: "Legal",
    links: [
      { label: "Privacy notice", href: "/privacy" },
      { label: "Terms of use", href: "/terms" },
      { label: "Security", href: "/security" },
      { label: "Licences and notices", href: "/licenses" },
    ],
  },
] as const;
