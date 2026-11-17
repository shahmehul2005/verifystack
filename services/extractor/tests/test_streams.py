"""Unit tests for the Rules_Mapper (``services.extractor.streams``).

Covers word-boundary matching, the key rule, gcv versus quantity selection,
sheet-title context, unresolved ambiguity, and parity with the TypeScript stream table.
"""

from __future__ import annotations

import re
from pathlib import Path

import pytest

from services.extractor.models import BEEPATSectorStream as S
from services.extractor.streams import STREAM_BY_KEY, STREAMS, MapResult, match_label
from services.extractor.units import STANDARD_UNIT

REPO_ROOT = Path(__file__).resolve().parents[3]
STREAMS_TS = REPO_ROOT / "backend" / "domain" / "calendar" / "streams.ts"


# ---------------------------------------------------------------------------
# Key rule
# ---------------------------------------------------------------------------


@pytest.mark.parametrize("spec", STREAMS, ids=lambda s: s.key.value)
@pytest.mark.parametrize("sep", [" ", "_"])
def test_stream_key_maps_to_itself_by_key_rule(spec, sep):
    label = spec.key.value.replace("_", sep)
    assert match_label(label) == MapResult("mapped", spec.key, "key")
    assert match_label(label.upper()) == MapResult("mapped", spec.key, "key")


def test_key_rule_ignores_trailing_unit():
    assert match_label("cpp_generation (kWh)") == MapResult("mapped", S.CPP_GENERATION, "key")


# ---------------------------------------------------------------------------
# Word boundaries (Requirement 9.1)
# ---------------------------------------------------------------------------


@pytest.mark.parametrize(
    "label",
    ["Charcoal", "Coalition", "after", "Afterburner", "Rdfs", "Photo", "Opcode"],
)
def test_synonym_inside_longer_word_does_not_match(label):
    assert match_label(label) == MapResult("none")


def test_synonym_inside_longer_word_is_not_a_fuel_match():
    # "consumed" is a generic word, so the label may be ambiguous, but never coal.
    result = match_label("charcoal consumed")
    assert result.stream is None
    assert result.status == "ambiguous"


@pytest.mark.parametrize(
    ("label", "stream"),
    [
        ("AFR", S.BIOMASS_AFR_QUANTITY),
        ("AFR consumed", S.BIOMASS_AFR_QUANTITY),
        ("Coal", S.COAL_QUANTITY),
        ("Coal consumed (t)", S.COAL_QUANTITY),
        ("Total-Coal/Month", S.COAL_QUANTITY),
        ("OPC cement (t)", S.OPC_PRODUCTION),
        ("FO", S.FO_QUANTITY),
    ],
)
def test_whole_word_synonym_matches(label, stream):
    result = match_label(label)
    assert result.status == "mapped"
    assert result.stream == stream
    assert result.rule == "phrase"


def test_internal_whitespace_and_punctuation_are_flexible():
    assert match_label("Pet   coke  consumed").stream == S.PETCOKE_QUANTITY
    assert match_label("Pet-coke consumed").stream == S.PETCOKE_QUANTITY
    assert match_label("Biomass / AFR").stream == S.BIOMASS_AFR_QUANTITY


def test_fullwidth_letters_are_normalized():
    assert match_label("Ｃｏａｌ").stream == S.COAL_QUANTITY


# ---------------------------------------------------------------------------
# Longest phrase, gcv versus quantity
# ---------------------------------------------------------------------------


def test_longer_phrase_beats_shorter_overlapping_phrase():
    assert match_label("Imported coal").stream == S.IMPORTED_COAL_QUANTITY
    assert match_label("Coal imported (t)").stream == S.IMPORTED_COAL_QUANTITY


@pytest.mark.parametrize(
    ("label", "gcv", "quantity"),
    [
        ("Coal", S.COAL_GCV, S.COAL_QUANTITY),
        ("Petcoke", S.PETCOKE_GCV, S.PETCOKE_QUANTITY),
        ("Imported coal", S.IMPORTED_COAL_GCV, S.IMPORTED_COAL_QUANTITY),
        ("Furnace oil", S.FO_GCV, S.FO_QUANTITY),
        ("HSD", S.HSD_GCV, S.HSD_QUANTITY),
        ("Natural gas", S.NATURAL_GAS_GCV, S.NATURAL_GAS_QUANTITY),
        ("Biomass", S.BIOMASS_AFR_GCV, S.BIOMASS_AFR_QUANTITY),
    ],
)
def test_gcv_token_selects_gcv_stream(label, gcv, quantity):
    assert match_label(f"{label} GCV (kcal/kg)").stream == gcv
    assert match_label(f"{label} gross calorific value").stream == gcv
    assert match_label(f"{label} calorific").stream == gcv
    assert match_label(f"{label} consumed").stream == quantity


def test_non_fuel_streams_are_unaffected_by_gcv_token():
    assert match_label("Clinker production").stream == S.CLINKER_PRODUCTION
    assert match_label("Grid import").stream == S.GRID_ELECTRICITY
    assert match_label("Calcination CO2").stream == S.CALCINATION_CO2
    assert match_label("Raw meal carbonate").stream == S.RAW_MEAL_CALCINATION


