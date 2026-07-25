"""Tests for kairo.agent.graph — state graph DAG orchestration."""

from __future__ import annotations

import pytest

from kairo.agent.graph import END, START, Checkpoint, CompiledGraph, GraphError, State, StateGraph


def test_state_merge_dict():
    s = State(data={"a": 1, "b": 2})
    s2 = s.merge({"b": 3, "c": 4})
    assert s2.data == {"a": 1, "b": 3, "c": 4}
    # Original is not mutated.
    assert s.data == {"a": 1, "b": 2}


def test_state_merge_none():
    s = State(data={"a": 1})
    assert s.merge(None) is s


def test_state_merge_state():
    s = State(data={"a": 1})
    s2 = s.merge(State(data={"b": 2}))
    assert s2.data == {"a": 1, "b": 2}


def test_graph_add_node():
    g = StateGraph()
    g.add_node("a", lambda s: {"ran": "a"})
    assert "a" in g._nodes


def test_graph_add_node_duplicate_raises():
    g = StateGraph()
    g.add_node("a", lambda s: None)
    with pytest.raises(GraphError):
        g.add_node("a", lambda s: None)


def test_graph_add_node_reserved_name_raises():
    g = StateGraph()
    with pytest.raises(GraphError):
        g.add_node(START, lambda s: None)
    with pytest.raises(GraphError):
        g.add_node(END, lambda s: None)


def test_graph_set_entry_point():
    g = StateGraph()
    g.add_node("a", lambda s: None)
    g.add_node("b", lambda s: None)
    g.set_entry_point("b")
    assert g._entry == "b"


def test_graph_set_entry_point_unknown_raises():
    g = StateGraph()
    with pytest.raises(GraphError):
        g.set_entry_point("nope")


def test_graph_add_edge():
    g = StateGraph()
    g.add_node("a", lambda s: None)
    g.add_node("b", lambda s: None)
    g.add_edge("a", "b")
    assert g._edges["a"] == "b"


def test_graph_add_edge_to_end():
    g = StateGraph()
    g.add_node("a", lambda s: None)
    g.add_edge("a", END)
    assert g._edges["a"] == END


def test_graph_add_edge_unknown_from_raises():
    g = StateGraph()
    g.add_node("a", lambda s: None)
    with pytest.raises(GraphError):
        g.add_edge("nope", "a")


def test_graph_add_conditional_edge():
    g = StateGraph()
    g.add_node("a", lambda s: None)
    g.add_node("b", lambda s: None)
    g.add_node("c", lambda s: None)
    g.add_conditional_edge("a", lambda s: "b" if s.data.get("x") else "c")
    assert "a" in g._cond_edges


def test_graph_plain_and_conditional_edge_conflict():
    g = StateGraph()
    g.add_node("a", lambda s: None)
    g.add_node("b", lambda s: None)
    g.add_edge("a", "b")
    with pytest.raises(GraphError):
        g.add_conditional_edge("a", lambda s: "b")


def test_compile_no_nodes_raises():
    g = StateGraph()
    with pytest.raises(GraphError):
        g.compile()


def test_run_simple_graph():
    g = StateGraph()
    g.add_node("a", lambda s: {"step": "a"})
    g.add_node("b", lambda s: {"step": "b"})
    g.add_edge("a", "b")
    g.add_edge("b", END)
    compiled = g.compile()
    final = compiled.run(State())
    assert final.data["step"] == "b"
    assert len(compiled.checkpoints) == 2


def test_run_conditional_graph():
    g = StateGraph()
    g.add_node("a", lambda s: {"x": 1})
    g.add_node("b", lambda s: {"branch": "b"})
    g.add_node("c", lambda s: {"branch": "c"})
    g.add_conditional_edge("a", lambda s: "b" if s.data.get("x") == 1 else "c")
    g.add_edge("b", END)
    g.add_edge("c", END)
    compiled = g.compile()
    final = compiled.run(State())
    assert final.data["branch"] == "b"


def test_run_loop_until_condition():
    g = StateGraph()
    counter = {"n": 0}
    def increment(s):
        counter["n"] += 1
        return {"n": counter["n"]}
    def should_continue(s):
        return END if s.data.get("n", 0) >= 3 else "loop"
    g.add_node("loop", increment)
    g.set_entry_point("loop")
    g.add_conditional_edge("loop", should_continue)
    compiled = g.compile()
    final = compiled.run(State())
    assert final.data["n"] == 3
    assert len(compiled.checkpoints) == 3


def test_run_max_steps():
    g = StateGraph()
    g.add_node("loop", lambda s: {})
    g.set_entry_point("loop")
    g.add_edge("loop", "loop")  # infinite loop
    compiled = g.compile()
    final = compiled.run(State(), max_steps=5)
    # Should have hit max_steps.
    assert len(compiled.checkpoints) == 5


def test_run_terminates_at_no_outgoing_edge():
    g = StateGraph()
    g.add_node("a", lambda s: {"x": 1})
    # No outgoing edge from "a" — run should terminate.
    compiled = g.compile()
    final = compiled.run(State())
    assert final.data["x"] == 1


def test_checkpoint_to_from_dict():
    cp = Checkpoint(node_name="a", state=State(data={"x": 1}))
    d = cp.to_dict()
    cp2 = Checkpoint.from_dict(d)
    assert cp2.node_name == "a"
    assert cp2.state.data == {"x": 1}


def test_save_and_load_checkpoints(tmp_path):
    g = StateGraph()
    g.add_node("a", lambda s: {"x": 1})
    g.add_edge("a", END)
    compiled = g.compile()
    compiled.run(State())
    p = tmp_path / "cks.json"
    compiled.save_checkpoints(p)
    loaded = CompiledGraph.load_checkpoints(p)
    assert len(loaded) == 1
    assert loaded[0].node_name == "a"
