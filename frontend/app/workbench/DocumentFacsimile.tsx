import type { DemoFact } from "@verifystack/backend/demo/types";

export function Highlight({
  bbox,
}: {
  bbox: { x: number; y: number; width: number; height: number };
}) {
  return (
    <div
      className="pointer-events-none absolute z-10 rounded-sm border-2 border-amber-500 bg-amber-400/20"
      style={{
        left: `${bbox.x * 100}%`,
        top: `${bbox.y * 100}%`,
        width: `${bbox.width * 100}%`,
        height: `${bbox.height * 100}%`,
      }}
    />
  );
}

function Sheet({
  children,
  highlight,
}: {
  children: React.ReactNode;
  highlight?: DemoFact | null;
}) {
  return (
    <div className="relative mx-auto aspect-[210/297] w-full max-w-[520px] overflow-hidden border border-stone-300 bg-[#fbfaf6] text-stone-900 shadow-sm">
      {highlight ? <Highlight bbox={highlight.bbox} /> : null}
      {children}
    </div>
  );
}

export function DocumentFacsimile({
  documentId,
  highlight,
}: {
  documentId: string;
  highlight: DemoFact | null;
}) {
  const h = highlight?.documentId === documentId ? highlight : null;

  if (documentId === "doc-coal-inv") {
    return (
      <Sheet highlight={h}>
        <div className="h-full p-6 text-[11px] leading-snug">
          <p className="text-center text-[10px] tracking-widest text-stone-500">
            THE SINGARENI COLLIERIES COMPANY LIMITED
          </p>
          <h2 className="mt-1 text-center text-sm font-semibold">TAX INVOICE</h2>
          <p className="mt-3">Invoice No. <strong>SCCL/2025/1182</strong></p>
          <p>Date: 12-10-2025 &nbsp; Consignee: Aravalli Cement Works Ltd., Beawar</p>
          <p>Grade: G-10 &nbsp; (Indian sub-bituminous)</p>
          <div className="mt-8 grid grid-cols-2 gap-2 border-t border-stone-300 pt-4">
            <span>Quantity dispatched</span>
            <span className="text-right font-mono">18,247 MT</span>
            <span>Gross calorific value (as billed)</span>
            <span className="text-right font-mono">GCV 4,200 kcal/kg</span>
            <span>Rate</span>
            <span className="text-right font-mono">₹ 4,180 / MT</span>
          </div>
          <p className="absolute bottom-6 left-6 right-6 text-[9px] text-stone-500">
            Synthetic facsimile for VerifyStack demo. Not a real SCCL document.
          </p>
        </div>
      </Sheet>
    );
  }

  if (documentId === "doc-lab") {
    return (
      <Sheet highlight={h}>
        <div className="h-full p-6 text-[11px] leading-snug">
          <p className="text-center font-semibold">Desert Analytics Pvt Ltd</p>
          <p className="text-center text-[10px]">NABL TC-8891 valid until 31-05-2025</p>
          <h2 className="mt-3 text-center text-sm font-semibold">TEST CERTIFICATE NABL-CEM-441</h2>
          <p className="mt-6">Sample: kiln coal, Beawar Line 2</p>
          <p>Date of test: 15-08-2025</p>
          <div className="mt-8 border-t border-stone-300 pt-4">
            <p>Proximate analysis (as received)</p>
            <p className="mt-3 font-mono">NCV 17.58 MJ/kg</p>
            <p className="font-mono">Moisture 8.2% · Ash 32.1%</p>
          </div>
          <p className="absolute bottom-6 left-6 right-6 text-[9px] text-stone-500">
            Synthetic facsimile. Accreditation dates planted to demonstrate LB001.
          </p>
        </div>
      </Sheet>
    );
  }

  if (documentId === "doc-elec") {
    return (
      <Sheet highlight={h}>
        <div className="h-full p-6 text-[11px] leading-snug">
          <p className="font-semibold">State DISCOM — HT Industrial</p>
          <p>Consumer: 22-HT-BEAWAR-8821</p>
          <p>Billing period: 01-10-2025 to 31-10-2025</p>
          <div className="mt-10 border border-stone-400 p-3">
            <p>Active energy</p>
            <p className="mt-2 text-right font-mono text-sm">22,166,640 Units</p>
            <p className="text-right text-[10px] text-stone-500">(= 22,166.64 MWh)</p>
          </div>
          <p className="mt-4">Maximum demand: 42,850 kVA</p>
          <p className="absolute bottom-6 left-6 right-6 text-[9px] text-stone-500">
            Synthetic facsimile for Scope 2 extraction demo.
          </p>
        </div>
      </Sheet>
    );
  }

  return (
    <Sheet highlight={h}>
      <div className="h-full p-6 text-[11px] leading-snug">
        <p className="font-semibold">Equivalent product statement</p>
        <p>FY 2025-26 · Cement (CCTS gate-to-gate)</p>
        <p className="mt-10 font-mono text-sm">Equivalent product 1,850,000 t</p>
        <p className="mt-2 text-stone-600">Denominator for GEI. Multi-product allocation not modelled in this prototype.</p>
        <p className="absolute bottom-6 left-6 right-6 text-[9px] text-stone-500">
          Synthetic production log.
        </p>
      </div>
    </Sheet>
  );
}
