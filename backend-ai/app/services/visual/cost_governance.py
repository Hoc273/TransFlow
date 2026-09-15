"""Cost governance: token/image estimation, max frames, budget check, cache (requirement 4).

Centralizes max_frames, token estimation, budget enforcement and delegates to
frame_sampler.estimate_cost for consistency. Provides a single entry point
for the VLM gateway to fail-closed on budget.
"""
from __future__ import annotations

from dataclasses import dataclass
from typing import Optional

from app.services.visual.frame_sampler import estimate_cost as _estimate_cost
from app.services.provider_errors import ProviderErrorCode, ProviderValidation

# Verified provider vision pricing per 1K tokens (Aliyun Model Studio & OpenAI official):
# - qwen-vl-plus: $0.0012/1K input, $0.0024/1K output (~$0.0015 blended)
# - qwen-vl-max: $0.0028/1K tokens
# - gpt-4o-mini: $0.00015/1K input, $0.0006/1K output (~$0.00025 blended)
# - gpt-4o: $0.0025/1K input, $0.0100/1K output (~$0.0050 blended)
MODEL_PRICING_PER_1K: dict[str, float] = {
    "qwen-vl-plus": 0.0015,
    "qwen-vl-max": 0.0028,
    "gpt-4o-mini": 0.00025,
    "gpt-4o": 0.0050,
}
DEFAULT_VISION_PRICE_PER_1K = 0.0020


def resolve_model_price_per_1k(model: str | None) -> float:
    """Resolve price per 1K tokens by model name."""
    if not model:
        return DEFAULT_VISION_PRICE_PER_1K
    m = model.lower()
    for k, v in MODEL_PRICING_PER_1K.items():
        if k in m:
            return v
    return DEFAULT_VISION_PRICE_PER_1K


@dataclass(frozen=True)
class CostPolicy:
    max_frames: int = 12
    cost_per_image_tokens: int = 800
    max_total_image_tokens: int = 12000
    max_budget_usd: Optional[float] = None
    price_per_1k_tokens_usd: float = DEFAULT_VISION_PRICE_PER_1K


def check_budget(
    frame_count: int,
    policy: CostPolicy,
) -> dict:
    est = _estimate_cost(
        frame_count,
        cost_per_image_tokens=policy.cost_per_image_tokens,
        max_total_image_tokens=policy.max_total_image_tokens,
        max_frames=policy.max_frames,
        max_budget_usd=policy.max_budget_usd,
        price_per_1k_tokens_usd=policy.price_per_1k_tokens_usd,
    )
    if not est["within_budget"]:
        raise ProviderValidation(
            est["reason"] or "Visual cost budget exceeded",
            code=ProviderErrorCode.PROVIDER_QUOTA_EXCEEDED,
            capability="VISION",
        )
    return est


def estimate_tokens(
    frame_count: int,
    cost_per_image_tokens: int = 800,
) -> int:
    return frame_count * cost_per_image_tokens + 1000


def compute_actual_cost_usd(
    usage: dict | None,
    price_per_1k: float | None = None,
    model: str | None = None,
) -> float | None:
    """C3: provider+model+capability -> pricing lookup -> actual cost.

    If usage is None/empty -> actual_cost = None (do not assume = estimated).
    Otherwise actual = total_tokens / 1000 * resolved_price.
    """
    if not usage:
        return None
    total = int(usage.get("total_tokens", 0) or 0)
    if total <= 0:
        total = int(usage.get("prompt_tokens", 0) or 0) + int(usage.get("completion_tokens", 0) or 0)
    if total <= 0:
        return None

    if price_per_1k is None:
        effective_model = model or usage.get("model")
        price_per_1k = resolve_model_price_per_1k(effective_model)

    return round(total / 1000.0 * price_per_1k, 6)
