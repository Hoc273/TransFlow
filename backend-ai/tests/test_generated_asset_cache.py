"""CEP Phase A2.1 — Generated Asset Cache tests (ADR-CEP, Q-M-TTS-09/10).

Covers the full acceptance matrix: key stability/canonicalization, adapter
descriptors (incl. fail-fast validation on cache hits), hit/miss + execution_info,
TTL-as-HEAD-refresh semantics, provenance-version invalidation, LRU eviction,
flush merge, single-flight concurrency, fail-open (disabled / no creds / ctor
error / runtime failure) and mock bypass.
"""
from __future__ import annotations

import asyncio
import json
import time
import unittest
from types import SimpleNamespace
from unittest.mock import patch

from app.core.config import settings
from app.schemas.contract import ProviderPayload, TtsRequest, TtsSegment
from app.services import generated_asset_cache as gac
from app.services.generated_asset_cache import (
    EXECUTION_INFO_REVISION,
    InMemoryGeneratedAssetCache,
    MinioGeneratedAssetCache,
    NoopGeneratedAssetCache,
    SingleFlight,
    build_cache_key,
    build_metadata,
    get_cache,
    set_cache_override,
)
from app.services.protocol.google_tts import GoogleSpeechAdapter
from app.services.protocol.dashscope_native import DashScopeNativeAdapter
from app.services.protocol.types import SynthesizeResult, TtsCacheDescriptor
from app.services.provider_errors import (
    ProviderErrorCode,
    ProviderValidation,
)
from app.services import tts_gateway
from app.services.tts_gateway import synthesize as gateway_synthesize

PROVENANCE_FIELDS = {
    "kind",
    "capability",
    "hash",
    "provider_identity",
    "provider_protocol",
    "model",
    "voice",
    "byte_size",
    "created_at",
    "last_access",
    "generator_version",
    "execution_info_revision",
    "content_type",
}


def _provider(protocol: str, base_url: str = "http://provider.test/v1") -> ProviderPayload:
    return ProviderPayload(
        protocol=protocol,  # type: ignore[arg-type]
        capabilities={"TTS"},
        base_url=base_url,
        api_key="sk-test",
        model="probe-model",
    )


def _request(provider: ProviderPayload, text: str = "Xin chào", voice: str = "Serena") -> TtsRequest:
    return TtsRequest(
        correlation_id="corr-1",
        media_job_id="job-1",
        voice_id=voice,
        segments=[TtsSegment(segment_id="s1", target_text=text)],
        provider=provider,
    )


def _synth_adapter(protocol: str, descriptor: TtsCacheDescriptor | None = None):
    calls = {"n": 0}

    async def fake_synthesize(provider, text, voice_id):
        calls["n"] += 1
        return SynthesizeResult(
            audio_bytes=f"audio-{text}".encode(),
            mime_type=descriptor.mime_type if descriptor else "audio/mpeg",
            metadata={"execution_info": {"provider": protocol, "voice": voice_id}},
        )

    def fake_descriptor(provider, voice_id):
        if descriptor is not None:
            return descriptor
        return TtsCacheDescriptor(resolved_model=provider.model, mime_type="audio/mpeg", extension="mp3")

    adapter = SimpleNamespace(
        synthesize=fake_synthesize,
        cache_descriptor=fake_descriptor,
        protocol=protocol,
        requires_api_key=True,
    )
    return adapter, calls


def _wav_descriptor(provider, voice_id: str) -> TtsCacheDescriptor:
    return DashScopeNativeAdapter().cache_descriptor(provider, voice_id)


