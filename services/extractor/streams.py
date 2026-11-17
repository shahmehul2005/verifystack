"""Rules_Mapper: deterministic mapping of labels to calendar streams.

The Rules_Mapper is the first stage of mapping (Requirement 9). It decides, with
fixed rules and no model, which ``BEEPATSectorStream`` a header or row label
belongs to. Labels it cannot place are left for the Mapper_Agent.

Rules, in order:

1. The label is normalized (NFKC, lowercase, trailing unit removed, punctuation
   turned into single spaces).
2. A label equal to a stream key (underscores read as spaces) maps by rule ``key``.
   The calendar template uses this path.
3. Each stream phrase is tested with word boundaries, so ``coal`` never matches
   inside ``charcoal`` and ``afr`` never matches inside ``after`` (Requirement 9.1).
4. A phrase is dropped when a longer phrase of another stream overlaps it, so
   ``imported coal`` beats ``coal``. Within a family that has a quantity stream and
   a gcv stream, a ``gcv`` or ``calorific`` token selects the gcv stream and its
   absence selects the quantity stream.
5. When no family phrase matches, generic phrases (``gcv``, ``consumption``,
   ``generation``, ...) give candidates across several families.
6. One candidate left is ``mapped`` by rule ``phrase``. Several candidates are
   resolved by the sheet title: when the title names families and exactly one
   candidate lies in them, the label is ``mapped`` by rule ``title``
   (Requirement 9.2). Otherwise the label is ``ambiguous`` and stays unmapped
   (Requirement 9.5).

``match_label`` never raises. ``standard_unit`` values come from
``units.STANDARD_UNIT``, which is copied from ``CEMENT_STREAMS`` in
``backend/domain/calendar/streams.ts``.
"""

from __future__ import annotations

import re
import unicodedata
from dataclasses import dataclass
from typing import Literal

from .models import BEEPATSectorStream
from .units import STANDARD_UNIT, unit_from_label

__all__ = [
    "STREAMS",
    "STREAM_BY_KEY",
    "MapResult",
    "StreamSpec",
    "match_label",
]

_S = BEEPATSectorStream

Kind = Literal["quantity", "gcv", "production", "generation", "emission"]


@dataclass(frozen=True)
class StreamSpec:
    """One calendar stream with the phrases that name it."""

    key: BEEPATSectorStream
    standard_unit: str  # equal to the TypeScript standardUnit
    family: str  # "coal", "petcoke", "cpp", ...
    kind: Kind
    phrases: tuple[str, ...]


@dataclass(frozen=True)
class MapResult:
    status: Literal["mapped", "ambiguous", "none"]
    stream: BEEPATSectorStream | None = None
    rule: Literal["key", "phrase", "title"] | None = None


_NONE = MapResult("none")
_AMBIGUOUS = MapResult("ambiguous")


# ---------------------------------------------------------------------------
# Stream table
# ---------------------------------------------------------------------------


def _spec(
    key: BEEPATSectorStream, family: str, kind: Kind, phrases: tuple[str, ...]
) -> StreamSpec:
    return StreamSpec(key, STANDARD_UNIT[key], family, kind, phrases)


def _fuel(
    family: str,
    quantity: BEEPATSectorStream,
    gcv: BEEPATSectorStream,
    phrases: tuple[str, ...],
) -> tuple[StreamSpec, StreamSpec]:
    """A fuel family: a quantity stream and a gcv stream that share phrases."""
    return (
        _spec(quantity, family, "quantity", phrases),
        _spec(gcv, family, "gcv", phrases),
    )


