"""
Analyzer orchestration (spec §6 Phase 4). score_architecture is a pure
function — same state + same RULES_VERSION always produces the same
Scorecard (spec §10's determinism check). explain_scorecard is the only
place an LLM touches the Analyzer, and it is structurally prevented from
re-deriving or adjusting the score: it only ever narrates an
already-computed Scorecard, and any `cited_rule_ids` it invents that don't
match a real fired rule are dropped before the answer is returned.
"""
from __future__ import annotations

from app.analyzer.cost import estimate_monthly_cost, parse_budget_ceiling
from app.analyzer.rules import ALL_RULES, RULES_VERSION
from app.llm.factory import get_llm_provider
from app.llm.prompts import build_scorecard_qa_prompt
from app.models.analysis import Category, CategoryScore, Scorecard, ScorecardAnswer
from app.models.state import ArchitectureState, ConstraintType


def score_architecture(state: ArchitectureState) -> Scorecard:
    findings_by_category: dict[Category, list] = {c: [] for c in Category}
    for rule_fn in ALL_RULES:
        for finding in rule_fn(state):
            findings_by_category[finding.category].append(finding)

    categories: list[CategoryScore] = []
    for cat in Category:
        findings = findings_by_category[cat]
        penalty = sum(f.points for f in findings)
        score = max(0, 100 - penalty)
        categories.append(CategoryScore(category=cat, score=score, findings=findings))

    overall = round(sum(c.score for c in categories) / len(categories))

    estimated_cost, breakdown = (None, []) if not state.nodes else estimate_monthly_cost(state)
    budget_str = next((c.value for c in state.constraints if c.type == ConstraintType.budget_monthly_usd), None)
    budget_ceiling = parse_budget_ceiling(budget_str) if budget_str else None

    return Scorecard(
        rules_version=RULES_VERSION,
        overall_score=overall,
        categories=categories,
        estimated_monthly_cost_usd=estimated_cost,
        budget_monthly_usd=budget_ceiling,
        cost_breakdown=breakdown,
    )


async def explain_scorecard(state: ArchitectureState, scorecard: Scorecard, question: str) -> ScorecardAnswer:
    valid_rule_ids = {f.rule_id for f in scorecard.all_findings()}

    provider = get_llm_provider()
    prompt = build_scorecard_qa_prompt(state, scorecard)
    try:
        raw = await provider.structured_json(prompt, question, ScorecardAnswer)
    except Exception:
        return ScorecardAnswer(answer="Sorry, I couldn't generate an explanation right now.", cited_rule_ids=[])

    grounded_cites = [rid for rid in raw.cited_rule_ids if rid in valid_rule_ids]
    return ScorecardAnswer(answer=raw.answer, cited_rule_ids=grounded_cites)