class CacheKeyTest(unittest.TestCase):
    def test_stable_across_calls(self):
        provider = _provider("dashscope_native")
        desc = _wav_descriptor(provider, "Serena")
        a = build_cache_key(provider, desc, "Serena", "Xin chào")
        b = build_cache_key(provider, desc, "Serena", "Xin chào")
        self.assertEqual(a.hash, b.hash)
        self.assertEqual(a.provider_identity, b.provider_identity)
        self.assertEqual("wav", a.extension)
        self.assertEqual("audio/wav", a.mime_type)

    def test_different_text_different_key(self):
        provider = _provider("dashscope_native")
        desc = _wav_descriptor(provider, "Serena")
        a = build_cache_key(provider, desc, "Serena", "Xin chào")
        b = build_cache_key(provider, desc, "Serena", "Hello")
        self.assertNotEqual(a.hash, b.hash)

    def test_different_voice_different_key(self):
        provider = _provider("dashscope_native")
        a = build_cache_key(provider, _wav_descriptor(provider, "Serena"), "Serena", "t")
        b = build_cache_key(provider, _wav_descriptor(provider, "Ethan"), "Ethan", "t")
        self.assertNotEqual(a.hash, b.hash)

    def test_canonical_json_keeps_field_boundaries(self):
        # Concatenation would collide ("a"+"bc" == "ab"+"c"); the JSON array must not.
        provider = _provider("dashscope_native")
        desc = TtsCacheDescriptor(resolved_model="m", mime_type="audio/mpeg", extension="mp3")
        a = build_cache_key(provider, desc, "a", "bc")
        b = build_cache_key(provider, desc, "ab", "c")
        self.assertNotEqual(a.hash, b.hash)

    def test_base_url_normalized(self):
        raw = _provider("dashscope_native", base_url="HTTP://PROVIDER.TEST:9000/v1/")
        normalized = _provider("dashscope_native", base_url="http://provider.test:9000/v1")
        a = build_cache_key(raw, _wav_descriptor(raw, "Serena"), "Serena", "t")
        b = build_cache_key(normalized, _wav_descriptor(normalized, "Serena"), "Serena", "t")
        self.assertEqual(a.provider_identity, b.provider_identity)

    def test_different_endpoints_isolated(self):
        tenant_a = _provider("dashscope_native", base_url="http://provider-a.test/v1")
        tenant_b = _provider("dashscope_native", base_url="http://provider-b.test/v1")
        a = build_cache_key(tenant_a, _wav_descriptor(tenant_a, "Serena"), "Serena", "t")
        b = build_cache_key(tenant_b, _wav_descriptor(tenant_b, "Serena"), "Serena", "t")
        self.assertNotEqual(a.provider_identity, b.provider_identity)
        self.assertNotEqual(a.hash, b.hash)
        self.assertNotIn("provider-b", a.provider_identity)

    def test_object_key_path(self):
        provider = _provider("dashscope_native")
        material = build_cache_key(provider, _wav_descriptor(provider, "Serena"), "Serena", "t")
        cache = InMemoryGeneratedAssetCache(prefix="generated-assets/v1")
        self.assertEqual(
            cache.object_key(material),
            f"generated-assets/v1/tts/dashscope_native/Serena/{material.hash}.wav",
        )


class CacheDescriptorTest(unittest.IsolatedAsyncioTestCase):
    def test_base_tts_validation_fails_fast_for_unknown_voice(self):
        provider = _provider("google_speech")
        adapter = GoogleSpeechAdapter()
        with self.assertRaises(ProviderValidation) as ctx:
            adapter.cache_descriptor(provider, "not-a-real-voice")
        self.assertEqual(ProviderErrorCode.PROVIDER_TTS_VOICE_NOT_FOUND, ctx.exception.code)

    def test_default_descriptor_is_mp3_provider_model(self):
        provider = _provider("google_speech")
        desc = GoogleSpeechAdapter().cache_descriptor(provider, "vi-VN-Neural2-A")
        self.assertEqual("probe-model", desc.resolved_model)
        self.assertEqual("audio/mpeg", desc.mime_type)
        self.assertEqual("mp3", desc.extension)

    def test_dashscope_descriptor_is_wav_with_model_fallback(self):
        from app.services.protocol.dashscope_native import DashScopeNativeAdapter

        provider = _provider("dashscope_native")
        desc = DashScopeNativeAdapter().cache_descriptor(provider, "Serena")
        self.assertEqual("probe-model", desc.resolved_model)
        self.assertEqual("audio/wav", desc.mime_type)
        empty_model = _provider("dashscope_native").model_copy(update={"model": ""})
        self.assertEqual("qwen-omni-turbo", DashScopeNativeAdapter().cache_descriptor(empty_model, "Serena").resolved_model)


