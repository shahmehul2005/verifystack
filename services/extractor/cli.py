"""
CLI Interface for VerifyStack Pydantic Extractor.
Allows command-line invocation and headless Next.js execution.
"""

from __future__ import annotations

import argparse
import json
import sys
from typing import Any

from .excel_processor import (
    auto_map_arbitrary_excel,
    generate_blank_template,
    parse_bee_pat2_proforma,
    parse_verifystack_template,
)
from .models import SourceType


def main():
    parser = argparse.ArgumentParser(description="VerifyStack Pydantic AI Extraction CLI")
    subparsers = parser.add_subparsers(dest="command", required=True)

    # Subcommand: parse-proforma
    p_prof = subparsers.add_parser("parse-proforma", help="Parse official BEE PAT-2 proforma (.xls)")
    p_prof.add_argument("file_path", help="Path to .xls proforma file")
    p_prof.add_argument("--year", default="2023-24", help="Compliance year e.g. 2023-24")

    # Subcommand: parse-template
    p_tmpl = subparsers.add_parser("parse-template", help="Parse standard VerifyStack 12-month template")
    p_tmpl.add_argument("file_path", help="Path to .xlsx or .csv template")
    p_tmpl.add_argument("--source", default="corroboration", choices=["sourcing", "corroboration", "proforma"])

    # Subcommand: auto-map
    p_map = subparsers.add_parser("auto-map", help="Auto-map arbitrary plant spreadsheet")
    p_map.add_argument("file_path", help="Path to arbitrary plant Excel file")
    p_map.add_argument("--year", default="2023-24")
    p_map.add_argument("--source", default="corroboration")

    # Subcommand: generate-template
    p_gen = subparsers.add_parser("generate-template", help="Generate blank 12-month Excel template")
    p_gen.add_argument("output_path", help="Output file path e.g. template.xlsx")
    p_gen.add_argument("--year", default="2023-24")

    args = parser.parse_args()

    if args.command == "parse-proforma":
        readings = parse_bee_pat2_proforma(args.file_path, compliance_year=args.year)
        out = [r.model_dump() for r in readings]
        print(json.dumps({"ok": True, "readings": out, "count": len(out)}, indent=2))

    elif args.command == "parse-template":
        st = SourceType.SOURCING if args.source == "sourcing" else SourceType.CORROBORATION
        readings = parse_verifystack_template(args.file_path, default_source_type=st)
        out = [r.model_dump() for r in readings]
        print(json.dumps({"ok": True, "readings": out, "count": len(out)}, indent=2))

    elif args.command == "auto-map":
        st = SourceType.SOURCING if args.source == "sourcing" else SourceType.CORROBORATION
        readings, mappings, unmapped = auto_map_arbitrary_excel(
            args.file_path, compliance_year=args.year, source_type=st
        )
        out = [r.model_dump() for r in readings]
        print(json.dumps({
            "ok": True,
            "readings": out,
            "mappings": mappings,
            "unmapped": unmapped,
            "count": len(out)
        }, indent=2))

    elif args.command == "generate-template":
        data = generate_blank_template(args.year)
        with open(args.output_path, "wb") as f:
            f.write(data)
        print(json.dumps({"ok": True, "output_path": args.output_path}))


if __name__ == "__main__":
    main()
