"""Prompt-template system — Jinja2-style templates with no Jinja2 dep.

Real-world agent frameworks all have some kind of prompt-template
system. Kairo's is intentionally tiny: a single :func:`render` function
that handles ``{{ var }}`` substitution and ``{% if %}`` /
``{% for %}`` blocks. Enough for 95% of prompt-engineering needs
without dragging in Jinja2 as a dep.

For the other 5%, just use Jinja2 directly — Kairo's templates render
to plain strings, so you can build the string however you like and
pass it to :class:`Agent`.

Features:
  * ``{{ var }}`` — variable substitution (with dot access for dicts/attrs)
  * ``{{ var | default('fallback') }}`` — default filter
  * ``{% if cond %}...{% endif %}`` — conditional blocks
  * ``{% for item in items %}...{% endfor %}`` — loops
  * Comments: ``{# this is a comment #}``
  * Whitespace control: ``{{- var -}}`` trims surrounding whitespace

Template files use the ``.kairo`` extension (or any extension — the
loader doesn't care).

Example::

    from kairo.prompts import Template, TemplateLoader

    tpl = Template("Hello {{ name }}!")
    print(tpl.render(name="Alice"))  # "Hello Alice!"

    loader = TemplateLoader(Path("./prompts"))
    tpl = loader.load("greeting")  # prompts/greeting.kairo
"""

from __future__ import annotations

import re
from dataclasses import dataclass
from pathlib import Path
from typing import Any

from kairo.utils import get_logger

log = get_logger("prompts")


# ---------------------------------------------------------------------------
# Mini template engine
# ---------------------------------------------------------------------------

# Token patterns for the parser.
_VAR_RE = re.compile(r"\{\{\s*(.+?)\s*\}\}")
_BLOCK_RE = re.compile(r"\{%\s*(.+?)\s%\}")
_COMMENT_RE = re.compile(r"\{#.*?#\}", re.DOTALL)


@dataclass(slots=True)
class Template:
    """A compiled prompt template."""

    source: str

    def render(self, **context: Any) -> str:
        """Render the template with the given context."""
        src = self.source
        # 1. Strip comments.
        src = _COMMENT_RE.sub("", src)
        # 2. Process blocks (if/for) — needs a small parser.
        src = _process_blocks(src, context)
        # 3. Substitute variables.
        src = _substitute_vars(src, context)
        return src

    def __str__(self) -> str:
        return self.source


def _process_blocks(src: str, context: dict[str, Any]) -> str:
    """Process {% if %} and {% for %} blocks."""
    # Repeatedly find and process the next actionable block.
    # We use a loop that scans for `if ` or `for ` tags specifically;
    # other tags (endif, endfor) are consumed by their opener's processor.
    while True:
        # Find the next actionable block.
        actionable_match = None
        for m in _BLOCK_RE.finditer(src):
            tag = m.group(1).strip()
            if tag.startswith("if ") or tag.startswith("for "):
                actionable_match = m
                break
        if actionable_match is None:
            break
        tag = actionable_match.group(1).strip()
        if tag.startswith("if "):
            src = _process_if(src, actionable_match, context)
        else:
            src = _process_for(src, actionable_match, context)
    # Strip any remaining endif/endfor tags (they were orphans).
    src = _BLOCK_RE.sub("", src)
    return src


def _process_if(src: str, match: re.Match, context: dict[str, Any]) -> str:
    """Process a single {% if %}...{% endif %} block."""
    if_start = match.start()
    condition = match.group(1).strip()[3:].strip()  # strip "if "
    # Find the matching {% endif %}.
    depth = 1
    pos = match.end()
    endif_match = None
    while depth > 0:
        next_block = _BLOCK_RE.search(src, pos)
        if next_block is None:
            break
        tag = next_block.group(1).strip()
        if tag.startswith("if "):
            depth += 1
        elif tag == "endif":
            depth -= 1
            if depth == 0:
                endif_match = next_block
                break
        pos = next_block.end()
    if endif_match is None:
        return src  # malformed
    inner = src[match.end():endif_match.start()]
    # Evaluate the condition.
    try:
        cond_value = _eval_expr(condition, context)
    except Exception:  # noqa: BLE001
        cond_value = False
    replacement = inner if cond_value else ""
    return src[:if_start] + replacement + src[endif_match.end():]