class MetadataTest(unittest.TestCase):
    def test_provenance_metadata_has_all_13_fields(self):
        provider = _provider("dashscope_native")
        material = build_cache_key(provider, _wav_descriptor(provider, "Serena"), "Serena", "t")
        meta = build_metadata(material, b"data", time.time())
        blob = json.loads(meta[gac._META_USER_KEY])
        self.assertEqual(PROVENANCE_FIELDS, set(blob))
        self.assertEqual("tts", blob["kind"])
        self.assertEqual("tts", blob["capability"])
        self.assertEqual(material.hash, blob["hash"])
        self.assertEqual(settings.app_version, blob["generator_version"])
        self.assertEqual(EXECUTION_INFO_REVISION, blob["execution_info_revision"])
        self.assertEqual(str(len(b"data")), blob["byte_size"])
        self.assertEqual("audio/wav", blob["content_type"])
        self.assertEqual(material.hash, meta[gac._META_HASH_KEY])


class InMemoryCacheTest(unittest.IsolatedAsyncioTestCase):
    def setUp(self):
        self.cache = InMemoryGeneratedAssetCache(
            cap_bytes=10_000, ttl_seconds=86400, prefix="generated-assets/v1"
        )
        self.provider = _provider("dashscope_native")
        self.material = build_cache_key(
            self.provider, _wav_descriptor(self.provider, "Serena"), "Serena", "Xin chào"
        )

    async def test_miss_then_hit(self):
        self.assertIsNone(await self.cache.get(self.material))
        await self.cache.put(self.material, b"audio-1")
        self.assertEqual(b"audio-1", await self.cache.get(self.material))
        self.assertTrue(await self.cache.exists(self.material))

    async def test_ttl_expired_still_hit_after_head_refresh(self):
        self.cache.ttl_seconds = -1  # every get must HEAD-refresh
        await self.cache.put(self.material, b"audio-1")
        self.assertEqual(b"audio-1", await self.cache.get(self.material))

    async def test_ttl_head_failure_is_miss(self):
        self.cache.ttl_seconds = -1
        await self.cache.put(self.material, b"audio-1")
        self.cache.stat_fails.add(self.cache.object_key(self.material))
        self.assertIsNone(await self.cache.get(self.material))
        # object still present for the put-overwrite path
        self.assertIn(self.cache.object_key(self.material), self.cache.objects)

    async def test_generator_version_mismatch_is_miss(self):
        await self.cache.put(self.material, b"audio-1")
        key = self.cache.object_key(self.material)
        self.cache.metadata[key]["generator_version"] = "0.1.0"
        self.assertIsNone(await self.cache.get(self.material))
        await self.cache.put(self.material, b"audio-2")  # overwrite same key
        self.assertEqual(b"audio-2", await self.cache.get(self.material))
        self.assertEqual(settings.app_version, self.cache.metadata[key]["generator_version"])

    async def test_execution_info_revision_mismatch_is_miss(self):
        await self.cache.put(self.material, b"audio-1")
        key = self.cache.object_key(self.material)
        self.cache.metadata[key]["execution_info_revision"] = "0"
        self.assertIsNone(await self.cache.get(self.material))

    async def test_lru_evicts_oldest_first(self):
        keys = []
        for i in range(3):
            text = f"text-{i}"
            m = build_cache_key(self.provider, _wav_descriptor(self.provider, "Serena"), "Serena", text)
            await self.cache.put(m, f"audio-{i}".encode() * 100)
            keys.append(self.cache.object_key(m))
            await asyncio.sleep(0.01)  # distinct last_access
        # Touch the second object so it becomes the most recent.
        await self.cache.get(_material_for(self.provider, "text-1"))
        self.cache.cap_bytes = 900  # one object (800B) fits; two do not
        await self.cache.sweep()
        remaining = set(self.cache.objects)
        self.assertNotIn(keys[0], remaining, "oldest must be evicted first")
        self.assertNotIn(keys[2], remaining)
        self.assertIn(keys[1], remaining, "touched object must survive")

    async def test_flush_merges_metadata_and_keeps_provenance(self):
        await self.cache.put(self.material, b"audio-1")
        key = self.cache.object_key(self.material)
        before = dict(self.cache.metadata[key])
        self.assertFalse(self.cache.stats[key].dirty)
        await self.cache.get(self.material)  # bumps hit_count + dirty
        self.assertTrue(self.cache.stats[key].dirty)
        await self.cache.flush_hit_counts()
        after = self.cache.metadata[key]
        self.assertEqual(before["hash"], after["hash"])
        self.assertEqual(before["generator_version"], after["generator_version"])
        self.assertEqual(before["model"], after["model"])
        self.assertEqual(before["created_at"], after["created_at"])
        self.assertTrue(after["last_access"])
        self.assertFalse(self.cache.stats[key].dirty)

    async def test_idempotent_put_overwrite_same_key(self):
        await self.cache.put(self.material, b"audio-1")
        await self.cache.put(self.material, b"audio-1")
        self.assertEqual(b"audio-1", await self.cache.get(self.material))


