/**
 * P7 attestation.
 *
 * The DFD's P7 is "Review, Sign-off & Report Submission". Sign-off in this
 * codebase is a named attestation hashed to the latest run. That is not a
 * Digital Signature under the IT Act, 2000, and it is not a BEE/ICM filing.
 *
 * A legal e-sign provider (CCA-licensed Aadhaar eSign ASP, or Class 2/3 DSC)
 * swaps in behind `EsignProvider`. Do not rename named attestation as "DSC".
 */

export interface AttestationInput {
  engagementId: string;
  attestorName: string;
  attestorUserId: string;
  role: string;
  reportHash: string;
  statement: string;
}

export interface AttestationResult {
  provider: string;
  attestationId: string;
  reportHash: string;
  signedAt: string;
}

export interface EsignProvider {
  readonly name: string;
  attest(input: AttestationInput): Promise<AttestationResult>;
}

/** Internal workpaper attestation. Not a DSC. Not a filing. */
export class NamedAttestationProvider implements EsignProvider {
  readonly name = "named-attestation";

  async attest(input: AttestationInput): Promise<AttestationResult> {
    if (!input.attestorName.trim()) {
      throw new Error("Named attestation requires the attestor's name.");
    }
    if (!/^[a-f0-9]{64}$/i.test(input.reportHash)) {
      throw new Error("Report hash must be sha256 hex.");
    }
    return {
      provider: this.name,
      attestationId: `${input.engagementId}:${input.role}:${input.reportHash.slice(0, 12)}`,
      reportHash: input.reportHash,
      signedAt: new Date().toISOString(),
    };
  }
}

/**
 * Placeholder for a CCA-licensed eSign ASP (Aadhaar eSign) or DSC token signer.
 * Instantiating this without credentials must fail closed — never silently
 * fall back to a typed name.
 */
export class LegalEsignNotConfigured implements EsignProvider {
  readonly name = "legal-esign-unconfigured";

  async attest(_input: AttestationInput): Promise<AttestationResult> {
    throw new Error(
      "Legal e-sign is not connected. Named attestation is not a Digital Signature " +
        "under the IT Act. Contract a CCA-licensed eSign ASP (Aadhaar eSign) or a " +
        "Class 2/3 DSC signer, implement EsignProvider, and switch createEsignProvider()."
    );
  }
}

export function createEsignProvider(): EsignProvider {
  if (process.env.ESIGN_PROVIDER === "legal") {
    return new LegalEsignNotConfigured();
  }
  return new NamedAttestationProvider();
}
