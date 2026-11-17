"""Number, unit and conversion helpers for the Extractor_Service.

Code computes, models never do. Everything here is deterministic and uses
``Decimal`` so that conversions such as ``1.5 Lakh t`` to ``150000 t`` are exact.

* ``parse_number`` reads a number as written in an Indian plant document.
* ``parse_unit`` recognizes a unit string and returns its definition.
* ``unit_from_label`` splits a trailing unit out of a label such as
  ``Coal Consumed - Process (Lakh t)``.
* ``convert`` converts a value to the standard unit of a stream. It returns
  ``None`` when the unit does not measure the same quantity as the stream
  (decision D12: no density or other engineering constant is ever invented).
* ``STANDARD_UNIT`` is copied from ``CEMENT_STREAMS`` in
  ``backend/domain/calendar/streams.ts``. There is no default unit: an absent unit
  is the caller's job to flag with ``unit_assumed``.
"""

from __future__ import annotations

import re
import unicodedata
from dataclasses import dataclass
from decimal import Decimal, localcontext

from .models import BEEPATSectorStream

__all__ = [
    "STANDARD_UNIT",
    "Unit",
    "convert",
    "parse_number",
    "parse_unit",
    "unit_from_label",
]

# ---------------------------------------------------------------------------
# Standard units per stream (identical to CEMENT_STREAMS in streams.ts)
# ---------------------------------------------------------------------------

_S = BEEPATSectorStream

STANDARD_UNIT: dict[BEEPATSectorStream, str] = {
    # Production
    _S.EQUIVALENT_PRODUCT: "t",
    _S.CLINKER_PRODUCTION: "t",
    _S.OPC_PRODUCTION: "t",
    _S.PPC_PRODUCTION: "t",
    _S.PSC_PRODUCTION: "t",
    # Solid fuels
    _S.COAL_QUANTITY: "t",
    _S.COAL_GCV: "kcal/kg",
    _S.PETCOKE_QUANTITY: "t",
    _S.PETCOKE_GCV: "kcal/kg",
    _S.IMPORTED_COAL_QUANTITY: "t",
    _S.IMPORTED_COAL_GCV: "kcal/kg",
    _S.BIOMASS_AFR_QUANTITY: "t",
    _S.BIOMASS_AFR_GCV: "kcal/kg",
    # Liquid fuels
    _S.FO_QUANTITY: "t",
    _S.FO_GCV: "kcal/kg",
    _S.HSD_QUANTITY: "kL",
    _S.HSD_GCV: "kcal/kg",
    # Gaseous fuels
    _S.NATURAL_GAS_QUANTITY: "Million SCM",
    _S.NATURAL_GAS_GCV: "kcal/SCM",
    # Electricity
    _S.GRID_ELECTRICITY: "kWh",
    _S.CPP_GENERATION: "kWh",
    _S.WHRS_GENERATION: "kWh",
    _S.POWER_EXPORT: "kWh",
    # Process emissions
    _S.CALCINATION_CO2: "tCO2e",
    _S.RAW_MEAL_CALCINATION: "tCO2e",
}

# ---------------------------------------------------------------------------
# Unit table
# ---------------------------------------------------------------------------


@dataclass(frozen=True)
class Unit:
    """A recognized unit.

    ``num`` and ``den`` are exact ``Decimal`` factors: ``value * num / den`` is the
    value in the base unit of ``dimension``. Two units convert only when they share
    a dimension.
    """

    symbol: str
    dimension: str
    num: Decimal
    den: Decimal = Decimal(1)


_KCAL_KJ = Decimal("4.184")  # thermochemical calorie, in kJ

_DIMENSION_BASE = {
    "mass": "t",
    "energy_electric": "kWh",
    "gcv_mass": "kcal/kg",
    "volume_liquid": "kL",
    "volume_gas": "SCM",
    "gcv_gas": "kcal/SCM",
    "co2_mass": "tCO2e",
}


def _u(symbol: str, dimension: str, num: str | Decimal, den: str | Decimal = "1") -> Unit:
    return Unit(symbol, dimension, Decimal(num), Decimal(den))


