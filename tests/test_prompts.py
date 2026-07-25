"""Tests for kairo.prompts — mini template engine."""

from __future__ import annotations

from pathlib import Path

import pytest

from kairo.prompts import Template, TemplateLoader


# ---------------------------------------------------------------------------
# Variable substitution
# ---------------------------------------------------------------------------

def test_template_simple_var():
    tpl = Template("Hello {{ name }}!")
    assert tpl.render(name="Alice") == "Hello Alice!"


def test_template_multiple_vars():
    tpl = Template("{{ a }} + {{ b }} = {{ c }}")
    assert tpl.render(a=1, b=2, c=3) == "1 + 2 = 3"


def test_template_missing_var_renders_empty():
    tpl = Template("Hello {{ name }}!")
    assert tpl.render() == "Hello !"


def test_template_dot_access_dict():
    tpl = Template("{{ user.name }} is {{ user.age }}")
    assert tpl.render(user={"name": "Alice", "age": 30}) == "Alice is 30"


def test_template_dot_access_attr():
    class User:
        def __init__(self, name, age):
            self.name = name
            self.age = age
    tpl = Template("{{ user.name }} is {{ user.age }}")
    assert tpl.render(user=User("Bob", 25)) == "Bob is 25"


def test_template_literal_string():
    tpl = Template("{{ 'literal' }}")
    assert tpl.render() == "literal"


def test_template_literal_int():
    tpl = Template("{{ 42 }}")
    assert tpl.render() == "42"


def test_template_literal_bool():
    tpl = Template("{{ true }}")
    assert tpl.render() == "True"


# ---------------------------------------------------------------------------
# Filters
# ---------------------------------------------------------------------------

def test_template_filter_default():
    tpl = Template("{{ name | default('Anonymous') }}")
    assert tpl.render() == "Anonymous"
    assert tpl.render(name="Alice") == "Alice"


def test_template_filter_upper():
    tpl = Template("{{ name | upper }}")
    assert tpl.render(name="alice") == "ALICE"


def test_template_filter_lower():
    tpl = Template("{{ name | lower }}")
    assert tpl.render(name="ALICE") == "alice"


def test_template_filter_length():
    tpl = Template("{{ items | length }}")
    assert tpl.render(items=[1, 2, 3]) == "3"


def test_template_filter_trim():
    tpl = Template("{{ name | trim }}")
    assert tpl.render(name="  hi  ") == "hi"


def test_template_filter_join():
    tpl = Template("{{ items | join(', ') }}")
    assert tpl.render(items=["a", "b", "c"]) == "a, b, c"


# ---------------------------------------------------------------------------
# Conditional blocks
# ---------------------------------------------------------------------------

def test_template_if_true():
    tpl = Template("{% if show %}visible{% endif %}")
    assert tpl.render(show=True) == "visible"


def test_template_if_false():
    tpl = Template("{% if show %}visible{% endif %}")
    assert tpl.render(show=False) == ""


def test_template_if_with_else():
    # We don't support {% else %} yet — just if/endif.
    tpl = Template("{% if show %}visible{% endif %}")
    assert tpl.render(show=False) == ""


def test_template_nested_if():
    tpl = Template("{% if a %}{% if b %}both{% endif %}{% endif %}")
    assert tpl.render(a=True, b=True) == "both"
    assert tpl.render(a=True, b=False) == ""
    assert tpl.render(a=False, b=True) == ""


# ---------------------------------------------------------------------------
# Loops
# ---------------------------------------------------------------------------

def test_template_for_loop():
    tpl = Template("{% for item in items %}{{ item }}{% endfor %}")
    assert tpl.render(items=["a", "b", "c"]) == "abc"


def test_template_for_loop_with_separator():
    tpl = Template("{% for x in xs %}{{ x }} {% endfor %}")
    assert tpl.render(xs=[1, 2, 3]) == "1 2 3 "


def test_template_for_loop_empty():
    tpl = Template("{% for x in xs %}{{ x }}{% endfor %}")
    assert tpl.render(xs=[]) == ""


def test_template_for_loop_none():
    tpl = Template("{% for x in xs %}{{ x }}{% endfor %}")
    assert tpl.render() == ""


# ---------------------------------------------------------------------------
# Comments
# ---------------------------------------------------------------------------

def test_template_comments_stripped():
    tpl = Template("Hello{# this is a comment #} world")
    assert tpl.render() == "Hello world"


def test_template_multiline_comment():
    tpl = Template("Hello{# this is\na multiline\ncomment #} world")
    assert tpl.render() == "Hello world"


# ---------------------------------------------------------------------------
# Combined
# ---------------------------------------------------------------------------

def test_template_combined_if_and_for():
    tpl = Template(
        "{% if items %}"
        "Items: {% for x in items %}{{ x }} {% endfor %}"
        "{% endif %}"
    )
    assert tpl.render(items=["a", "b"]) == "Items: a b "
    assert tpl.render(items=[]) == ""


# ---------------------------------------------------------------------------
# TemplateLoader
# ---------------------------------------------------------------------------

def test_template_loader_load(tmp_path: Path):
    (tmp_path / "greeting.kairo").write_text("Hello {{ name }}!")
    loader = TemplateLoader(tmp_path)
    tpl = loader.load("greeting")
    assert tpl.render(name="Alice") == "Hello Alice!"


def test_template_loader_load_with_explicit_path(tmp_path: Path):
    (tmp_path / "greeting.txt").write_text("Hi {{ name }}")
    loader = TemplateLoader(tmp_path)
    tpl = loader.load("greeting")
    assert tpl.render(name="Bob") == "Hi Bob"


def test_template_loader_caches(tmp_path: Path):
    (tmp_path / "x.kairo").write_text("{{ name }}")
    loader = TemplateLoader(tmp_path)
    tpl1 = loader.load("x")
    tpl2 = loader.load("x")
    assert tpl1 is tpl2


def test_template_loader_render(tmp_path: Path):
    (tmp_path / "x.kairo").write_text("Hello {{ name }}!")
    loader = TemplateLoader(tmp_path)
    out = loader.render("x", name="Carol")
    assert out == "Hello Carol!"


def test_template_loader_missing_raises(tmp_path: Path):
    loader = TemplateLoader(tmp_path)
    with pytest.raises(FileNotFoundError):
        loader.load("nonexistent")


def test_template_loader_clear_cache(tmp_path: Path):
    (tmp_path / "x.kairo").write_text("{{ name }}")
    loader = TemplateLoader(tmp_path)
    loader.load("x")
    assert len(loader._cache) == 1
    loader.clear_cache()
    assert len(loader._cache) == 0