@pytest.mark.parametrize(
    ("label", "stream"),
    [
        ("Total equivalent product", S.EQUIVALENT_PRODUCT),
        ("PPC cement (t)", S.PPC_PRODUCTION),
        ("Composite cement", S.PSC_PRODUCTION),
        ("Purchased power", S.GRID_ELECTRICITY),
        ("Captive power generation", S.CPP_GENERATION),
        ("WHRS", S.WHRS_GENERATION),
        ("Power exported", S.POWER_EXPORT),
        ("Diesel", S.HSD_QUANTITY),
    ],
)
def test_family_phrases_map_by_phrase_rule(label, stream):
    assert match_label(label) == MapResult("mapped", stream, "phrase")


# ---------------------------------------------------------------------------
# Title context (Requirements 9.2, 9.5)
# ---------------------------------------------------------------------------


def test_generic_label_is_ambiguous_without_title():
    assert match_label("Consumption") == MapResult("ambiguous")
    assert match_label("GCV (kcal/kg)") == MapResult("ambiguous")
    assert match_label("Generation") == MapResult("ambiguous")


@pytest.mark.parametrize(
    ("label", "title", "stream"),
    [
        ("Consumption", "Petcoke log", S.PETCOKE_QUANTITY),
        ("Quantity (t)", "Imported coal receipts", S.IMPORTED_COAL_QUANTITY),
        ("GCV (kcal/kg)", "Furnace oil analysis", S.FO_GCV),
        ("Generation (kWh)", "CPP daily report", S.CPP_GENERATION),
        ("Generation (kWh)", "WHRS log", S.WHRS_GENERATION),
        ("Production", "Clinker register", S.CLINKER_PRODUCTION),
        ("Calcination", "Raw meal calcination sheet", S.RAW_MEAL_CALCINATION),
    ],
)
def test_title_resolves_generic_label(label, title, stream):
    assert match_label(label, title) == MapResult("mapped", stream, "title")


def test_title_that_names_several_candidates_stays_ambiguous():
    assert match_label("Consumption", "Coal and petcoke log") == MapResult("ambiguous")
    assert match_label("Generation", "CPP and WHRS") == MapResult("ambiguous")


def test_title_naming_no_family_stays_ambiguous():
    assert match_label("Consumption", "Monthly MIS") == MapResult("ambiguous")


def test_label_naming_two_streams_is_ambiguous_without_title_help():
    assert match_label("Coal and petcoke consumption") == MapResult("ambiguous")
    assert match_label("Coal and petcoke consumption", "Kiln feed sheet") == MapResult("ambiguous")


def test_title_resolves_label_that_names_two_streams():
    result = match_label("Coal and petcoke consumption", "Petcoke register")
    assert result == MapResult("mapped", S.PETCOKE_QUANTITY, "title")


def test_title_does_not_override_an_unambiguous_label():
    result = match_label("Coal consumed", "Petcoke register")
    assert result == MapResult("mapped", S.COAL_QUANTITY, "phrase")


# ---------------------------------------------------------------------------
# Never raises
# ---------------------------------------------------------------------------


@pytest.mark.parametrize("label", ["", "   ", "(t)", "123", "!!!", "\x00", "Total", "Remarks"])
def test_unmappable_labels_return_none(label):
    assert match_label(label) == MapResult("none")


@pytest.mark.parametrize("label", [None, 12, 1.5, b"coal", ["coal"]])
def test_non_string_label_returns_none(label):
    assert match_label(label) == MapResult("none")  # type: ignore[arg-type]


@pytest.mark.parametrize("title", [None, 7, b"coal"])
def test_non_string_title_is_ignored(title):
    assert match_label("Consumption", title) == MapResult("ambiguous")  # type: ignore[arg-type]


def test_very_long_label_does_not_raise():
    assert match_label("coal " * 5000).stream == S.COAL_QUANTITY


# ---------------------------------------------------------------------------
# Stream table
# ---------------------------------------------------------------------------


def test_table_covers_every_enum_value_once():
    keys = [s.key for s in STREAMS]
    assert len(keys) == len(set(keys)) == 25
    assert set(keys) == set(S)
    assert set(STREAM_BY_KEY) == set(S)


def test_spec_standard_unit_comes_from_units_table():
    for spec in STREAMS:
        assert spec.standard_unit == STANDARD_UNIT[spec.key]


# ---------------------------------------------------------------------------
# Parity with backend/domain/calendar/streams.ts
# ---------------------------------------------------------------------------


def _read_ts_streams() -> dict[str, str]:
    """``{key: standardUnit}`` from the ``CEMENT_STREAMS`` table in the TypeScript file."""
    text = STREAMS_TS.read_text(encoding="utf-8")
    table = text.split("export const CEMENT_STREAMS", 1)[1].split("export const CATEGORY_METADATA", 1)[0]
    pairs = re.findall(
        r'key:\s*"([a-z0-9_]+)"[^{}]*?standardUnit:\s*"([^"]+)"', table, flags=re.DOTALL
    )
    return dict(pairs)


@pytest.mark.skipif(
    not STREAMS_TS.exists(),
    reason="backend/domain/calendar/streams.ts is not present in this checkout",
)
class TestTypeScriptParity:
    def test_ts_table_was_read(self):
        assert len(_read_ts_streams()) == 25

    def test_stream_keys_match(self):
        assert set(_read_ts_streams()) == {s.key.value for s in STREAMS}

    def test_standard_units_match(self):
        ts = _read_ts_streams()
        py = {s.key.value: s.standard_unit for s in STREAMS}
        assert py == ts

    def test_enum_values_match(self):
        assert {s.value for s in S} == set(_read_ts_streams())
