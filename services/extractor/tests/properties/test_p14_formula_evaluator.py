"""Property 14: Formula evaluator agrees with a reference.

Feature: industrial-extractor, Property 14: Formula evaluator agrees with a reference.

For any expression tree over the supported operators, functions and cell references,
including cross-sheet references, printing it to formula text and evaluating it gives the
same result as a tree-walking reference. For any formula that uses an unsupported function
or an unresolved reference, the result is no value and a warning names the cell.

The reference below walks the generated tree itself. It never sees the formula text, so a
disagreement can only come from the tokenizer, the parser (precedence, associativity,
quoting, unary and percent handling) or the evaluator.

**Validates: Requirements 6.6, 6.7, 6.8, 6.9**
"""

from __future__ import annotations

import ast
import inspect
import io
import math
import re
from dataclasses import dataclass
from decimal import Context, Decimal, DivisionByZero, InvalidOperation, Overflow, localcontext
from fractions import Fraction
from typing import Any

import openpyxl
import pytest
from hypothesis import HealthCheck, assume, given, settings
from hypothesis import strategies as st

from services.extractor import workbook as workbook_module
from services.extractor.tests.factories import decimals
from services.extractor.workbook import (
    Cell,
    FormulaEvaluator,
    Sheet,
    Workbook,
    load_workbook_bytes,
)

PBT = settings(
    max_examples=150,
    deadline=None,
    suppress_health_check=[HealthCheck.too_slow, HealthCheck.data_too_large],
)

# ---------------------------------------------------------------------------
# The expression tree
# ---------------------------------------------------------------------------

SHEETS = ("Main", "Other Sheet", "It's")  # plain, with a space, with an apostrophe
TOP_SHEET, TOP_ROW, TOP_COL = "Main", 7, 2  # the cell that holds the formula under test
FORMULA_CELLS = (("Other Sheet", 5, 1), ("Other Sheet", 5, 2))  # formulas with no cache
_PLAIN_NAME = re.compile(r"^[A-Za-z_][A-Za-z0-9_]*$")
_PREC = {"+": 1, "-": 1, "*": 2, "/": 2, "^": 3}


@dataclass(frozen=True)
class Num:
    coef: int
    exp: int
    sci: bool = False

    @property
    def value(self) -> Decimal:
        return Decimal(f"{self.coef}E{self.exp}")


@dataclass(frozen=True)
class Ref:
    sheet: str | None
    row: int
    col: int
    abs_col: bool = False
    abs_row: bool = False
    lower: bool = False
    quote: bool = False
    fold: bool = False


@dataclass(frozen=True)
class Range:
    first: Ref
    second: Ref


@dataclass(frozen=True)
class Unary:
    op: str
    operand: Any


@dataclass(frozen=True)
class Percent:
    operand: Any


@dataclass(frozen=True)
class Binary:
    op: str
    left: Any
    right: Any
    spaced: bool = False


@dataclass(frozen=True)
class Paren:
    operand: Any


@dataclass(frozen=True)
class Call:
    name: str
    args: tuple[Any, ...]
    lower: bool = False
    spaced: bool = False


@dataclass(frozen=True)
class Raw:
    """Formula text written as is: an unsupported function or an unresolved reference."""

    text: str


# ---------------------------------------------------------------------------
# Printing a tree to formula text
# ---------------------------------------------------------------------------


def _col_letters(col: int) -> str:
    letters = ""
    while col > 0:
        col, rem = divmod(col - 1, 26)
        letters = chr(ord("A") + rem) + letters
    return letters


def _sheet_prefix(ref: Ref) -> str:
    if ref.sheet is None:
        return ""
    name = ref.sheet.lower() if ref.fold else ref.sheet
    if ref.quote or not _PLAIN_NAME.match(name):
        return "'" + name.replace("'", "''") + "'!"
    return name + "!"


def _ref_text(ref: Ref, *, with_sheet: bool = True) -> str:
    letters = _col_letters(ref.col)
    letters = letters.lower() if ref.lower else letters
    body = f"{'$' if ref.abs_col else ''}{letters}{'$' if ref.abs_row else ''}{ref.row}"
    return (_sheet_prefix(ref) if with_sheet else "") + body