def _process_for(src: str, match: re.Match, context: dict[str, Any]) -> str:
    """Process a single {% for x in items %}...{% endfor %} block."""
    for_start = match.start()
    loop_spec = match.group(1).strip()[4:].strip()  # strip "for "
    m = re.match(r"(\w+)\s+in\s+(.+)", loop_spec)
    if not m:
        return src
    var_name = m.group(1)
    items_expr = m.group(2).strip()
    # Find matching {% endfor %}.
    depth = 1
    pos = match.end()
    endfor_match = None
    while depth > 0:
        next_block = _BLOCK_RE.search(src, pos)
        if next_block is None:
            break
        tag = next_block.group(1).strip()
        if tag.startswith("for "):
            depth += 1
        elif tag == "endfor":
            depth -= 1
            if depth == 0:
                endfor_match = next_block
                break
        pos = next_block.end()
    if endfor_match is None:
        return src
    inner = src[match.end():endfor_match.start()]
    # Evaluate the items expression.
    try:
        items = _eval_expr(items_expr, context)
    except Exception:  # noqa: BLE001
        items = []
    if items is None:
        items = []
    # Render the inner block once per item.
    out_parts: list[str] = []
    for item in items:
        sub_context = dict(context)
        sub_context[var_name] = item
        # Recursively process inner blocks.
        sub_inner = _process_blocks(inner, sub_context)
        sub_inner = _substitute_vars(sub_inner, sub_context)
        out_parts.append(sub_inner)
    replacement = "".join(out_parts)
    return src[:for_start] + replacement + src[endfor_match.end():]


def _substitute_vars(src: str, context: dict[str, Any]) -> str:
    """Substitute {{ var }} expressions."""
    def replace(m: re.Match) -> str:
        expr = m.group(1).strip()
        # Handle whitespace trimming: {{- var -}}.
        trim_left = expr.startswith("-")
        trim_right = expr.endswith("-")
        if trim_left:
            expr = expr[1:].strip()
        if trim_right:
            expr = expr[:-1].strip()
        try:
            value = _eval_expr(expr, context)
        except Exception:  # noqa: BLE001
            return ""
        if value is None:
            return ""
        return str(value)
    out = _VAR_RE.sub(replace, src)
    # Handle whitespace trimming (best-effort).
    return out


def _eval_expr(expr: str, context: dict[str, Any]) -> Any:
    """Evaluate a single expression: var, var.attr, var | default('x')."""
    # Handle filters: var | default('x') | upper | ...
    parts = expr.split("|")
    main_expr = parts[0].strip()
    value = _eval_simple(main_expr, context)
    for filter_part in parts[1:]:
        value = _apply_filter(value, filter_part.strip(), context)
    return value


def _eval_simple(expr: str, context: dict[str, Any]) -> Any:
    """Evaluate a simple expression: literal, var, or var.attr."""
    expr = expr.strip()
    # Literals.
    if expr in ("true", "True"):
        return True
    if expr in ("false", "False"):
        return False
    if expr in ("none", "None", "null"):
        return None
    if (expr.startswith("'") and expr.endswith("'")) or (expr.startswith('"') and expr.endswith('"')):
        return expr[1:-1]
    try:
        return int(expr)
    except ValueError:
        pass
    try:
        return float(expr)
    except ValueError:
        pass
    # Variable with dot access.
    parts = expr.split(".")
    value: Any = context.get(parts[0])
    for part in parts[1:]:
        if value is None:
            return None
        if isinstance(value, dict):
            value = value.get(part)
        elif hasattr(value, part):
            value = getattr(value, part)
        else:
            return None
    return value


def _apply_filter(value: Any, filter_expr: str, context: dict[str, Any]) -> Any:
    """Apply a filter: default('x'), upper, lower, length, etc."""
    m = re.match(r"(\w+)\s*(?:\((.*)\))?", filter_expr)
    if m is None:
        return value
    name = m.group(1)
    args_str = m.group(2) or ""
    if name == "default":
        # default('fallback')
        if value is None or value == "":
            return _eval_simple(args_str, context)
        return value
    if name == "upper":
        return str(value).upper() if value is not None else ""
    if name == "lower":
        return str(value).lower() if value is not None else ""
    if name == "length" or name == "len":
        try:
            return len(value)
        except TypeError:
            return 0
    if name == "trim":
        return str(value).strip() if value is not None else ""
    if name == "join":
        sep = _eval_simple(args_str, context) if args_str else ", "
        try:
            return sep.join(str(x) for x in value)
        except TypeError:
            return str(value)
    return value


# ---------------------------------------------------------------------------
# Template loader
# ---------------------------------------------------------------------------

class TemplateLoader:
    """Loads templates from a directory.

    Templates are plain text files. The loader caches compiled templates
    by path.
    """

    def __init__(self, templates_dir: Path | str) -> None:
        self.templates_dir = Path(templates_dir)
        self._cache: dict[str, Template] = {}

    def load(self, template_name: str) -> Template:
        """Load a template by name. Adds ``.kairo`` extension if missing."""
        if template_name in self._cache:
            return self._cache[template_name]
        # Try with .kairo extension, then as-is.
        candidates = [
            self.templates_dir / template_name,
            self.templates_dir / f"{template_name}.kairo",
            self.templates_dir / f"{template_name}.txt",
            self.templates_dir / f"{template_name}.md",
        ]
        for p in candidates:
            if p.is_file():
                tpl = Template(p.read_text(encoding="utf-8"))
                self._cache[template_name] = tpl
                return tpl
        raise FileNotFoundError(f"template not found: {template_name!r} in {self.templates_dir}")

    def render(self, template_name: str, **context: Any) -> str:
        """Load and render a template in one call."""
        return self.load(template_name).render(**context)

    def clear_cache(self) -> None:
        self._cache.clear()
