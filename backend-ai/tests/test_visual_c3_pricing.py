"""M17.1-C3 — Correct vision pricing tests.

Estimated vs actual distinction, usage null -> actual null.
"""
import pytest

from app.services.visual.cost_governance import CostPolicy, check_budget, compute_actual_cost_usd, estimate_tokens


def test_estimated_cost_12_frames():
    est = check_budget(12, CostPolicy(max_frames=12, cost_per_image_tokens=800, max_total_image_tokens=12000, price_per_1k_tokens_usd=0.005))
    assert est["estimated_image_tokens"] == 9600
    assert est["estimated_total_tokens"] == 10600
    assert est["estimated_cost_usd"] == pytest.approx(0.053, rel=1e-3)


def test_actual_cost_from_usage():
    usage = {"prompt_tokens": 9946, "completion_tokens": 925, "total_tokens": 10871, "provider": "openai_compatible", "model": "qwen-vl-plus"}
    actual = compute_actual_cost_usd(usage, price_per_1k=0.005)
    assert actual == pytest.approx(0.054355, rel=1e-6)


def test_actual_cost_null_when_no_usage():
    assert compute_actual_cost_usd(None) is None
    assert compute_actual_cost_usd({}) is None
    assert compute_actual_cost_usd({"total_tokens": 0}) is None


def test_estimated_vs_actual_distinction():
    # Estimated from policy before call
    est = check_budget(12, CostPolicy(max_frames=12, cost_per_image_tokens=800, max_total_image_tokens=12000, price_per_1k_tokens_usd=0.005))
    # Actual from provider usage after call (real may differ by small delta)
    usage = {"total_tokens": 10871}
    actual = compute_actual_cost_usd(usage, price_per_1k=0.005)
    assert est["estimated_cost_usd"] != actual  # 0.053 vs 0.054355
    assert actual is not None


def test_actual_cost_custom_pricing():
    usage = {"total_tokens": 10000}
    # Same tokens, different pricing
    assert compute_actual_cost_usd(usage, price_per_1k=0.005) == pytest.approx(0.05)
    assert compute_actual_cost_usd(usage, price_per_1k=0.01) == pytest.approx(0.1)


def test_estimate_tokens_helper():
    assert estimate_tokens(12, 800) == 10600
    assert estimate_tokens(0, 800) == 1000


def test_qwen_vl_plus_official_pricing_auto_lookup():
    usage = {"prompt_tokens": 1000, "completion_tokens": 1000, "total_tokens": 2000, "model": "qwen-vl-plus"}
    # 2000 tokens / 1000 * 0.0015 = 0.003 USD
    actual = compute_actual_cost_usd(usage, model="qwen-vl-plus")
    assert actual == pytest.approx(0.003, rel=1e-5)


@pytest.mark.asyncio
async def test_understand_visual_wires_actual_cost():
    from app.services.visual.vlm_gateway import understand_visual
    from app.schemas.visual_contract import VisualSamplingConfig, ProviderPayload

    provider = ProviderPayload(
        protocol="openai_compatible",
        base_url="http://localhost:8787/v1",
        api_key="",
        model="qwen-vl-plus",
        temperature=0.2,
        capabilities={"VISION"},
    )
    cfg = VisualSamplingConfig(max_frames=2, interval_ms=5000)
    # in mock mode, usage may be absent or mock; check that 'actual_cost_usd' key is present in cost dict
    res = await understand_visual(
        video_ref="test.mp4",
        video_url="",
        provider=provider,
        sampling_config=cfg,
        transcript=[],
        video_duration_ms=20000,
        mock_variant="MOCK_MODE",
    )
    assert "cost" in res
    assert "actual_cost_usd" in res["cost"]
