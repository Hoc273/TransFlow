import asyncio
import threading
import unittest
from unittest.mock import AsyncMock, Mock, patch

from pydantic import ValidationError

from app.api.capabilities import capabilities
from app.api.render import (
    LayerGeometryRequest,
    PresentationLayerRequest,
    PresentationLayerStyleRequest,
    RenderRequest,
    SubtitleMaskRequest,
    SubtitleTrackRequest,
    process_render,
)
from app.services.ffmpeg import FFmpegError, VideoDurationProbe


def request(**overrides) -> RenderRequest:
    values = {
        "correlation_id": "correlation-1",
        "media_job_id": "job-1",
        "source_video_ref": "media/source.mp4",
        "cut_ranges": [{"start_ms": 0, "end_ms": 1_000}],
        "audio_input_version": "1",
        "audio_source": "MIXED_AUDIO",
        "resolved_audio_ref": "media/mixed.wav",
        "subtitle_track": SubtitleTrackRequest(
            format="srt",
            content_ref="media/subtitle.srt",
            mode="SOFT_SUB",
        ),
        "callback_base_url": "http://callback.test",
    }
    values.update(overrides)
    return RenderRequest(**values)


class RenderContractTest(unittest.IsolatedAsyncioTestCase):
    def test_audio_source_is_required(self):
        with self.assertRaises(ValidationError):
            request(audio_source=None)

    def test_audio_input_version_is_required(self):
        values = request().model_dump()
        values.pop("audio_input_version")
        with self.assertRaises(ValidationError):
            RenderRequest(**values)

    async def test_mixed_audio_path_only_muxes_resolved_audio(self):
        storage = Mock()
        storage.upload.side_effect = lambda _path, key: f"media/{key}"
        with patch("app.api.render.get_storage", return_value=storage), patch(
            "app.api.render.send_progress", new=AsyncMock()
        ), patch("app.api.render.send_complete", new=AsyncMock()) as complete, patch(
            "app.api.render.validate_subtitle_format", return_value="srt"
        ), patch("app.api.render.shutil.copyfile"), patch(
            "app.api.render.srt_to_vtt"
        ), patch("app.api.render.cut_and_concat_video"), patch(
            "app.api.render.replace_audio"
        ) as mux, patch("app.api.render.mux_soft_subtitles"), patch(
            "app.api.render.resolve_legacy_audio"
        ) as legacy, patch(
            "app.services.render_validation.get_duration", return_value=1.0
        ), patch(
            "app.services.render_validation.get_stream_types",
            return_value=["video", "audio", "subtitle"],
        ):
            await process_render(request())

        legacy.assert_not_called()
        mux.assert_called_once()
        self.assertTrue(any(call.args[0] == "media/mixed.wav" for call in storage.download.call_args_list))
        self.assertEqual("COMPLETED", complete.await_args.args[2])

    async def test_missing_mixed_audio_fails_closed(self):
        with patch("app.api.render.get_storage", return_value=Mock()), patch(
            "app.api.render.send_progress", new=AsyncMock()
        ), patch("app.api.render.send_complete", new=AsyncMock()) as complete, patch(
            "app.api.render.validate_subtitle_format", return_value="srt"
        ), patch("app.api.render.shutil.copyfile"), patch(
            "app.api.render.srt_to_vtt"
        ), patch("app.api.render.cut_and_concat_video"):
            await process_render(request(resolved_audio_ref=None))

        self.assertEqual("FAILED", complete.await_args.args[2])
        self.assertEqual("INVALID_INPUT", complete.await_args.kwargs["error"]["code"])

    async def test_invalid_legacy_dubbed_does_not_default_to_original(self):
        with patch("app.api.render.get_storage", return_value=Mock()), patch(
            "app.api.render.send_progress", new=AsyncMock()
        ), patch("app.api.render.send_complete", new=AsyncMock()) as complete, patch(
            "app.api.render.validate_subtitle_format", return_value="srt"
        ), patch("app.api.render.shutil.copyfile"), patch(
            "app.api.render.srt_to_vtt"
        ), patch("app.api.render.cut_and_concat_video"), patch(
            "app.api.render.resolve_legacy_audio",
            side_effect=ValueError("bad legacy descriptor"),
        ) as legacy:
            await process_render(request(
                audio_source="LEGACY_DUBBED",
                resolved_audio_ref=None,
                audio_mode="DUBBED",
                segment_audios=None,
            ))

        legacy.assert_called_once()
        self.assertEqual("INVALID_INPUT", complete.await_args.kwargs["error"]["code"])

    async def test_heavy_render_does_not_block_capabilities(self):
        storage = Mock()
        storage.upload.side_effect = lambda _path, key: f"media/{key}"
        entered = threading.Event()
        release = threading.Event()

        def blocked_cut(*_args):
            entered.set()
            release.wait(timeout=1)

        validation = Mock(passed=True)
        validation.to_payload.return_value = {}
        media_probe = Mock()
        media_probe.to_payload.return_value = {}
        # The timer only prevents an assertion failure from leaving the worker
        # thread blocked if this regression ever runs against the old code.
        release_timer = threading.Timer(0.2, release.set)
        release_timer.start()
        started = asyncio.get_running_loop().time()
        try:
            with patch("app.api.render.get_storage", return_value=storage), patch(
                "app.api.render.send_progress", new=AsyncMock()
            ), patch("app.api.render.send_complete", new=AsyncMock()), patch(
                "app.api.render.validate_subtitle_format", return_value="srt"
            ), patch("app.api.render.shutil.copyfile"), patch(
                "app.api.render.srt_to_vtt"
            ), patch("app.api.render.cut_and_concat_video", side_effect=blocked_cut), patch(
                "app.api.render.replace_audio"
            ), patch("app.api.render.mux_soft_subtitles"), patch(
                "app.api.render.probe_video", return_value=media_probe
            ), patch(
                "app.api.render.RenderValidationRunner.run", return_value=validation
            ):
                render_task = asyncio.create_task(process_render(request()))
                self.assertTrue(await asyncio.to_thread(entered.wait, 1))
                self.assertFalse(release.is_set())
                await asyncio.wait_for(capabilities(), timeout=0.05)
                self.assertLess(asyncio.get_running_loop().time() - started, 0.2)
                release.set()
                await render_task
        finally:
            release.set()
            release_timer.cancel()

    async def test_render_slot_keeps_second_render_out_of_heavy_section(self):
        storage = Mock()
        storage.upload.side_effect = lambda _path, key: f"media/{key}"
        first_entered = threading.Event()
        release_first = threading.Event()
        calls = []

        def controlled_cut(*_args):
            calls.append(True)
            if len(calls) == 1:
                first_entered.set()
                release_first.wait(timeout=1)

        validation = Mock(passed=True)
        validation.to_payload.return_value = {}
        media_probe = Mock()
        media_probe.to_payload.return_value = {}
        with patch("app.api.render.get_storage", return_value=storage), patch(
            "app.api.render.send_progress", new=AsyncMock()
        ), patch("app.api.render.send_complete", new=AsyncMock()), patch(
            "app.api.render.validate_subtitle_format", return_value="srt"
        ), patch("app.api.render.shutil.copyfile"), patch(
            "app.api.render.srt_to_vtt"
        ), patch("app.api.render.cut_and_concat_video", side_effect=controlled_cut), patch(
            "app.api.render.replace_audio"
        ), patch("app.api.render.mux_soft_subtitles"), patch(
            "app.api.render.probe_video", return_value=media_probe
        ), patch(
            "app.api.render.RenderValidationRunner.run", return_value=validation
        ):
            first = asyncio.create_task(process_render(request(correlation_id="first")))
            self.assertTrue(await asyncio.to_thread(first_entered.wait, 1))
            second = asyncio.create_task(process_render(request(correlation_id="second")))
            await asyncio.sleep(0.05)
            self.assertEqual(1, len(calls))
            release_first.set()
            await asyncio.gather(first, second)

        self.assertEqual(2, len(calls))

    # ─── B1.0 styled burn-in (docs/93 §4.6.6, TC-CEP-28) ─────────────────

    async def test_ass_hard_sub_burns_without_sidecars_or_placeholder_copy(self):
        # ASS carries the Spring-owned style: the worker burns it as-is and never
        # fabricates SRT/VTT (sidecars are Spring-owned at preparation). The
        # callback therefore carries null sidecar refs and exactly one upload.
        storage = Mock()
        storage.upload.side_effect = lambda _path, key: f"media/{key}"
        with patch("app.api.render.get_storage", return_value=storage), patch(
            "app.api.render.send_progress", new=AsyncMock()
        ), patch("app.api.render.send_complete", new=AsyncMock()) as complete, patch(
            "app.api.render.cut_and_concat_video"
        ), patch("app.api.render.replace_audio"), patch(
            "app.api.render.burn_subtitles"
        ) as burn, patch("app.api.render.shutil.copyfile") as copyfile, patch(
            "app.api.render.srt_to_vtt"
        ) as srt_to_vtt, patch(
            "app.services.render_validation.get_duration", return_value=1.0
        ), patch(
            "app.services.render_validation.get_stream_types",
            return_value=["video", "audio"],
        ):
            await process_render(request(
                subtitle_track=SubtitleTrackRequest(
                    format="ass",
                    content_ref="media/subtitle.ass",
                    mode="HARD_SUB",
                ),
            ))

        burn.assert_called_once()
        self.assertEqual("ass", burn.call_args.kwargs["subtitle_format"])
        self.assertNotIn("force_style", str(burn.call_args))
        copyfile.assert_not_called()
        srt_to_vtt.assert_not_called()
        self.assertEqual(1, storage.upload.call_count)
        self.assertEqual("COMPLETED", complete.await_args.args[2])
        self.assertIsNone(complete.await_args.kwargs.get("srt_ref"))
        self.assertIsNone(complete.await_args.kwargs.get("vtt_ref"))

    async def test_ass_soft_sub_fails_closed_without_retryable_error(self):
        # ASS implies HARD_SUB from Spring; a soft-sub ASS request is a broken
        # contract — fail closed (INVALID_INPUT, non-retryable) instead of muxing
        # a None track.
        with patch("app.api.render.get_storage", return_value=Mock()), patch(
            "app.api.render.send_progress", new=AsyncMock()
        ), patch("app.api.render.send_complete", new=AsyncMock()) as complete, patch(
            "app.api.render.cut_and_concat_video"
        ), patch("app.api.render.replace_audio"), patch(
            "app.api.render.burn_subtitles"
        ) as burn, patch("app.api.render.mux_soft_subtitles"):
            await process_render(request(
                subtitle_track=SubtitleTrackRequest(
                    format="ass",
                    content_ref="media/subtitle.ass",
                    mode="SOFT_SUB",
                ),
            ))

        burn.assert_not_called()
        self.assertEqual("INVALID_INPUT", complete.await_args.kwargs["error"]["code"])

    async def test_soft_sub_with_mask_fails_closed(self):
        # Phase 4 (docs/16 §7.1): the mask is a burn-time overlay — it can never
        # apply to the player-controlled mov_text stream; the worker fails
        # closed even if a broken caller sends it with SOFT_SUB.
        with patch("app.api.render.get_storage", return_value=Mock()), patch(
            "app.api.render.send_progress", new=AsyncMock()
        ), patch("app.api.render.send_complete", new=AsyncMock()) as complete, patch(
            "app.api.render.cut_and_concat_video"
        ), patch("app.api.render.replace_audio"), patch(
            "app.api.render.shutil.copyfile"
        ), patch("app.api.render.mux_soft_subtitles"
        ), patch("app.api.render.srt_to_vtt"):
            await process_render(request(
                subtitle_track=SubtitleTrackRequest(
                    format="srt",
                    content_ref="media/subtitle.srt",
                    mode="SOFT_SUB",
                    mask=SubtitleMaskRequest(
                        enabled=True,
                        anchor="SUBTITLE",
                        width_percent=85,
                        height_percent=12,
                        opacity_percent=60,
                        padding_percent=2,
                    ),
                ),
            ))

        self.assertEqual("INVALID_INPUT", complete.await_args.kwargs["error"]["code"])
        self.assertIn(
            "mask is not supported with SOFT_SUB",
            complete.await_args.kwargs["error"]["message"],
        )

    # ─── V2 layers + outline wiring (docs/97 §19.17 §E/F) ─────────────────

    async def test_hard_sub_v2_layers_payload_reaches_burn_subtitles(self):
        storage = Mock()
        storage.upload.side_effect = lambda _path, key: f"media/{key}"
        with patch("app.api.render.get_storage", return_value=storage), patch(
            "app.api.render.send_progress", new=AsyncMock()
        ), patch("app.api.render.send_complete", new=AsyncMock()) as complete, patch(
            "app.api.render.cut_and_concat_video"
        ), patch("app.api.render.replace_audio"), patch(
            "app.api.render.burn_subtitles"
        ) as burn, patch("app.api.render.shutil.copyfile"), patch(
            "app.api.render.srt_to_vtt"
        ), patch("app.services.render_validation.get_duration",
                         return_value=1.0), patch(
            "app.services.render_validation.get_stream_types",
            return_value=["video", "audio"],
        ):
            await process_render(request(
                subtitle_track=SubtitleTrackRequest(
                    format="srt",
                    content_ref="media/subtitle.srt",
                    mode="HARD_SUB",
                    layers=[PresentationLayerRequest(
                        id="cover",
                        type="SOLID",
                        enabled=True,
                        z_index=3,
                        anchor="SUBTITLE",
                        geometry=LayerGeometryRequest(
                            width_percent=85, height_percent=12),
                        style=PresentationLayerStyleRequest(
                            opacity_percent=60),
                    )],
                ),
            ))

        burn.assert_called_once()
        layers = burn.call_args.kwargs["layers"]
        self.assertEqual(1, len(layers))
        self.assertEqual("cover", layers[0]["id"])
        self.assertEqual("SOLID", layers[0]["type"])
        self.assertEqual(3, layers[0]["z_index"])
        self.assertEqual({"width_percent": 85, "height_percent": 12,
                          "x_percent": None, "y_percent": None},
                         layers[0]["geometry"])
        self.assertEqual({"color": None, "opacity_percent": 60,
                          "blur_radius": None}, layers[0]["style"])
        self.assertEqual("COMPLETED", complete.await_args.args[2])

    async def test_hard_sub_outline_fields_reach_burn_subtitles(self):
        storage = Mock()
        with patch("app.api.render.get_storage", return_value=storage), patch(
            "app.api.render.send_progress", new=AsyncMock()
        ), patch("app.api.render.send_complete", new=AsyncMock()), patch(
            "app.api.render.cut_and_concat_video"
        ), patch("app.api.render.replace_audio"), patch(
            "app.api.render.burn_subtitles"
        ) as burn, patch("app.api.render.shutil.copyfile"), patch(
            "app.api.render.srt_to_vtt"
        ), patch("app.services.render_validation.get_duration",
                         return_value=1.0), patch(
            "app.services.render_validation.get_stream_types",
            return_value=["video", "audio"],
        ):
            await process_render(request(
                subtitle_track=SubtitleTrackRequest(
                    format="srt",
                    content_ref="media/subtitle.srt",
                    mode="HARD_SUB",
                    background_box=False,
                    outline_width=4,
                    outline_color="#ABCDEF",
                ),
            ))

        burn.assert_called_once()
        self.assertEqual(4, burn.call_args.kwargs["outline_width"])
        self.assertEqual("#ABCDEF", burn.call_args.kwargs["outline_color"])

    async def test_soft_sub_with_layers_fails_closed(self):
        # Layers are burn overlays exactly like the mask — never applicable to
        # a muxed soft-sub track; fail closed against a broken caller.
        with patch("app.api.render.get_storage", return_value=Mock()), patch(
            "app.api.render.send_progress", new=AsyncMock()
        ), patch("app.api.render.send_complete", new=AsyncMock()) as complete, patch(
            "app.api.render.cut_and_concat_video"
        ), patch("app.api.render.replace_audio"), patch(
            "app.api.render.burn_subtitles"
        ) as burn, patch("app.api.render.shutil.copyfile"), patch(
            "app.api.render.mux_soft_subtitles"
        ), patch("app.api.render.srt_to_vtt"):
            await process_render(request(
                subtitle_track=SubtitleTrackRequest(
                    format="srt",
                    content_ref="media/subtitle.srt",
                    mode="SOFT_SUB",
                    layers=[PresentationLayerRequest(
                        id="cover",
                        type="SOLID",
                        enabled=True,
                        z_index=0,
                        anchor="SUBTITLE",
                        geometry=LayerGeometryRequest(
                            width_percent=85, height_percent=12),
                        style=PresentationLayerStyleRequest(
                            opacity_percent=60),
                    )],
                ),
            ))

        burn.assert_not_called()
        self.assertEqual("INVALID_INPUT", complete.await_args.kwargs["error"]["code"])
        self.assertIn(
            "presentation layers are not supported with SOFT_SUB",
            complete.await_args.kwargs["error"]["message"],
        )
    async def test_generative_beats_composition_branch(self):
        from app.api.render import GenerativeBeatRequest
        storage = Mock()
        storage.upload.side_effect = lambda _path, key: f"media/{key}"
        with patch("app.api.render.get_storage", return_value=storage), patch(
            "app.api.render.send_progress", new=AsyncMock()
        ), patch("app.api.render.send_complete", new=AsyncMock()) as complete, patch(
            "app.services.generative_compose._extract_and_rescale_beat"
        ) as extract_beat, patch(
            "app.services.generative_compose.probe_source_duration",
            return_value=VideoDurationProbe(
                container_duration_ms=25_000,
                video_stream_start_ms=0,
                video_stream_duration_ms=25_000,
                video_stream_end_ms=25_000,
                duration_source="test",
            ),
        ) as source_probe, patch(
            "app.api.render.cut_and_concat_video"
        ) as standard_cut, patch(
            "app.api.render._run"
        ) as run_cmd, patch(
            "app.api.render.replace_audio"
        ) as replace_aud, patch(
            "app.api.render.burn_subtitles"
        ) as burn, patch("app.api.render.shutil.copyfile"), patch(
            "app.api.render.srt_to_vtt"
        ), patch(
            "app.services.render_validation.get_duration", return_value=5.0
        ), patch(
            "app.services.render_validation.get_stream_types", return_value=["video", "audio"]
        ):
            await process_render(request(
                subtitle_track=SubtitleTrackRequest(
                    format="srt",
                    content_ref="media/subtitle.srt",
                    mode="HARD_SUB",
                ),
                generative_beats=[
                    GenerativeBeatRequest(
                        id="b1",
                        source_start_ms=0,
                        source_end_ms=10000,
                        tts_duration_ms=2500,
                        audio_ref="media/b1.wav",
                        visual_strategy="SOURCE_CUT",
                        narration_segment="Beat 1",
                    ),
                    GenerativeBeatRequest(
                        id="b2",
                        source_start_ms=15000,
                        source_end_ms=25000,
                        tts_duration_ms=2500,
                        audio_ref="media/b2.wav",
                        visual_strategy="SOURCE_CUT",
                        narration_segment="Beat 2",
                    ),
                ],
            ))

        standard_cut.assert_not_called()
        self.assertEqual(2, extract_beat.call_count)
        for extract_call in extract_beat.call_args_list:
            self.assertIs(
                source_probe.return_value,
                extract_call.kwargs["source_duration_probe"],
            )
        self.assertEqual(4, storage.download.call_count)
        replace_aud.assert_called_once()
        burn.assert_called_once()
        self.assertEqual("COMPLETED", complete.await_args.args[2])

    async def test_generative_beat_tempo_retimes_only_the_narration_it_targets(self):
        # Spring fits the total narration to the requested duration with one
        # bounded tempo; beats without it keep their measured audio untouched.
        from app.api.render import GenerativeBeatRequest
        storage = Mock()
        storage.upload.side_effect = lambda _path, key: f"media/{key}"
        with patch("app.api.render.get_storage", return_value=storage), patch(
            "app.api.render.send_progress", new=AsyncMock()
        ), patch("app.api.render.send_complete", new=AsyncMock()) as complete, patch(
            "app.services.generative_compose._extract_and_rescale_beat"
        ), patch(
            "app.services.generative_compose.probe_source_duration",
            return_value=VideoDurationProbe(
                container_duration_ms=25_000,
                video_stream_start_ms=0,
                video_stream_duration_ms=25_000,
                video_stream_end_ms=25_000,
                duration_source="test",
            ),
        ), patch("app.api.render._run"), patch("app.api.render.replace_audio"), patch(
            "app.api.render.burn_subtitles"
        ), patch("app.api.render.shutil.copyfile"), patch("app.api.render.srt_to_vtt"), patch(
            "app.api.render._apply_tempo", side_effect=lambda path, tempo, temp_dir: path + ".tempo.wav"
        ) as apply_tempo, patch(
            "app.services.render_validation.get_duration", return_value=5.0
        ), patch(
            "app.services.render_validation.get_stream_types", return_value=["video", "audio"]
        ):
            await process_render(request(
                subtitle_track=SubtitleTrackRequest(format="srt", content_ref="media/subtitle.srt", mode="HARD_SUB"),
                generative_beats=[
                    GenerativeBeatRequest(id="b1", source_start_ms=0, source_end_ms=10000,
                                          tts_duration_ms=2315, audio_ref="media/b1.wav", tempo=1.08),
                    GenerativeBeatRequest(id="b2", source_start_ms=15000, source_end_ms=25000,
                                          tts_duration_ms=2500, audio_ref="media/b2.wav"),
                ],
            ))

        apply_tempo.assert_called_once()
        self.assertEqual(1.08, apply_tempo.call_args.args[1])
        self.assertEqual("COMPLETED", complete.await_args.args[2])

    def test_beat_voice_is_padded_with_silence_to_the_beat_length(self):
        # Spring adds a bounded pause after a short narration beat; the voice
        # must last the whole beat or audio drifts ahead of the footage.
        from app.api.render import _pad_audio_to
        with patch("app.api.render._run") as run:
            out = _pad_audio_to("voice.wav", 3250, "tmp")
        cmd = run.call_args.args[0]
        self.assertIn("apad=whole_dur=3.250", cmd)
        self.assertEqual(out, cmd[-1])

    async def test_generative_ffmpeg_retryable_flag_reaches_callback(self):
        storage = Mock()
        failure = FFmpegError(
            "source range is outside the physical file",
            "GENERATIVE_SOURCE_RANGE_OUT_OF_BOUNDS",
            retryable=False,
            details={
                "beatId": "b1",
                "requestedSourceRange": {"startMs": 10_000, "endMs": 20_000},
                "videoStreamEndMs": 9_000,
                "targetTtsDurationMs": 2_000,
                "actualOutputDurationMs": None,
            },
        )
        with patch("app.api.render.get_storage", return_value=storage), patch(
            "app.api.render.send_progress", new=AsyncMock()
        ), patch("app.api.render.send_complete", new=AsyncMock()) as complete, patch(
            "app.services.generative_compose.probe_source_duration",
            side_effect=failure,
        ), patch("app.api.render.validate_subtitle_format", return_value="srt"), patch(
            "app.api.render.shutil.copyfile"
        ), patch("app.api.render.srt_to_vtt"):
            await process_render(request(
                generative_beats=[
                    {
                        "id": "b1",
                        "source_start_ms": 10_000,
                        "source_end_ms": 20_000,
                        "tts_duration_ms": 2_000,
                        "audio_ref": "media/b1.wav",
                        "visual_strategy": "SOURCE_CUT",
                        "narration_segment": "Beat 1",
                    },
                ],
            ))

        self.assertEqual("FAILED", complete.await_args.args[2])
        self.assertEqual(
            "GENERATIVE_SOURCE_RANGE_OUT_OF_BOUNDS",
            complete.await_args.kwargs["error"]["code"],
        )
        self.assertFalse(complete.await_args.kwargs["error"]["retryable"])
        self.assertEqual("b1", complete.await_args.kwargs["error"]["details"]["beatId"])

    async def test_source_probe_failure_callback_contains_beat_diagnostics(self):
        storage = Mock()
        failure = FFmpegError(
            "video stream duration metadata unavailable",
            "GENERATIVE_SOURCE_DURATION_UNAVAILABLE",
            retryable=False,
            details={
                "containerDurationMs": 27_736,
                "videoStreamDurationMs": None,
            },
        )
        with patch("app.api.render.get_storage", return_value=storage), patch(
            "app.api.render.send_progress", new=AsyncMock()
        ), patch("app.api.render.send_complete", new=AsyncMock()) as complete, patch(
            "app.services.generative_compose.probe_source_duration",
            side_effect=failure,
        ), patch("app.api.render.validate_subtitle_format", return_value="srt"), patch(
            "app.api.render.shutil.copyfile"
        ), patch("app.api.render.srt_to_vtt"):
            await process_render(request(
                generative_beats=[
                    {
                        "id": "b1",
                        "source_start_ms": 1_000,
                        "source_end_ms": 4_000,
                        "tts_duration_ms": 3_000,
                        "audio_ref": "media/b1.wav",
                        "visual_strategy": "SOURCE_CUT",
                        "narration_segment": "Beat 1",
                    },
                ],
            ))

        error = complete.await_args.kwargs["error"]
        self.assertEqual("GENERATIVE_SOURCE_DURATION_UNAVAILABLE", error["code"])
        self.assertFalse(error["retryable"])
        self.assertEqual("b1", error["details"]["beatId"])
        self.assertEqual(1_000, error["details"]["requestedSourceRange"]["startMs"])
        self.assertEqual(3_000, error["details"]["targetTtsDurationMs"])
        self.assertEqual(27_736, error["details"]["containerDurationMs"])

    async def test_generative_extraction_details_reach_callback_from_process_render(self):
        storage = Mock()
        source_probe = VideoDurationProbe(
            container_duration_ms=531_505,
            video_stream_start_ms=0,
            video_stream_duration_ms=531_440,
            video_stream_end_ms=531_440,
            duration_source="video_stream.duration",
        )
        failure = FFmpegError(
            "Extracted clip duration mismatch",
            "VALIDATION_FAILED",
            retryable=False,
            details={
                "beatId": "b1",
                "requestedSourceRange": {"startMs": 97_420, "endMs": 115_580},
                "effectiveSourceRange": {"startMs": 97_420, "endMs": 115_580},
                "containerDurationMs": 531_505,
                "videoStreamStartMs": 0,
                "videoStreamDurationMs": 531_440,
                "videoStreamEndMs": 531_440,
                "seekOffsetMs": 97_420,
                "targetTtsDurationMs": 21_548,
                "actualOutputDurationMs": 18_166,
            },
        )
        with patch("app.api.render.get_storage", return_value=storage), patch(
            "app.api.render.send_progress", new=AsyncMock()
        ), patch("app.api.render.send_complete", new=AsyncMock()) as complete, patch(
            "app.services.generative_compose.probe_source_duration",
            return_value=source_probe,
        ), patch(
            "app.services.generative_compose._extract_and_rescale_beat",
            side_effect=failure,
        ), patch("app.api.render.validate_subtitle_format", return_value="srt"), patch(
            "app.api.render.shutil.copyfile"
        ), patch("app.api.render.srt_to_vtt"):
            await process_render(request(
                subtitle_track=SubtitleTrackRequest(
                    format="srt",
                    content_ref="media/subtitle.srt",
                    mode="HARD_SUB",
                ),
                generative_beats=[
                    {
                        "id": "b1",
                        "source_start_ms": 97_420,
                        "source_end_ms": 115_580,
                        "tts_duration_ms": 21_548,
                        "audio_ref": "media/b1.wav",
                        "visual_strategy": "SOURCE_CUT",
                        "narration_segment": "Beat 1",
                    },
                ],
            ))

        error = complete.await_args.kwargs["error"]
        self.assertEqual("VALIDATION_FAILED", error["code"])
        self.assertFalse(error["retryable"])
        self.assertEqual("b1", error["details"]["beatId"])
        self.assertEqual(97_420, error["details"]["seekOffsetMs"])
        self.assertEqual(18_166, error["details"]["actualOutputDurationMs"])


if __name__ == "__main__":
    unittest.main()