def _num_text(num: Num) -> str:
    return f"{num.coef}E{num.exp:+d}" if num.sci else format(num.value, "f")


def to_text(node: Any) -> str:
    """Print ``node`` with only the parentheses that precedence needs, plus any ``Paren``."""
    if isinstance(node, Num):
        return _num_text(node)
    if isinstance(node, Ref):
        return _ref_text(node)
    if isinstance(node, Range):
        return _ref_text(node.first) + ":" + _ref_text(node.second)
    if isinstance(node, Raw):
        return "(" + node.text + ")"
    if isinstance(node, Paren):
        return "(" + to_text(node.operand) + ")"
    if isinstance(node, Unary):
        inner = to_text(node.operand)
        if isinstance(node.operand, Binary):
            inner = f"({inner})"
        return node.op + inner
    if isinstance(node, Percent):
        inner = to_text(node.operand)
        if isinstance(node.operand, (Binary, Unary)):
            inner = f"({inner})"
        return inner + "%"
    if isinstance(node, Binary):
        prec = _PREC[node.op]
        left, right = to_text(node.left), to_text(node.right)
        if isinstance(node.left, Binary) and _PREC[node.left.op] < prec:
            left = f"({left})"
        if isinstance(node.right, Binary) and _PREC[node.right.op] <= prec:
            right = f"({right})"
        return f"{left} {node.op} {right}" if node.spaced else f"{left}{node.op}{right}"
    if isinstance(node, Call):
        name = node.name.lower() if node.lower else node.name
        return f"{name}({(', ' if node.spaced else ',').join(to_text(a) for a in node.args)})"
    raise TypeError(node)


# ---------------------------------------------------------------------------
# The reference: a tree walker that never sees formula text
# ---------------------------------------------------------------------------

CTX = Context(
    prec=34,
    Emin=-999999,
    Emax=999999,
    traps=[InvalidOperation, DivisionByZero, Overflow],
)


class RefError(Exception):
    """The reference says this formula has no numeric value."""


@dataclass
class World:
    """Cell values by sheet, and the formula trees of the cells that have no cached value."""

    values: dict[str, dict[tuple[int, int], Decimal | str]]
    formulas: dict[tuple[str, int, int], Any]


def _unwrap(node: Any) -> Any:
    while isinstance(node, Paren):
        node = node.operand
    return node


class Reference:
    def __init__(self, world: World) -> None:
        self._world = world
        self._by_fold = {name.casefold(): name for name in SHEETS}

    def canon(self, sheet: str | None, current: str) -> str:
        name = self._by_fold.get((current if sheet is None else sheet).casefold())
        if name is None:
            raise RefError("sheet not found")
        return name

    def scalar(self, sheet: str, row: int, col: int) -> Decimal | str | None:
        if (sheet, row, col) in self._world.formulas:
            return self.ev(self._world.formulas[(sheet, row, col)], sheet)
        return self._world.values.get(sheet, {}).get((row, col))

    def ev(self, node: Any, cur: str) -> Decimal:
        if isinstance(node, Num):
            return node.value
        if isinstance(node, Paren):
            return self.ev(node.operand, cur)
        if isinstance(node, Ref):
            value = self.scalar(self.canon(node.sheet, cur), node.row, node.col)
            if value is None:
                return Decimal(0)
            if isinstance(value, str):
                raise RefError("text operand")
            return value
        if isinstance(node, Unary):
            inner = self.ev(node.operand, cur)
            return -inner if node.op == "-" else inner
        if isinstance(node, Percent):
            return self.ev(node.operand, cur) / 100
        if isinstance(node, Binary):
            return self._binary(node.op, self.ev(node.left, cur), self.ev(node.right, cur))
        if isinstance(node, Call):
            return self._call(node, cur)
        raise RefError("not a number")

    @staticmethod
    def _binary(op: str, a: Decimal, b: Decimal) -> Decimal:
        if op == "+":
            return a + b
        if op == "-":
            return a - b
        if op == "*":
            return a * b
        if op == "/":
            if b == 0:
                raise RefError("division by zero")
            return a / b
        if a == 0:
            if b == 0 or b < 0:
                raise RefError("0 to a non-positive power")
            return Decimal(0)
        if a < 0 and b != b.to_integral_value():
            raise RefError("negative base with a fractional exponent")
        return a**b

    def _numbers(self, arg: Any, cur: str) -> list[Decimal]:
        arg = _unwrap(arg)
        if isinstance(arg, Range):
            sheet = self.canon(arg.first.sheet, cur)
            lo_r, hi_r = sorted((arg.first.row, arg.second.row))
            lo_c, hi_c = sorted((arg.first.col, arg.second.col))
            found = []
            for r in range(lo_r, hi_r + 1):
                for c in range(lo_c, hi_c + 1):
                    value = self.scalar(sheet, r, c)
                    if isinstance(value, Decimal):
                        found.append(value)
            return found
        if isinstance(arg, Ref):
            value = self.scalar(self.canon(arg.sheet, cur), arg.row, arg.col)
            return [value] if isinstance(value, Decimal) else []
        return [self.ev(arg, cur)]

    def _call(self, node: Call, cur: str) -> Decimal:
        if node.name in ("SUM", "MIN", "MAX"):
            values: list[Decimal] = []
            for arg in node.args:
                values.extend(self._numbers(arg, cur))
            if node.name == "SUM":
                total = Decimal(0)
                for v in values:
                    total += v
                return total
            if not values:
                return Decimal(0)
            return min(values) if node.name == "MIN" else max(values)
        if node.name == "ABS":
            return abs(self.ev(node.args[0], cur))
        return _round_half_away_from_zero(self.ev(node.args[0], cur), self.ev(node.args[1], cur))