def _material_for(provider, text):
    return build_cache_key(provider, _wav_descriptor(provider, "Serena"), "Serena", text)


class GatewayCacheIntegrationTest(unittest.IsolatedAsyncioTestCase):
    def setUp(self):
        self.cache = InMemoryGeneratedAssetCache(
            cap_bytes=10_000, ttl_seconds=86400, prefix="generated-assets/v1"
        )
        set_cache_override(self.cache)

    def tearDown(self):
        set_cache_override(None)

    async def test_miss_then_hit_with_execution_info(self):
        adapter, calls = _synth_adapter("dashscope_native", _wav_descriptor(_provider("dashscope_native"), "Serena"))
        with patch("app.services.tts_gateway.require_adapter", return_value=adapter):
            first = await gateway_synthesize(_request(_provider("dashscope_native")))
            second = await gateway_synthesize(_request(_provider("dashscope_native")))

        self.assertEqual(1, calls["n"], "second identical request must be a cache hit")
        import base64 as b64

        self.assertEqual("Xin chào".encode("utf-8"), b64.b64decode(first.results[0].audio_base64)[6:])
        # First call: miss.
        self.assertFalse(first.results[0].execution_info.cache.hit)
        self.assertIsNone(first.results[0].execution_info.cache.source)
        # Second call: hit with a source pointing into the namespace.
        info = second.results[0].execution_info
        self.assertTrue(info.cache.hit)
        self.assertTrue(info.cache.source.startswith("generated-assets/v1/tts/dashscope_native/Serena/"))
        self.assertEqual("wav", info.cache.source.rsplit(".", 1)[1])
        self.assertEqual(second.results[0].audio_base64, first.results[0].audio_base64)
        self.assertEqual("Serena", info.voice)
        self.assertEqual("probe-model", info.model)
        self.assertIsNotNone(info.request_id)
        self.assertIsNotNone(info.latency_ms)

    async def test_single_flight_exactly_one_engine_call(self):
        provider = _provider("dashscope_native")
        descriptor = _wav_descriptor(provider, "Serena")
        entered = asyncio.Event()
        release = asyncio.Event()
        calls = {"n": 0}

        async def blocked_synthesize(p, text, voice_id):
            calls["n"] += 1
            entered.set()
            await release.wait()
            return SynthesizeResult(audio_bytes=b"audio", mime_type="audio/wav")

        adapter = SimpleNamespace(
            synthesize=blocked_synthesize,
            cache_descriptor=lambda p, v: descriptor,
            protocol="dashscope_native",
            requires_api_key=True,
        )
        with patch("app.services.tts_gateway.require_adapter", return_value=adapter):
            tasks = [asyncio.create_task(gateway_synthesize(_request(provider))) for _ in range(3)]
            await asyncio.wait_for(entered.wait(), timeout=5)
            await asyncio.sleep(0.2)  # give the other two requests time to (fail to) enter
            self.assertEqual(1, calls["n"], "single-flight must dedupe concurrent same-key misses")
            release.set()
            responses = await asyncio.gather(*tasks)

        self.assertTrue(all(resp.status == "COMPLETED" for resp in responses))
        audio_b64s = {resp.results[0].audio_base64 for resp in responses}
        self.assertEqual(1, len(audio_b64s))
        self.assertEqual(1, calls["n"])

    async def test_cached_object_does_not_bypass_voice_validation(self):
        # P0-2: an object exists in the cache, but the adapter's catalog no
        # longer knows the voice → the fail-fast gate must win, never the cache.
        provider = _provider("dashscope_native")
        adapter, _calls = _synth_adapter("dashscope_native", _wav_descriptor(provider, "Serena"))
        with patch("app.services.tts_gateway.require_adapter", return_value=adapter):
            await gateway_synthesize(_request(provider))  # populates the cache

        def rejecting_descriptor(p, voice_id):
            raise ProviderValidation(
                f"Voice '{voice_id}' is not in the static catalog",
                code=ProviderErrorCode.PROVIDER_TTS_VOICE_NOT_FOUND,
                protocol="dashscope_native",
                capability="TTS",
            )

        adapter.cache_descriptor = rejecting_descriptor
        with patch("app.services.tts_gateway.require_adapter", return_value=adapter):
            response = await gateway_synthesize(_request(provider))
        result = response.results[0]
        self.assertEqual("FAILED", result.status)
        self.assertIsNone(result.audio_base64)
        self.assertIn("not in the static catalog", str(result.error))

    async def test_failing_cache_falls_back_to_live_synthesis(self):
        class _BrokenCache:
            def object_key(self, material):
                return "broken"

            async def get(self, material):
                raise RuntimeError("MinIO down")

            async def put(self, material, data):
                raise RuntimeError("MinIO down")

        set_cache_override(_BrokenCache())
        adapter, calls = _synth_adapter("dashscope_native", _wav_descriptor(_provider("dashscope_native"), "Serena"))
        with patch("app.services.tts_gateway.require_adapter", return_value=adapter):
            response = await gateway_synthesize(_request(_provider("dashscope_native")))
        self.assertEqual("COMPLETED", response.status)
        self.assertEqual("SUCCESS", response.results[0].status)
        self.assertEqual(1, calls["n"])
        self.assertFalse(response.results[0].execution_info.cache.hit)


