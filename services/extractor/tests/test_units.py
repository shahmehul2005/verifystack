"""Unit tests for ``units.py``: number formats, label units and conversion edge cases.

Covers Requirements 5.6 (number formats), 6.4 and 6.5 (label units, no default unit),
and 10.5 (exact conversion to the standard unit).
"""

from __future__ import annotations

from decimal import Decimal

import pytest

from services.extractor.models import BEEPATSectorStream as S
from services.extractor.tests.factories import render_number
from services.extractor.units import (
    STANDARD_UNIT,
    convert,
    parse_number,
    parse_unit,
    unit_from_label,
)

D = Decimal


# ---------------------------------------------------------------------------
# parse_number
# ---------------------------------------------------------------------------


@pytest.mark.parametrize(
    ("text", "expected"),
    [
        ("0", D("0")),
        ("42", D("42")),
        ("1234567", D("1234567")),
        ("1234.5", D("1234.5")),
        (".5", D("0.5")),
        ("  7.25  ", D("7.25")),
        # Western grouping
        ("1,234", D("1234")),
        ("1,234,567", D("1234567")),
        ("1,234,567.89", D("1234567.89")),
        # Indian grouping
        ("12,34,567", D("1234567")),
        ("1,23,456.5", D("123456.5")),
        ("1,00,00,000", D("10000000")),
        # Signs
        ("-5", D("-5")),
        ("+5", D("5")),
        ("\u22125.5", D("-5.5")),
        ("(1,234)", D("-1234")),
        ("(12.5)", D("-12.5")),
        # Currency
        ("\u20b91,00,000", D("100000")),
        ("\u20b9 1,00,000", D("100000")),
        ("Rs. 2,500", D("2500")),
        ("INR 750", D("750")),
        ("$1,234.50", D("1234.50")),
        ("-\u20b9500", D("-500")),
        # Percent: the sign is dropped, nothing is divided
        ("45%", D("45")),
        ("12.5 %", D("12.5")),
        # Full-width digits normalize
        ("\uff11\uff12\uff13", D("123")),
    ],
)
def test_parse_number_accepts(text: str, expected: Decimal) -> None:
    result = parse_number(text)
    assert result == expected
    assert isinstance(result, Decimal)


@pytest.mark.parametrize(
    "text",
    [
        "",
        "   ",
        "abc",
        "12abc",
        "1,23",  # invalid grouping
        "1,2345",
        "12,3456,789",
        "123,45,678",
        "1.234,5",  # European
        "1,234.5.6",
        "5.",
        "--5",
        "(-5)",
        "()",
        "1 234",
        "N/A",
        "-",
        "%",
    ],
)
def test_parse_number_rejects(text: str) -> None:
    assert parse_number(text) is None


@pytest.mark.parametrize("value", [None, 5, 5.5, b"5", ["5"]])
def test_parse_number_rejects_non_strings(value: object) -> None:
    assert parse_number(value) is None  # type: ignore[arg-type]


@pytest.mark.parametrize("style", ["plain", "western", "indian"])
@pytest.mark.parametrize("value", [D("7"), D("1234"), D("1234567.5"), D("987654321.125")])
def test_parse_number_reads_rendered_styles(value: Decimal, style: str) -> None:
    assert parse_number(render_number(value, style)) == value


def test_parse_number_keeps_decimal_exactness() -> None:
    # A float would give 0.30000000000000004 for the sum of these.
    assert parse_number("0.1") + parse_number("0.2") == D("0.3")


# ---------------------------------------------------------------------------
# parse_unit
# ---------------------------------------------------------------------------