def _round_half_away_from_zero(x: Decimal, digits: Decimal) -> Decimal:
    """Excel ROUND by exact rational arithmetic, with ``digits`` truncated to an integer."""
    n = int(digits)
    scaled = Fraction(x) * Fraction(10) ** n
    magnitude = math.floor(abs(scaled) + Fraction(1, 2))
    return Decimal(-magnitude if scaled < 0 else magnitude).scaleb(-n)


def reference_value(world: World, tree: Any) -> Decimal | None:
    """The tree's value, or ``None`` when the reference finds no numeric value."""
    try:
        with localcontext(CTX):
            return Reference(world).ev(tree, TOP_SHEET)
    except (RefError, ArithmeticError):
        return None


# ---------------------------------------------------------------------------
# Strategies
# ---------------------------------------------------------------------------

_number = st.builds(
    Num,
    coef=st.integers(min_value=0, max_value=999_999),
    exp=st.integers(min_value=-3, max_value=3),
    sci=st.booleans(),
)

# Exponents stay small so ``^`` cannot overflow. A fractional exponent on a negative base
# is an error in both the reference and the evaluator, which is part of what is compared.
_exponent = st.one_of(
    st.builds(Num, coef=st.integers(0, 3), exp=st.just(0), sci=st.booleans()),
    st.sampled_from([Num(5, -1), Num(15, -1), Num(25, -1)]),
    st.builds(Unary, op=st.just("-"), operand=st.builds(Num, coef=st.integers(1, 2), exp=st.just(0))),
    st.builds(Paren, operand=st.builds(Num, coef=st.integers(0, 3), exp=st.just(0))),
)

_round_digits = st.one_of(
    st.builds(Num, coef=st.integers(0, 4), exp=st.just(0)),
    st.builds(Unary, op=st.just("-"), operand=st.builds(Num, coef=st.integers(1, 2), exp=st.just(0))),
)


@st.composite
def refs(draw: st.DrawFn, max_row: int = 5) -> Ref:
    return Ref(
        sheet=draw(st.sampled_from([None, None, *SHEETS])),
        row=draw(st.integers(min_value=1, max_value=max_row)),
        col=draw(st.sampled_from([1, 2, 3, 3, 4, 28])),
        abs_col=draw(st.booleans()),
        abs_row=draw(st.booleans()),
        lower=draw(st.booleans()),
        quote=draw(st.booleans()),
        fold=draw(st.booleans()),
    )