class FailOpenTest(unittest.IsolatedAsyncioTestCase):
    def tearDown(self):
        set_cache_override(None)

    def test_disabled_cache_is_noop(self):
        with patch.object(settings, "gen_cache_enabled", False):
            cache = get_cache()
        self.assertIsInstance(cache, NoopGeneratedAssetCache)

    def test_missing_credentials_are_noop(self):
        with patch.object(settings, "media_storage_access_key", ""), patch.object(settings, "media_storage_secret_key", ""):
            cache = get_cache()
        self.assertIsInstance(cache, NoopGeneratedAssetCache)

    def test_minio_constructor_failure_is_noop(self):
        with patch.object(settings, "media_storage_access_key", "key"), patch.object(
            settings, "media_storage_secret_key", "secret"
        ):
            with patch(
                "app.services.generated_asset_cache.MinioGeneratedAssetCache",
                side_effect=RuntimeError("cannot reach MinIO"),
            ):
                cache = get_cache()
        self.assertIsInstance(cache, NoopGeneratedAssetCache)

    async def test_disabled_cache_synthesizes_without_cache_io(self):
        adapter, calls = _synth_adapter("dashscope_native", _wav_descriptor(_provider("dashscope_native"), "Serena"))
        set_cache_override(NoopGeneratedAssetCache())
        with patch("app.services.tts_gateway.require_adapter", return_value=adapter):
            response = await gateway_synthesize(_request(_provider("dashscope_native")))
        self.assertEqual("COMPLETED", response.status)
        self.assertEqual(1, calls["n"])
        self.assertFalse(response.results[0].execution_info.cache.hit)
        self.assertIsNone(response.results[0].execution_info.cache.source)

    async def test_mock_mode_bypasses_cache(self):
        adapter, calls = _synth_adapter("dashscope_native", _wav_descriptor(_provider("dashscope_native"), "Serena"))
        set_cache_override(InMemoryGeneratedAssetCache())
        with patch("app.services.tts_gateway.require_adapter", return_value=adapter):
            with patch.object(settings, "mock_mode", True):
                response = await gateway_synthesize(_request(_provider("dashscope_native")))
        self.assertEqual("COMPLETED", response.status)
        self.assertEqual(0, calls["n"], "mock path must not touch the engine or the cache")
        self.assertIsNone(response.results[0].execution_info)


