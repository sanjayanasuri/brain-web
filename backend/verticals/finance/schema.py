"""
Schema definitions for Finance vertical.
"""
from typing import Literal

FinanceLens = Literal["fundamentals", "catalysts", "competition", "risks", "narrative"]

FINANCE_LENSES: list[FinanceLens] = ["fundamentals", "catalysts", "competition", "risks", "narrative"]
