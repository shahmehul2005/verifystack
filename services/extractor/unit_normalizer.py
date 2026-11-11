"""
Deterministic Unit Normalizer for BEE PAT-2 Indian Cement Operations.
Rule: "Code computes; models never do."
"""

from __future__ import annotations

import re
from typing import Tuple
from .models import BEEPATSectorStream


# Standard statutory target units per stream
TARGET_UNITS: dict[BEEPATSectorStream, str] = {
    BEEPATSectorStream.CLINKER_PRODUCTION: "t",
    BEEPATSectorStream.OPC_PRODUCTION: "t",
    BEEPATSectorStream.PPC_PRODUCTION: "t",
    BEEPATSectorStream.PSC_PRODUCTION: "t",
    BEEPATSectorStream.EQUIVALENT_PRODUCT: "t",

    BEEPATSectorStream.COAL_QUANTITY: "t",
    BEEPATSectorStream.COAL_GCV: "kcal/kg",
    BEEPATSectorStream.PETCOKE_QUANTITY: "t",
    BEEPATSectorStream.PETCOKE_GCV: "kcal/kg",
    BEEPATSectorStream.IMPORTED_COAL_QUANTITY: "t",
    BEEPATSectorStream.IMPORTED_COAL_GCV: "kcal/kg",
    BEEPATSectorStream.BIOMASS_AFR_QUANTITY: "t",
    BEEPATSectorStream.BIOMASS_AFR_GCV: "kcal/kg",

    BEEPATSectorStream.FO_QUANTITY: "kL",
    BEEPATSectorStream.FO_GCV: "kcal/kg",
    BEEPATSectorStream.HSD_QUANTITY: "kL",
    BEEPATSectorStream.HSD_GCV: "kcal/kg",

    BEEPATSectorStream.NATURAL_GAS_QUANTITY: "SCM",
    BEEPATSectorStream.NATURAL_GAS_GCV: "kcal/SCM",

    BEEPATSectorStream.GRID_ELECTRICITY: "kWh",
    BEEPATSectorStream.CPP_GENERATION: "kWh",
    BEEPATSectorStream.WHRS_GENERATION: "kWh",
    BEEPATSectorStream.POWER_EXPORT: "kWh",

    BEEPATSectorStream.CALCINATION_CO2: "tCO2e",
    BEEPATSectorStream.RAW_MEAL_CALCINATION: "tCO2e",
}


def clean_unit_string(unit: str) -> str:
    """Normalize unit string for matching."""
    if not unit:
        return ""
    u = unit.strip().lower()
    # Replace common variations
    u = re.sub(r"[\(\)\[\]]", "", u)
    u = re.sub(r"\s+", " ", u).strip()
    return u


def normalize_reading_value(
    stream: BEEPATSectorStream,
    raw_value: float,
    raw_unit: str
) -> Tuple[float, str]:
    """
    Normalizes a raw reading to the statutory target unit deterministically.
    Returns (normalized_value, target_unit).
    """
    target_unit = TARGET_UNITS.get(stream, "t")
    clean_u = clean_unit_string(raw_unit)

    # 1. Electricity Normalization (Target: kWh)
    if target_unit == "kWh":
        if "lakh" in clean_u and ("kwh" in clean_u or "unit" in clean_u):
            # 1 Lakh kWh = 100,000 kWh
            return round(raw_value * 100_000.0, 4), "kWh"
        if "mu" in clean_u or "million kwh" in clean_u or "million units" in clean_u or "mkwh" in clean_u:
            # 1 MU = 1,000,000 kWh
            return round(raw_value * 1_000_000.0, 4), "kWh"
        if "mwh" in clean_u:
            # 1 MWh = 1,000 kWh
            return round(raw_value * 1_000.0, 4), "kWh"
        if "gwh" in clean_u:
            return round(raw_value * 1_000_000.0, 4), "kWh"
        if clean_u in ("kwh", "units", "unit"):
            return raw_value, "kWh"

    # 2. Solid Mass Normalization (Target: t / Metric Tonne)
    if target_unit == "t":
        if "lakh" in clean_u and ("t" in clean_u or "ton" in clean_u or "mt" in clean_u):
            return round(raw_value * 100_000.0, 4), "t"
        if "quintal" in clean_u or clean_u == "qtl":
            # 1 Quintal = 100 kg = 0.1 MT
            return round(raw_value * 0.1, 4), "t"
        if clean_u in ("kg", "kgs", "kilogram", "kilograms"):
            # 1 kg = 0.001 MT
            return round(raw_value / 1000.0, 4), "t"
        if clean_u in ("t", "tonne", "tonnes", "ton", "tons", "mt", "metric tonne", "metric tonnes"):
            return raw_value, "t"

    # 3. Calorific Value / GCV Normalization (Target: kcal/kg)
    if target_unit == "kcal/kg":
        if "mj/kg" in clean_u or "gj/t" in clean_u:
            # 1 kcal = 4.184 kJ -> 1 MJ = 1000 kJ -> 1000 / 4.184 = ~239.005736 kcal
            return round(raw_value * (1000.0 / 4.184), 2), "kcal/kg"
        if "kj/kg" in clean_u:
            return round(raw_value / 4.184, 2), "kcal/kg"
        if "btu/lb" in clean_u:
            # 1 kcal/kg = 1.79998 BTU/lb -> BTU/lb / 1.79998
            return round(raw_value / 1.79998, 2), "kcal/kg"
        if "kcal/kg" in clean_u or "cal/g" in clean_u:
            return raw_value, "kcal/kg"

    # 4. Liquid Fuel Volume Normalization (Target: kL)
    if target_unit == "kL":
        if clean_u in ("l", "ltr", "litres", "litre", "liters", "liter"):
            # 1,000 Litres = 1 kL
            return round(raw_value / 1000.0, 4), "kL"
        if clean_u in ("kl", "kilolitre", "kilolitres"):
            return raw_value, "kL"

    # If already in target unit or unknown, return as-is
    return raw_value, target_unit