@st.composite
def ranges(draw: st.DrawFn) -> Range:
    first = draw(refs(max_row=3))
    other = draw(refs(max_row=3))
    # The second end names the same sheet as the first, or none. A range never changes sheet.
    repeat = first.sheet is not None and draw(st.booleans())
    second = Ref(
        sheet=first.sheet if repeat else None,
        row=other.row,
        col=other.col,
        abs_col=other.abs_col,
        abs_row=other.abs_row,
        lower=other.lower,
        quote=first.quote,
        fold=first.fold,
    )
    return Range(first, second)


def exprs(max_row: int = 5) -> st.SearchStrategy[Any]:
    """Expression trees over numbers, cell references and every supported operator."""
    leaf = st.one_of(_number, refs(max_row=max_row))

    def extend(children: st.SearchStrategy[Any]) -> st.SearchStrategy[Any]:
        aggregate = st.builds(
            Call,
            name=st.sampled_from(["SUM", "MIN", "MAX"]),
            args=st.lists(st.one_of(children, ranges()), min_size=1, max_size=3).map(tuple),
            lower=st.booleans(),
            spaced=st.booleans(),
        )
        absolute = st.builds(
            Call,
            name=st.just("ABS"),
            args=children.map(lambda c: (c,)),
            lower=st.booleans(),
            spaced=st.booleans(),
        )
        rounded = st.builds(
            Call,
            name=st.just("ROUND"),
            args=st.tuples(children, _round_digits),
            lower=st.booleans(),
            spaced=st.booleans(),
        )
        return st.one_of(
            st.builds(Unary, op=st.sampled_from(["+", "-"]), operand=children),
            st.builds(Percent, operand=children),
            st.builds(Paren, operand=children),
            st.builds(
                Binary,
                op=st.sampled_from(["+", "-", "*", "/"]),
                left=children,
                right=children,
                spaced=st.booleans(),
            ),
            st.builds(
                Binary, op=st.just("^"), left=children, right=_exponent, spaced=st.booleans()
            ),
            aggregate,
            absolute,
            rounded,
        )

    return st.recursive(leaf, extend, max_leaves=6)


_cell_value = st.one_of(
    *[
        st.builds(
            lambda d, neg: -d if neg else d,
            decimals(max_int_digits=5, max_places=3),
            st.booleans(),
        )
    ]
    * 10,
    st.none(),
    st.just("n/a"),
)


@st.composite
def worlds(draw: st.DrawFn) -> World:
    """Three sheets of data in A1:C3, and two formula cells with no cached value."""
    values: dict[str, dict[tuple[int, int], Decimal | str]] = {}
    for sheet in SHEETS:
        cells: dict[tuple[int, int], Decimal | str] = {}
        for row in range(1, 4):
            for col in range(1, 4):
                value = draw(_cell_value)
                if value is not None:
                    cells[(row, col)] = value
        values[sheet] = cells
    # Formula cells read data cells only, so no reference can be circular.
    formulas = {key: draw(exprs(max_row=3)) for key in FORMULA_CELLS}
    return World(values, formulas)


# Formula text that no evaluator may turn into a number. Each is written inside
# parentheses, so its meaning cannot change with the formula around it.
UNSUPPORTED_OR_UNRESOLVED = [
    "VLOOKUP(A1,B1:C2,2)",
    "AVERAGE(A1:A3)",
    "COUNT(A1:A3)",
    "IF(A1,1,2)",
    "SQRT(4)",
    "NOW()",
    "Missing!A1",
    "'No Such Sheet'!B2",
    "Main!A1:'Other Sheet'!B2",
    "foo",
    "TOTAL",
    "A0",
    "XFE1",
    "A1048577",
    "#REF!",
    "1=1",
    "1&2",
    '"text"',
    "SUM()",
    "ABS()",
    "ROUND(1)",
    "ABS(1,2)",
    "1 2",
    "1/0",
    "0^0",
]