STREAMS: tuple[StreamSpec, ...] = (
    # Production
    _spec(
        _S.EQUIVALENT_PRODUCT,
        "equivalent_product",
        "production",
        (
            "equivalent product",
            "total equivalent product",
            "equivalent cement",
            "equivalent cement production",
            "cement equivalent",
        ),
    ),
    _spec(
        _S.CLINKER_PRODUCTION,
        "clinker",
        "production",
        ("clinker", "clinker production", "clinker produced"),
    ),
    _spec(
        _S.OPC_PRODUCTION,
        "opc",
        "production",
        ("opc", "ordinary portland cement"),
    ),
    _spec(
        _S.PPC_PRODUCTION,
        "ppc",
        "production",
        ("ppc", "portland pozzolana cement", "pozzolana cement"),
    ),
    _spec(
        _S.PSC_PRODUCTION,
        "psc",
        "production",
        (
            "psc",
            "pcc",
            "portland slag cement",
            "slag cement",
            "composite cement",
            "portland composite cement",
        ),
    ),
    # Solid fuels
    *_fuel(
        "coal",
        _S.COAL_QUANTITY,
        _S.COAL_GCV,
        ("coal", "indian coal", "domestic coal", "indigenous coal"),
    ),
    *_fuel(
        "petcoke",
        _S.PETCOKE_QUANTITY,
        _S.PETCOKE_GCV,
        ("petcoke", "pet coke", "petroleum coke"),
    ),
    *_fuel(
        "imported_coal",
        _S.IMPORTED_COAL_QUANTITY,
        _S.IMPORTED_COAL_GCV,
        ("imported coal", "import coal", "coal imported", "coal import"),
    ),
    *_fuel(
        "biomass_afr",
        _S.BIOMASS_AFR_QUANTITY,
        _S.BIOMASS_AFR_GCV,
        (
            "biomass",
            "afr",
            "alternative fuel",
            "alternative fuels",
            "alternate fuel",
            "alternate fuels",
            "rdf",
            "refuse derived fuel",
            "tyre chips",
        ),
    ),
    # Liquid fuels
    *_fuel("fo", _S.FO_QUANTITY, _S.FO_GCV, ("furnace oil", "fo")),
    *_fuel(
        "hsd",
        _S.HSD_QUANTITY,
        _S.HSD_GCV,
        ("high speed diesel", "hsd", "diesel"),
    ),
    # Gaseous fuels
    *_fuel(
        "natural_gas",
        _S.NATURAL_GAS_QUANTITY,
        _S.NATURAL_GAS_GCV,
        ("natural gas", "png", "lng"),
    ),
    # Electricity
    _spec(
        _S.GRID_ELECTRICITY,
        "grid",
        "quantity",
        (
            "grid electricity",
            "grid power",
            "grid import",
            "grid purchase",
            "purchased power",
            "purchased electricity",
            "power purchased",
            "electricity purchased",
            "discom",
        ),
    ),
    _spec(
        _S.CPP_GENERATION,
        "cpp",
        "generation",
        (
            "cpp",
            "cpp generation",
            "captive power",
            "captive power plant",
            "captive power generation",
        ),
    ),
    _spec(
        _S.WHRS_GENERATION,
        "whrs",
        "generation",
        ("whrs", "whr", "waste heat recovery", "waste heat recovery system"),
    ),
    _spec(
        _S.POWER_EXPORT,
        "export",
        "quantity",
        (
            "power export",
            "power exported",
            "exported power",
            "electricity export",
            "electricity exported",
            "export to grid",
            "exported to grid",
        ),
    ),
    # Process emissions
    _spec(
        _S.CALCINATION_CO2,
        "calcination",
        "emission",
        (
            "calcination co2",
            "clinker calcination",
            "calcination emissions",
            "calcination emission",
        ),
    ),
    _spec(
        _S.RAW_MEAL_CALCINATION,
        "raw_meal",
        "emission",
        (
            "raw meal calcination",
            "raw meal carbonate",
            "raw meal carbonate calcination",
            "raw meal co2",
        ),
    ),
)

STREAM_BY_KEY: dict[BEEPATSectorStream, StreamSpec] = {s.key: s for s in STREAMS}

_FUEL_QUANTITY_KEYS = (
    _S.COAL_QUANTITY,
    _S.PETCOKE_QUANTITY,
    _S.IMPORTED_COAL_QUANTITY,
    _S.BIOMASS_AFR_QUANTITY,
    _S.FO_QUANTITY,
    _S.HSD_QUANTITY,
    _S.NATURAL_GAS_QUANTITY,
)
_GCV_KEYS = (
    _S.COAL_GCV,
    _S.PETCOKE_GCV,
    _S.IMPORTED_COAL_GCV,
    _S.BIOMASS_AFR_GCV,
    _S.FO_GCV,
    _S.HSD_GCV,
    _S.NATURAL_GAS_GCV,
)

# Weak phrases that name a kind of figure but no fuel. They apply only when no
# family phrase matches, and usually leave several candidates for the title step.
_GENERIC: tuple[tuple[tuple[str, ...], tuple[BEEPATSectorStream, ...]], ...] = (
    (("quantity", "qty", "consumption", "consumed", "usage"), _FUEL_QUANTITY_KEYS),
    (("gcv", "gross calorific value", "calorific value", "calorific"), _GCV_KEYS),
    (
        ("generation", "gross generation", "power generation"),
        (_S.CPP_GENERATION, _S.WHRS_GENERATION),
    ),
    (
        ("production", "produced"),
        (
            _S.EQUIVALENT_PRODUCT,
            _S.CLINKER_PRODUCTION,
            _S.OPC_PRODUCTION,
            _S.PPC_PRODUCTION,
            _S.PSC_PRODUCTION,
        ),
    ),
    (
        ("calcination", "calcination co2"),
        (_S.CALCINATION_CO2, _S.RAW_MEAL_CALCINATION),
    ),
)


