"""
Comprehensive Factor Register for BEE PAT-2 & CCTS Cement Sector Verification.
Includes authoritative defaults, standard emission factors (IPCC 2006 & CEA),
calorific values (GCV/NCV), calcination factors, and energy conversion constants.
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Dict, Optional, Tuple


@dataclass(frozen=True)
class FuelFactorDefinition:
    key: str
    label: str
    category: str
    standard_unit: str
    default_gcv: float  # kcal/kg or kcal/L or kcal/SCM
    gcv_unit: str
    gcv_min: float
    gcv_max: float
    emission_factor_tj: float  # tCO2e / TJ (IPCC 2006 default)
    ncv_to_gcv_ratio: float  # typically 0.95 for coal/oil, 0.90 for gas
    source_reference: str
    notes: str = ""


# =============================================================================
# STATUTORY CEMENT SECTOR FUEL & ENERGY FACTOR REGISTER
# =============================================================================

CEMENT_FACTOR_REGISTER: Dict[str, FuelFactorDefinition] = {
    # Solid Fuels
    "coal": FuelFactorDefinition(
        key="coal",
        label="Indian Non-Coking Coal",
        category="solid_fuel",
        standard_unit="t",
        default_gcv=4000.0,
        gcv_unit="kcal/kg",
        gcv_min=2200.0,
        gcv_max=7000.0,
        emission_factor_tj=96.1,  # IPCC 2006 Vol.2 Table 2.2 Sub-bituminous
        ncv_to_gcv_ratio=0.95,
        source_reference="BEE PAT Sector Guidelines / Coal India G1-G17 Grading",
        notes="Indian coal is graded by GCV band. Lab test certificates supersede defaults.",
    ),
    "imported_coal": FuelFactorDefinition(
        key="imported_coal",
        label="Imported Bituminous Coal",
        category="solid_fuel",
        standard_unit="t",
        default_gcv=5800.0,
        gcv_unit="kcal/kg",
        gcv_min=4500.0,
        gcv_max=6800.0,
        emission_factor_tj=94.6,  # IPCC 2006 Vol.2 Table 2.2 Bituminous
        ncv_to_gcv_ratio=0.95,
        source_reference="IPCC 2006 / Indonesian/South African Coal Specifications",
        notes="Typically South African, Indonesian, or Australian coal.",
    ),
    "petcoke": FuelFactorDefinition(
        key="petcoke",
        label="Petroleum Coke (Petcoke)",
        category="solid_fuel",
        standard_unit="t",
        default_gcv=8200.0,
        gcv_unit="kcal/kg",
        gcv_min=7500.0,
        gcv_max=8800.0,
        emission_factor_tj=97.5,  # IPCC 2006 Vol.2 Table 2.2 Petroleum Coke
        ncv_to_gcv_ratio=0.95,
        source_reference="IPCC 2006 / Domestic Refinery & US Gulf Petcoke Specs",
        notes="High sulphur and low volatile content. Widely used in Indian cement kilns.",
    ),
    "lignite": FuelFactorDefinition(
        key="lignite",
        label="Lignite",
        category="solid_fuel",
        standard_unit="t",
        default_gcv=3000.0,
        gcv_unit="kcal/kg",
        gcv_min=2400.0,
        gcv_max=3800.0,
        emission_factor_tj=101.0,  # IPCC 2006 Vol.2 Table 2.2 Lignite
        ncv_to_gcv_ratio=0.90,
        source_reference="BEE Energy Audit Manual / Neyveli & Gujarat Lignite",
        notes="High moisture content, used in plants near lignite mines.",
    ),
    "biomass_afr": FuelFactorDefinition(
        key="biomass_afr",
        label="Biomass / Alternative Fuels & Raw Materials (AFR)",
        category="solid_fuel",
        standard_unit="t",
        default_gcv=3500.0,
        gcv_unit="kcal/kg",
        gcv_min=2000.0,
        gcv_max=5000.0,
        emission_factor_tj=0.0,  # Biogenic CO2 is neutral under CCTS/PAT Scope 1 net emissions
        ncv_to_gcv_ratio=0.90,
        source_reference="BEE Cement PAT-2 Normalization Rules / IPCC 2006",
        notes="Agricultural residue, RDF (refuse derived fuel), or biomass briquettes.",
    ),

    # Liquid Fuels
    "furnace_oil": FuelFactorDefinition(
        key="furnace_oil",
        label="Furnace Oil (FO)",
        category="liquid_fuel",
        standard_unit="kL",
        default_gcv=10000.0,
        gcv_unit="kcal/kg",
        gcv_min=9200.0,
        gcv_max=10500.0,
        emission_factor_tj=77.4,  # IPCC 2006 Vol.2 Table 2.2 Residual Fuel Oil
        ncv_to_gcv_ratio=0.95,
        source_reference="BEE General Guidelines / Indian Oil Corporation FO Specs",
        notes="Nominal density ~0.96 kg/L. 1 kL ≈ 0.96 MT.",
    ),
    "hsd": FuelFactorDefinition(
        key="hsd",
        label="High Speed Diesel (HSD)",
        category="liquid_fuel",
        standard_unit="kL",
        default_gcv=10500.0,
        gcv_unit="kcal/kg",
        gcv_min=10000.0,
        gcv_max=11000.0,
        emission_factor_tj=74.1,  # IPCC 2006 Vol.2 Table 2.2 Gas Oil / Diesel
        ncv_to_gcv_ratio=0.95,
        source_reference="BEE General Guidelines / DG Set Specific Energy Manual",
        notes="Nominal density ~0.84 kg/L (8,800 kcal/L). Primarily for mobile equipment & DG.",
    ),
    "ldo": FuelFactorDefinition(
        key="ldo",
        label="Light Diesel Oil (LDO)",
        category="liquid_fuel",
        standard_unit="kL",
        default_gcv=10200.0,
        gcv_unit="kcal/kg",
        gcv_min=9800.0,
        gcv_max=10600.0,
        emission_factor_tj=74.1,
        ncv_to_gcv_ratio=0.95,
        source_reference="Indian Standard IS 1460",
        notes="Used for pre-heater light-up and auxiliary burners.",
    ),

    # Gaseous Fuels
    "natural_gas": FuelFactorDefinition(
        key="natural_gas",
        label="Natural Gas / Piped Natural Gas (PNG)",
        category="gaseous_fuel",
        standard_unit="SCM",
        default_gcv=8500.0,
        gcv_unit="kcal/SCM",
        gcv_min=8000.0,
        gcv_max=9500.0,
        emission_factor_tj=56.1,  # IPCC 2006 Vol.2 Table 2.2 Natural Gas
        ncv_to_gcv_ratio=0.90,
        source_reference="GAIL / City Gas Distribution Network Invoices",
        notes="1 SCM ≈ 8,500 kcal GCV. High hydrogen content gives 0.90 NCV ratio.",
    ),
    "lpg": FuelFactorDefinition(
        key="lpg",
        label="Liquefied Petroleum Gas (LPG)",
        category="gaseous_fuel",
        standard_unit="t",
        default_gcv=11000.0,
        gcv_unit="kcal/kg",
        gcv_min=10500.0,
        gcv_max=11800.0,
        emission_factor_tj=63.1,  # IPCC 2006 Vol.2 Table 2.2 LPG
        ncv_to_gcv_ratio=0.92,
        source_reference="BEE Energy Conversion Table",
        notes="Mixture of propane and butane.",
    ),
}

# =============================================================================
# ELECTRICITY & PROCESS EMISSION CONSTANTS
# =============================================================================

# CEA CO2 Baseline Database for the Indian Power Sector (User's Compliance Cycle)
CEA_GRID_EMISSION_FACTOR = 0.716  # tCO2e / MWh (0.716 kg CO2/kWh)

# Process Calcination Emission Factor (IPCC 2006 Tier 2 Cement Manufacturing)
# CO2 released from CaCO3 -> CaO + CO2 during clinker burning
# Standard 65% CaO content in clinker with 0.785 t CO2 / t CaO stoichiometric ratio
CLINKER_CALCINATION_FACTOR = 0.525  # tCO2 / tonne clinker
RAW_MEAL_CALCINATION_FACTOR = 0.440  # tCO2 / tonne raw meal

# Fundamental Physics Constants
KCAL_TO_KJ = 4.1868
KCAL_TO_TJ = 4.1868e-9
KWH_TO_KCAL = 860.0
KWH_TO_MJ = 3.6
TJ_TO_KWH = 277777.78


def get_fuel_factor(fuel_or_stream_key: str) -> Optional[FuelFactorDefinition]:
    """Resolves a fuel definition from stream key or common alias."""
    k = fuel_or_stream_key.lower().replace("_quantity", "").replace("_gcv", "").strip()
    if k in CEMENT_FACTOR_REGISTER:
        return CEMENT_FACTOR_REGISTER[k]
    if "imported" in k and "coal" in k:
        return CEMENT_FACTOR_REGISTER["imported_coal"]
    if "coal" in k:
        return CEMENT_FACTOR_REGISTER["coal"]
    if "petcoke" in k or "pet_coke" in k:
        return CEMENT_FACTOR_REGISTER["petcoke"]
    if "diesel" in k or "hsd" in k:
        return CEMENT_FACTOR_REGISTER["hsd"]
    if "furnace" in k or "fo" in k:
        return CEMENT_FACTOR_REGISTER["furnace_oil"]
    if "gas" in k or "png" in k:
        return CEMENT_FACTOR_REGISTER["natural_gas"]
    if "biomass" in k or "afr" in k:
        return CEMENT_FACTOR_REGISTER["biomass_afr"]
    if "lignite" in k:
        return CEMENT_FACTOR_REGISTER["lignite"]
    return None


def calculate_fuel_energy_tj(
    quantity: float,
    gcv_kcal_per_unit: float,
    ncv_to_gcv_ratio: float = 0.95,
) -> float:
    """Computes Net Energy content in Terajoules (TJ) from Quantity and GCV."""
    total_gcv_kcal = quantity * 1000.0 * gcv_kcal_per_unit  # assuming quantity in tonnes
    total_ncv_kcal = total_gcv_kcal * ncv_to_gcv_ratio
    return total_ncv_kcal * KCAL_TO_TJ


def calculate_fuel_emissions_tco2e(
    fuel_key: str,
    quantity: float,
    gcv_kcal: Optional[float] = None,
) -> Tuple[float, float]:
    """
    Returns (energy_tj, emissions_tco2e).
    Deterministic calculation complying with 'Code computes; models never do'.
    """
    factor = get_fuel_factor(fuel_key)
    if not factor:
        raise ValueError(f"Unknown fuel key: {fuel_key}")

    used_gcv = gcv_kcal if (gcv_kcal and gcv_kcal > 0) else factor.default_gcv
    energy_tj = calculate_fuel_energy_tj(quantity, used_gcv, factor.ncv_to_gcv_ratio)
    emissions = energy_tj * factor.emission_factor_tj
    return energy_tj, emissions