@pytest.mark.parametrize(
    ("text", "symbol"),
    [
        ("t", "t"),
        ("Tonnes", "t"),
        ("MT", "t"),
        ("metric tonnes", "t"),
        ("kg", "kg"),
        ("Lakh t", "Lakh t"),
        ("lakh tonnes", "Lakh t"),
        ("Lacs t", "Lakh t"),
        ("LAKH-T", "Lakh t"),
        ("kWh", "kWh"),
        ("KWH", "kWh"),
        ("Lakh kWh", "Lakh kWh"),
        ("Lakhs kWh", "Lakh kWh"),
        ("MU", "MU"),
        ("kcal/kg", "kcal/kg"),
        ("kcal / kg", "kcal/kg"),
        ("KCAL/KG", "kcal/kg"),
        ("kL", "kL"),
        ("litres", "L"),
        ("SCM", "SCM"),
        ("Million SCM", "Million SCM"),
        ("tCO2e", "tCO2e"),
        ("t CO2", "tCO2e"),
    ],
)
def test_parse_unit_recognizes(text: str, symbol: str) -> None:
    unit = parse_unit(text)
    assert unit is not None
    assert unit.symbol == symbol


@pytest.mark.parametrize("text", [None, "", "  ", "Process", "furlongs", "Rs", 5])
def test_parse_unit_unknown_is_none(text: object) -> None:
    assert parse_unit(text) is None  # type: ignore[arg-type]


# ---------------------------------------------------------------------------
# unit_from_label
# ---------------------------------------------------------------------------


def test_unit_from_label_splits_trailing_unit() -> None:
    assert unit_from_label("Coal Consumed - Process (Lakh t)") == (
        "Coal Consumed - Process",
        "Lakh t",
    )


def test_unit_from_label_keeps_unit_as_written() -> None:
    assert unit_from_label("Grid Power (Lakh kWh)") == ("Grid Power", "Lakh kWh")
    assert unit_from_label("Clinker (TONNES)") == ("Clinker", "TONNES")


def test_unit_from_label_leaves_non_unit_parenthetical() -> None:
    assert unit_from_label("Coal (Process)") == ("Coal (Process)", None)


def test_unit_from_label_uses_last_recognized_parenthetical() -> None:
    assert unit_from_label("Qty (kg) (t)") == ("Qty (kg)", "t")
    # The unit is not the last parenthetical; the process note stays in the label.
    assert unit_from_label("Coal (t) (Process)") == ("Coal (Process)", "t")


def test_unit_from_label_without_parenthetical() -> None:
    assert unit_from_label("Clinker Production") == ("Clinker Production", None)


def test_unit_from_label_empty_and_non_string() -> None:
    assert unit_from_label("") == ("", None)
    assert unit_from_label(None) == ("", None)  # type: ignore[arg-type]


# ---------------------------------------------------------------------------
# convert
# ---------------------------------------------------------------------------


def test_convert_lakh_tonnes_is_exact() -> None:
    assert convert(D("1.5"), "Lakh t", S.CLINKER_PRODUCTION) == D("150000")


def test_convert_lakh_kwh_is_exact() -> None:
    assert convert(D("30"), "Lakh kWh", S.GRID_ELECTRICITY) == D("3000000")


@pytest.mark.parametrize(
    ("value", "unit", "stream", "expected"),
    [
        # Mass, standard unit t
        ("100", "t", S.COAL_QUANTITY, "100"),
        ("1500", "kg", S.COAL_QUANTITY, "1.5"),
        ("10", "quintal", S.PETCOKE_QUANTITY, "1"),
        ("0.25", "Lakh t", S.OPC_PRODUCTION, "25000"),
        # Electricity, standard unit kWh
        ("2.5", "MWh", S.CPP_GENERATION, "2500"),
        ("1", "GWh", S.WHRS_GENERATION, "1000000"),
        ("2", "MU", S.GRID_ELECTRICITY, "2000000"),
        ("3", "Million kWh", S.POWER_EXPORT, "3000000"),
        # Calorific value per kg, standard unit kcal/kg
        ("5000", "kcal/kg", S.COAL_GCV, "5000"),
        ("4.184", "MJ/kg", S.PETCOKE_GCV, "1000"),
        ("4.184", "GJ/t", S.COAL_GCV, "1000"),
        ("4.184", "kJ/kg", S.FO_GCV, "1"),
        ("7", "cal/g", S.HSD_GCV, "7"),
        # Liquid volume, standard unit kL
        ("2500", "L", S.HSD_QUANTITY, "2.5"),
        ("4", "kL", S.HSD_QUANTITY, "4"),
        # Gas, standard unit Million SCM and kcal/SCM
        ("2500000", "SCM", S.NATURAL_GAS_QUANTITY, "2.5"),
        ("5", "Lakh SCM", S.NATURAL_GAS_QUANTITY, "0.5"),
        ("8000", "kcal/SCM", S.NATURAL_GAS_GCV, "8000"),
        ("8.368", "MJ/SCM", S.NATURAL_GAS_GCV, "2000"),
        # CO2
        ("12.5", "tCO2e", S.CALCINATION_CO2, "12.5"),
        ("12.5", "t CO2", S.RAW_MEAL_CALCINATION, "12.5"),
    ],
)
def test_convert_to_standard_unit(value: str, unit: str, stream: S, expected: str) -> None:
    assert convert(D(value), unit, stream) == D(expected)