class MinioFlushTest(unittest.TestCase):
    """P0 regression: MinIO 7.2.20 ``copy_object()`` has NO ``content_type``
    parameter — the content type must ride inside the metadata dict, and
    ``dirty`` must survive a failed copy so the next flush cycle retries."""

    class _Spy:
        """Client spy mirroring the exact MinIO 7.2.20 copy_object signature.

        Deliberately no ``**kwargs`` — if the code passes ``content_type=``
        (the bug), the call raises TypeError exactly like the real SDK.
        """

        def __init__(self):
            self.stat_calls: list[tuple[str, str]] = []
            self.copy_calls: list[dict] = []
            self.stat_metadata: dict[str, dict] = {}
            self.fail_copy = False

        def stat_object(self, bucket_name, object_name):
            self.stat_calls.append((bucket_name, object_name))
            return SimpleNamespace(metadata=dict(self.stat_metadata.get(object_name, {})))

        def copy_object(
            self,
            bucket_name,
            object_name,
            source,
            sse=None,
            metadata=None,
            tags=None,
            retention=None,
            legal_hold=False,
            metadata_directive=None,
            tagging_directive=None,
        ):
            if self.fail_copy:
                raise RuntimeError("copy failed")
            self.copy_calls.append(
                {
                    "bucket": bucket_name,
                    "object_name": object_name,
                    "metadata": dict(metadata or {}),
                    "metadata_directive": metadata_directive,
                }
            )

    def _cache_with_spy(self):
        cache = MinioGeneratedAssetCache(
            endpoint="http://localhost:9000", access_key="k", secret_key="s",
            bucket="b", prefix="generated-assets/v1",
        )
        spy = self._Spy()
        cache._client = spy
        return cache, spy

    def _prime(self, cache, spy):
        provider = _provider("dashscope_native")
        material = build_cache_key(provider, _wav_descriptor(provider, "Serena"), "Serena", "t")
        key = cache.object_key(material)
        now = time.time()
        entry = gac._Entry(size=1234, last_access=now, hit_count=3, verified_at=now, dirty=True)
        cache._stats[key] = entry
        blob = json.loads(build_metadata(material, b"x" * 1234, now - 3600)[gac._META_USER_KEY])
        blob["last_access"] = gac._iso_ts(now - 3600)
        spy.stat_metadata[key] = {
            gac._META_USER_KEY: json.dumps(blob),
            "content-type": "audio/wav",
        }
        return key, material

    def test_flush_merges_provenance_and_keeps_content_type(self):
        cache, spy = self._cache_with_spy()
        key, material = self._prime(cache, spy)
        now = cache._stats[key].last_access

        cache._flush_sync([key])

        self.assertEqual([("b", key)], spy.stat_calls, "existing metadata must be read before merging")
        self.assertEqual(1, len(spy.copy_calls))
        call = spy.copy_calls[0]
        self.assertEqual("b", call["bucket"])
        self.assertEqual(key, call["object_name"])
        self.assertEqual("REPLACE", call["metadata_directive"])
        # Content type travels inside the metadata dict (no content_type kwarg in the SDK).
        self.assertEqual("audio/wav", call["metadata"]["Content-Type"])
        merged = json.loads(call["metadata"][gac._META_USER_KEY])
        self.assertEqual(material.hash, merged["hash"])
        self.assertEqual(material.provider_identity, merged["provider_identity"])
        self.assertEqual(settings.app_version, merged["generator_version"])
        self.assertEqual(EXECUTION_INFO_REVISION, merged["execution_info_revision"])
        self.assertEqual(gac._iso_ts(now), merged["last_access"], "flush must refresh last_access")
        self.assertEqual("1234", merged["byte_size"])
        self.assertEqual(material.hash, call["metadata"][gac._META_HASH_KEY])
        self.assertFalse(cache._stats[key].dirty, "successful copy clears dirty")

    def test_flush_failure_keeps_dirty_for_next_cycle(self):
        cache, spy = self._cache_with_spy()
        key, _material = self._prime(cache, spy)
        spy.fail_copy = True

        with self.assertRaises(RuntimeError):
            cache._flush_sync([key])

        self.assertTrue(cache._stats[key].dirty, "transient copy failure must keep dirty so the next flush cycle retries")

    def test_foreign_object_without_provenance_is_not_rewritten(self):
        cache, spy = self._cache_with_spy()
        provider = _provider("dashscope_native")
        material = build_cache_key(provider, _wav_descriptor(provider, "Serena"), "Serena", "t")
        key = cache.object_key(material)
        now = time.time()
        cache._stats[key] = gac._Entry(size=10, last_access=now, hit_count=1, verified_at=now, dirty=True)
        spy.stat_metadata[key] = {"content-type": "audio/wav"}  # no tf-meta provenance

        cache._flush_sync([key])

        self.assertEqual(0, len(spy.copy_calls), "objects without provenance must never be rewritten")
        self.assertFalse(cache._stats[key].dirty)


