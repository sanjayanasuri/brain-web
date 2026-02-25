"""
Deterministic retrieval plans for each intent type.
Thin facade: delegates to services.retrieval_plans so existing imports keep working.
"""
from services.retrieval_plans import run_plan, _empty_result

__all__ = ["run_plan", "_empty_result"]