@st.composite
def unevaluable_trees(draw: st.DrawFn) -> Any:
    """A valid tree combined with one piece of text that has no numeric value."""
    good = draw(exprs())
    bad = Raw(draw(st.sampled_from(UNSUPPORTED_OR_UNRESOLVED)))
    op = draw(st.sampled_from(["+", "-", "*", "/", "^"]))
    return draw(
        st.sampled_from(
            [
                Binary(op, good, bad),
                Binary(op, bad, good),
                Call("SUM", (good, bad)),
                Call("MAX", (bad, good)),
                Call("ABS", (bad,)),
                Call("ROUND", (bad, Num(2, 0))),
                Unary("-", bad),
                Percent(bad),
                Paren(Binary("+", good, bad)),
            ]
        )
    )


# ---------------------------------------------------------------------------
# Building workbooks from a world
# ---------------------------------------------------------------------------


def _formula_text(tree: Any, *, equals: bool = True, pad: bool = False) -> str:
    body = to_text(tree)
    if pad:
        body = f" {body} "
    return ("=" if equals else "") + body


def in_memory_workbook(world: World, top_text: str) -> Workbook:
    sheets: list[Sheet] = []
    for name in SHEETS:
        sheet = Sheet(name=name)
        for (row, col), value in sorted(world.values[name].items()):
            sheet.cells[(row, col)] = Cell(name, row, col, value)
        for key, tree in world.formulas.items():
            if key[0] == name:
                sheet.cells[(key[1], key[2])] = Cell(
                    name, key[1], key[2], None, _formula_text(tree)
                )
        if name == TOP_SHEET:
            sheet.cells[(TOP_ROW, TOP_COL)] = Cell(name, TOP_ROW, TOP_COL, None, top_text)
        sheets.append(sheet)
    return Workbook(sheets=sheets)


def xlsx_bytes(world: World, top_text: str) -> bytes:
    book = openpyxl.Workbook()
    book.remove(book.active)
    for name in SHEETS:
        ws = book.create_sheet(name)
        for (row, col), value in sorted(world.values[name].items()):
            ws.cell(row=row, column=col, value=value)
        for key, tree in world.formulas.items():
            if key[0] == name:
                ws.cell(row=key[1], column=key[2], value=_formula_text(tree))
        if name == TOP_SHEET:
            ws.cell(row=TOP_ROW, column=TOP_COL, value=top_text)
    buf = io.BytesIO()
    book.save(buf)
    return buf.getvalue()


_LABEL = f"{TOP_SHEET}!B{TOP_ROW}"


def assert_agrees(result: Any, expected: Decimal | None) -> None:
    if expected is None:
        assert result.value is None
        assert result.warning is not None and _LABEL in result.warning
        assert not result.evaluated
    else:
        assert result.value == expected
        assert result.warning is None
        assert result.evaluated


# ---------------------------------------------------------------------------
# Properties
# ---------------------------------------------------------------------------


@PBT
@given(world=worlds(), tree=exprs(), equals=st.booleans(), pad=st.booleans())
def test_printed_tree_evaluates_to_the_reference_value(
    world: World, tree: Any, equals: bool, pad: bool
) -> None:
    text = _formula_text(tree, equals=equals, pad=pad)
    expected = reference_value(world, tree)

    evaluator = FormulaEvaluator(in_memory_workbook(world, text))
    assert_agrees(evaluator.evaluate_cell(TOP_SHEET, TOP_ROW, TOP_COL), expected)

    # The same text evaluated directly, without a cell, gives the same value.
    direct = FormulaEvaluator(in_memory_workbook(world, text)).evaluate_formula(
        text, TOP_SHEET, TOP_ROW, TOP_COL
    )
    assert_agrees(direct, expected)


@settings(
    max_examples=40,
    deadline=None,
    suppress_health_check=[HealthCheck.too_slow, HealthCheck.data_too_large],
)
@given(world=worlds(), tree=exprs())
def test_formula_read_from_an_xlsx_file_evaluates_to_the_reference_value(
    world: World, tree: Any
) -> None:
    """A formula written by openpyxl has no cached value, so the evaluator must run it."""
    loaded = load_workbook_bytes(xlsx_bytes(world, _formula_text(tree)), "xlsx")
    cell = loaded.sheet(TOP_SHEET).cell(TOP_ROW, TOP_COL)  # type: ignore[union-attr]
    assert cell is not None and cell.value is None and cell.formula is not None
    result = FormulaEvaluator(loaded).evaluate_cell(TOP_SHEET, TOP_ROW, TOP_COL)
    assert_agrees(result, reference_value(world, tree))