class SingleFlightTest(unittest.IsolatedAsyncioTestCase):
    async def test_serializes_same_key_calls(self):
        sf = SingleFlight()
        order: list[str] = []
        release = asyncio.Event()
        calls = {"n": 0}

        async def work(name: str):
            calls["n"] += 1
            order.append(f"enter-{name}")
            await release.wait()
            order.append(f"exit-{name}")
            return name

        tasks = [
            asyncio.create_task(sf.run("k", lambda: work("a"))),
            asyncio.create_task(sf.run("k", lambda: work("b"))),
        ]
        await asyncio.sleep(0.05)  # let "a" enter and hold the key lock
        release.set()
        results = await asyncio.gather(*tasks)
        self.assertEqual(["a", "b"], sorted(results))
        self.assertEqual(2, calls["n"], "each waiter runs its own factory after the lock")
        self.assertEqual(["enter-a", "exit-a", "enter-b", "exit-b"], order, "same-key work must not interleave")

    async def test_locks_are_reclaimed_when_no_waiters(self):
        sf = SingleFlight()
        for i in range(50):
            await sf.run(f"key-{i}", lambda: asyncio.sleep(0))
        self.assertEqual(0, len(sf._locks), "finished keys must not linger in the lock dict")
        self.assertEqual(0, len(sf._refs))

        async def noop():
            return None

        await asyncio.gather(*[sf.run("hot", noop) for _ in range(10)])
        self.assertEqual(0, len(sf._locks), "concurrent burst on one key must also reap its lock")


if __name__ == "__main__":
    unittest.main()