# ---------------------------------------------------------------------------
# Matching
# ---------------------------------------------------------------------------

# Unicode-aware "letter or digit" class: \w without the underscore.
_ALNUM = r"[^\W_]"
_NON_ALNUM_RUN = re.compile(r"[\W_]+")
_GCV_TOKEN = re.compile(rf"(?<!{_ALNUM})(?:gcv|calorific)(?!{_ALNUM})")


def _normalize(text: str) -> str:
    s = unicodedata.normalize("NFKC", text)
    s, _unit = unit_from_label(s)
    return _NON_ALNUM_RUN.sub(" ", s.lower()).strip()


def _phrase_regex(phrase: str) -> re.Pattern[str]:
    body = r"\s+".join(re.escape(part) for part in phrase.split())
    return re.compile(rf"(?<!{_ALNUM}){body}(?!{_ALNUM})")


@dataclass(frozen=True)
class _Rule:
    spec: StreamSpec
    phrase: str
    pattern: re.Pattern[str]


def _build_rules() -> tuple[tuple[_Rule, ...], tuple[_Rule, ...]]:
    specific = tuple(
        _Rule(spec, p, _phrase_regex(p)) for spec in STREAMS for p in spec.phrases
    )
    generic = tuple(
        _Rule(STREAM_BY_KEY[key], p, _phrase_regex(p))
        for phrases, keys in _GENERIC
        for p in phrases
        for key in keys
    )
    return specific, generic


_SPECIFIC_RULES, _GENERIC_RULES = _build_rules()
_KEY_TEXT: dict[str, BEEPATSectorStream] = {
    s.key.value.replace("_", " "): s.key for s in STREAMS
}


@dataclass(frozen=True)
class _Hit:
    spec: StreamSpec
    phrase: str
    start: int
    end: int


def _hits(text: str, rules: tuple[_Rule, ...]) -> list[_Hit]:
    """Every phrase match in ``text`` that no longer, overlapping phrase beats."""
    found = [
        _Hit(r.spec, r.phrase, m.start(), m.end())
        for r in rules
        for m in r.pattern.finditer(text)
    ]
    return [
        h
        for h in found
        if not any(
            o is not h
            and o.start < h.end
            and h.start < o.end
            and len(o.phrase) > len(h.phrase)
            for o in found
        )
    ]


def _select_kind(specs: list[StreamSpec], wants_gcv: bool) -> list[StreamSpec]:
    """Within a family that has both a quantity and a gcv stream, pick one."""
    kinds_by_family: dict[str, set[str]] = {}
    for s in specs:
        kinds_by_family.setdefault(s.family, set()).add(s.kind)
    wanted = "gcv" if wants_gcv else "quantity"
    return [
        s
        for s in specs
        if not {"quantity", "gcv"} <= kinds_by_family[s.family] or s.kind == wanted
    ]


def _unique(specs: list[StreamSpec]) -> list[StreamSpec]:
    seen: dict[BEEPATSectorStream, StreamSpec] = {}
    for s in specs:
        seen.setdefault(s.key, s)
    return list(seen.values())


def _title_families(title: str) -> set[str]:
    text = _normalize(title)
    if not text:
        return set()
    return {h.spec.family for h in _hits(text, _SPECIFIC_RULES)}


def match_label(label: str, title: str = "") -> MapResult:
    """Map ``label`` to a stream using word-boundary rules and the sheet ``title``.

    Returns ``mapped`` with the stream, ``ambiguous`` when several streams match and
    the title does not choose one, or ``none``. Never raises.
    """
    try:
        return _match_label(label, title)
    except Exception:  # the mapper is a best-effort stage; any failure leaves the label unmapped
        return _NONE


def _match_label(label: str, title: str) -> MapResult:
    if not isinstance(label, str):
        return _NONE
    text = _normalize(label)
    if not text:
        return _NONE

    key = _KEY_TEXT.get(text)
    if key is not None:
        return MapResult("mapped", key, "key")

    wants_gcv = _GCV_TOKEN.search(text) is not None
    hits = _hits(text, _SPECIFIC_RULES)
    if hits:
        candidates = _select_kind(_unique([h.spec for h in hits]), wants_gcv)
    else:
        candidates = _unique([h.spec for h in _hits(text, _GENERIC_RULES)])
    if not candidates:
        return _NONE
    if len(candidates) == 1:
        return MapResult("mapped", candidates[0].key, "phrase")

    families = _title_families(title) if isinstance(title, str) else set()
    in_title = [c for c in candidates if c.family in families]
    if len(in_title) == 1:
        return MapResult("mapped", in_title[0].key, "title")
    return _AMBIGUOUS