def test_convert_zero_and_negative_values() -> None:
    assert convert(D("0"), "Lakh t", S.COAL_QUANTITY) == D("0")
    assert convert(D("-2"), "kg", S.COAL_QUANTITY) == D("-0.002")


@pytest.mark.parametrize(
    ("unit", "stream"),
    [
        ("kL", S.COAL_QUANTITY),  # volume against a mass stream: no density is invented (D12)
        ("L", S.FO_QUANTITY),
        ("t", S.HSD_QUANTITY),  # mass against a volume stream
        ("kg", S.NATURAL_GAS_QUANTITY),
        ("kWh", S.COAL_QUANTITY),
        ("t", S.GRID_ELECTRICITY),
        ("t", S.COAL_GCV),
        ("kcal/kg", S.NATURAL_GAS_GCV),  # per kg against per SCM
        ("t", S.CALCINATION_CO2),  # plain tonnes are not tCO2e
        ("furlongs", S.COAL_QUANTITY),  # unknown unit
        ("", S.COAL_QUANTITY),
    ],
)
def test_convert_incompatible_or_unknown_unit_is_none(unit: str, stream: S) -> None:
    assert convert(D("10"), unit, stream) is None


def test_convert_non_finite_is_none() -> None:
    assert convert(D("NaN"), "t", S.COAL_QUANTITY) is None
    assert convert(D("Infinity"), "t", S.COAL_QUANTITY) is None


def test_convert_accepts_non_decimal_value() -> None:
    assert convert(2, "kg", S.COAL_QUANTITY) == D("0.002")  # type: ignore[arg-type]


def test_convert_round_trip_through_gj_per_tonne_is_stable() -> None:
    a = convert(D("25"), "MJ/kg", S.COAL_GCV)
    b = convert(D("25"), "GJ/t", S.COAL_GCV)
    assert a == b


# ---------------------------------------------------------------------------
# STANDARD_UNIT
# ---------------------------------------------------------------------------


def test_standard_unit_has_an_entry_for_every_stream() -> None:
    assert set(STANDARD_UNIT) == set(S)
    assert len(STANDARD_UNIT) == 25


def test_standard_unit_is_never_a_blanket_tonne_default() -> None:
    # The old code defaulted every stream to t. Only mass streams are in t.
    assert STANDARD_UNIT[S.COAL_GCV] == "kcal/kg"
    assert STANDARD_UNIT[S.GRID_ELECTRICITY] == "kWh"
    assert STANDARD_UNIT[S.HSD_QUANTITY] == "kL"
    assert STANDARD_UNIT[S.NATURAL_GAS_QUANTITY] == "Million SCM"
    assert STANDARD_UNIT[S.NATURAL_GAS_GCV] == "kcal/SCM"
    assert STANDARD_UNIT[S.CALCINATION_CO2] == "tCO2e"
    assert {u for u in STANDARD_UNIT.values()} > {"t"}
    assert len(set(STANDARD_UNIT.values())) > 1


def test_every_standard_unit_is_a_recognized_unit() -> None:
    for stream, unit in STANDARD_UNIT.items():
        assert parse_unit(unit) is not None, (stream, unit)
        # Converting from the standard unit to itself is the identity.
        assert convert(D("7.5"), unit, stream) == D("7.5")