_UNITS: tuple[Unit, ...] = (
    # Mass, base t
    _u("t", "mass", "1"),
    _u("kg", "mass", "1", "1000"),
    _u("quintal", "mass", "1", "10"),
    _u("Lakh t", "mass", "100000"),
    # Electricity, base kWh
    _u("kWh", "energy_electric", "1"),
    _u("MWh", "energy_electric", "1000"),
    _u("GWh", "energy_electric", "1000000"),
    _u("MU", "energy_electric", "1000000"),
    _u("Lakh kWh", "energy_electric", "100000"),
    _u("Million kWh", "energy_electric", "1000000"),
    # Calorific value per mass, base kcal/kg
    _u("kcal/kg", "gcv_mass", "1"),
    _u("MJ/kg", "gcv_mass", "1000", _KCAL_KJ),
    _u("GJ/t", "gcv_mass", "1000", _KCAL_KJ),  # 1 GJ/t is 1 MJ/kg
    _u("kJ/kg", "gcv_mass", "1", _KCAL_KJ),
    _u("cal/g", "gcv_mass", "1"),  # 1 cal/g is 1 kcal/kg
    # Liquid volume, base kL
    _u("kL", "volume_liquid", "1"),
    _u("L", "volume_liquid", "1", "1000"),
    # Gas volume, base SCM
    _u("SCM", "volume_gas", "1"),
    _u("Lakh SCM", "volume_gas", "100000"),
    _u("Million SCM", "volume_gas", "1000000"),
    # Calorific value per gas volume, base kcal/SCM
    _u("kcal/SCM", "gcv_gas", "1"),
    _u("MJ/SCM", "gcv_gas", "1000", _KCAL_KJ),
    # CO2 mass, base tCO2e
    _u("tCO2e", "co2_mass", "1"),
)

_BY_SYMBOL: dict[str, Unit] = {u.symbol: u for u in _UNITS}

# Lowercase alias -> canonical symbol. Aliases are matched after _clean_unit_text.
_ALIASES: dict[str, str] = {
    # mass
    "t": "t",
    "tonne": "t",
    "tonnes": "t",
    "mt": "t",
    "metric ton": "t",
    "metric tons": "t",
    "metric tonne": "t",
    "metric tonnes": "t",
    "kg": "kg",
    "kgs": "kg",
    "kilogram": "kg",
    "kilograms": "kg",
    "quintal": "quintal",
    "quintals": "quintal",
    "qtl": "quintal",
    "lakh t": "Lakh t",
    "lakh tonne": "Lakh t",
    "lakh tonnes": "Lakh t",
    "lakh mt": "Lakh t",
    # electricity
    "kwh": "kWh",
    "mwh": "MWh",
    "gwh": "GWh",
    "mu": "MU",
    "lakh kwh": "Lakh kWh",
    "million kwh": "Million kWh",
    # calorific value
    "kcal/kg": "kcal/kg",
    "mj/kg": "MJ/kg",
    "gj/t": "GJ/t",
    "kj/kg": "kJ/kg",
    "cal/g": "cal/g",
    # liquid volume
    "kl": "kL",
    "kilolitre": "kL",
    "kilolitres": "kL",
    "kiloliter": "kL",
    "kiloliters": "kL",
    "l": "L",
    "litre": "L",
    "litres": "L",
    "liter": "L",
    "liters": "L",
    # gas volume
    "scm": "SCM",
    "lakh scm": "Lakh SCM",
    "million scm": "Million SCM",
    "mmscm": "Million SCM",
    # gas calorific value
    "kcal/scm": "kcal/SCM",
    "mj/scm": "MJ/SCM",
    # CO2
    "tco2e": "tCO2e",
    "tco2": "tCO2e",
    "t co2e": "tCO2e",
    "t co2": "tCO2e",
    "tonne co2": "tCO2e",
    "tonnes co2": "tCO2e",
}

_LAKH_RE = re.compile(r"\b(?:lakhs|lacs|lakh|lac)\b")


def _clean_unit_text(text: str) -> str:
    s = unicodedata.normalize("NFKC", text).lower().strip()
    s = re.sub(r"[\s_\-]+", " ", s)
    s = re.sub(r"\s*/\s*", "/", s)
    return _LAKH_RE.sub("lakh", s).strip()