@PBT
@given(world=worlds(), tree=exprs(), cached=decimals(max_int_digits=6, max_places=2))
def test_cached_value_wins_and_the_formula_runs_only_without_it(
    world: World, tree: Any, cached: Decimal
) -> None:
    expected = reference_value(world, tree)
    assume(expected is not None)
    book = in_memory_workbook(world, _formula_text(tree))
    book.sheet(TOP_SHEET).cells[(TOP_ROW, TOP_COL)].value = cached  # type: ignore[union-attr]

    evaluator = FormulaEvaluator(book)
    hit = evaluator.evaluate_cell(TOP_SHEET, TOP_ROW, TOP_COL)
    assert hit.value == cached and not hit.evaluated

    forced = evaluator.evaluate_cell(TOP_SHEET, TOP_ROW, TOP_COL, use_cache=False)
    assert forced.value == expected and forced.evaluated


@PBT
@given(world=worlds(), tree=unevaluable_trees(), equals=st.booleans())
def test_unsupported_function_or_unresolved_reference_gives_no_value_and_names_the_cell(
    world: World, tree: Any, equals: bool
) -> None:
    text = _formula_text(tree, equals=equals)
    result = FormulaEvaluator(in_memory_workbook(world, text)).evaluate_cell(
        TOP_SHEET, TOP_ROW, TOP_COL
    )
    assert_agrees(result, None)


# ---------------------------------------------------------------------------
# Examples: the cases the properties are built around, and Requirement 6.9
# ---------------------------------------------------------------------------


def _evaluate(formula: str, **data: Any) -> Any:
    sheet = Sheet(name="S")
    for ref, value in data.items():
        sheet.cells[(int(ref[1:]), ord(ref[0]) - ord("A") + 1)] = Cell(
            "S", int(ref[1:]), ord(ref[0]) - ord("A") + 1, value
        )
    return FormulaEvaluator(Workbook(sheets=[sheet])).evaluate_formula(formula, "S", 9, 9)


@pytest.mark.parametrize(
    ("formula", "expected"),
    [
        ("=-2^2", 4),  # unary sign binds tighter than ^
        ("=2^3^2", 64),  # ^ is left-associative
        ("=2+3*4", 14),
        ("=10-4-3", 3),
        ("=50%+1", Decimal("1.5")),
        ("=ROUND(2.5,0)", 3),  # ties go away from zero
        ("=ROUND(-2.5,0)", -3),
        ("=ROUND(1234,-2)", 1200),
        ("=SUM(A1:A3,10)", 16),
        ("=MIN(A1:A3)", 1),
        ("=MAX(A1,B1)", 3),
        ("=ABS(-A1-B1)", 4),
    ],
)
def test_known_formulas(formula: str, expected: Any) -> None:
    result = _evaluate(formula, A1=1, A2=2, A3=3, B1=3)
    assert result.value == expected and result.warning is None


@pytest.mark.parametrize(
    "formula",
    ["=VLOOKUP(A1,A1:B2,2)", "=Nowhere!A1+1", "=FOO+1", "=1/0", "=A1+B1", "=SUM(A1,", "=A1:A2"],
)
def test_unevaluable_formula_has_no_value_and_a_warning_that_names_the_cell(
    formula: str,
) -> None:
    result = _evaluate(formula, A1=1, B1="text")
    assert result.value is None
    assert result.warning is not None and "S!I9" in result.warning


@pytest.mark.parametrize(
    "formula",
    ["=__import__('os').system('echo x')", "=exec('x=1')", "=eval('1+1')", "=().__class__"],
)
def test_formula_text_is_never_run_as_code(formula: str) -> None:
    result = _evaluate(formula)
    assert result.value is None and result.warning is not None


def test_workbook_module_never_calls_eval_exec_or_equivalents() -> None:
    forbidden = {"eval", "exec", "compile", "__import__"}
    tree = ast.parse(inspect.getsource(workbook_module))
    called = {
        node.func.id
        for node in ast.walk(tree)
        if isinstance(node, ast.Call) and isinstance(node.func, ast.Name)
    }
    assert not called & forbidden
