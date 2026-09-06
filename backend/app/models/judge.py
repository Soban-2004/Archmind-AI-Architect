"""
Output schema for the judge pass (services/interview.py): a second,
independent model reviewing the architect's proposed architecture for
structural correctness before it's accepted — never re-deriving or
redesigning it, only flagging problems in what's already there. Kept
separate from InterviewTurnOutput because a judge never emits mutation
commands; it only ever emits a verdict.
"""
from typing import Literal

from pydantic import BaseModel, Field


class JudgeIssue(BaseModel):
    severity: Literal["blocking", "minor"]
    description: str


class JudgeVerdict(BaseModel):
    approved: bool
    issues: list[JudgeIssue] = Field(default_factory=list)