def parse_unit(text: str | None) -> Unit | None:
    """Return the ``Unit`` for ``text``, or ``None`` when it is not a known unit."""
    if not isinstance(text, str) or not text.strip():
        return None
    symbol = _ALIASES.get(_clean_unit_text(text))
    return _BY_SYMBOL[symbol] if symbol else None


_PAREN_RE = re.compile(r"\(([^()]*)\)")


def unit_from_label(label: str) -> tuple[str, str | None]:
    """Split the last recognized parenthetical unit out of ``label``.

    Returns ``(label without the unit, unit as written)``. A parenthetical that is
    not a known unit, such as ``(Process)``, stays in the label. When no unit is
    recognized the result is ``(label, None)``.
    """
    if not isinstance(label, str):
        return "", None
    for match in reversed(list(_PAREN_RE.finditer(label))):
        stated = match.group(1).strip()
        if parse_unit(stated) is not None:
            rest = f"{label[: match.start()]} {label[match.end() :]}"
            return re.sub(r"\s+", " ", rest).strip(), stated
    return label, None


def convert(value: Decimal, unit: str, stream: BEEPATSectorStream) -> Decimal | None:
    """Convert ``value`` in ``unit`` to the standard unit of ``stream``.

    Returns ``None`` when ``unit`` is unknown or measures a different quantity than
    the stream (for example kL of furnace oil against a tonne stream, D12).
    """
    source = parse_unit(unit)
    target = parse_unit(STANDARD_UNIT.get(stream))
    if source is None or target is None or source.dimension != target.dimension:
        return None
    if not isinstance(value, Decimal):
        value = Decimal(str(value))
    if not value.is_finite():
        return None
    with localcontext() as ctx:
        ctx.prec = 50
        return value * source.num * target.den / (source.den * target.num)


# ---------------------------------------------------------------------------
# Number parsing
# ---------------------------------------------------------------------------

_CURRENCY_RE = re.compile(r"(?:₹|\$|€|£|rs\.?|inr|usd)\s*", re.IGNORECASE)
_SIGN_CHARS = "+-\u2212"
# Plain digits, Western grouping (1,234,567) or Indian grouping (12,34,567).
_NUMBER_RE = re.compile(
    r"(?:\d+|[1-9]\d{0,2}(?:,\d{3})+|[1-9]\d?(?:,\d{2})*,\d{3})(?:\.\d+)?|\.\d+"
)


def parse_number(text: str | None) -> Decimal | None:
    """Parse a number written in a plant document, or return ``None``.

    Accepts plain, Western-grouped (``1,234,567``) and Indian-grouped
    (``12,34,567``) digits with an optional decimal part, a leading ``+``, ``-`` or
    Unicode minus, parentheses for a negative, a currency prefix (``₹``, ``Rs.``,
    ``INR``, ``$``, ``€``, ``£``) and a trailing ``%``. The ``%`` is dropped, not
    divided out. Invalid grouping such as ``1,23`` and European ``1.234,5`` give
    ``None``.
    """
    if not isinstance(text, str):
        return None
    s = unicodedata.normalize("NFKC", text).strip()
    if not s:
        return None

    negative = False
    if s.startswith("(") and s.endswith(")"):
        s = s[1:-1].strip()
        negative = True
        if s[:1] in _SIGN_CHARS:  # "(-5)" is ambiguous
            return None

    sign_seen = False
    if s[:1] and s[0] in _SIGN_CHARS:
        negative = negative or s[0] in "-\u2212"
        sign_seen = True
        s = s[1:].lstrip()

    currency = _CURRENCY_RE.match(s)
    if currency:
        s = s[currency.end() :]
        if s[:1] and s[0] in _SIGN_CHARS:
            if sign_seen:
                return None
            negative = negative or s[0] in "-\u2212"
            s = s[1:].lstrip()

    if s.endswith("%"):
        s = s[:-1].rstrip()

    if not _NUMBER_RE.fullmatch(s):
        return None
    result = Decimal(s.replace(",", ""))
    return -result if negative else result
