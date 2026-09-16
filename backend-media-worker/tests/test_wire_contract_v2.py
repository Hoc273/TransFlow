"""V2 contract freeze (docs/97 §19.17 §H) — worker wire acceptance tests.

Phase 3 scope: Pydantic models accept and validate the V2 payload shape
(``layers[]``, outline fields); no ffmpeg rendering logic is exercised here.
"""
import unittest

from pydantic import ValidationError

from app.api.render import PresentationLayerRequest, SubtitleTrackRequest


def solid_layer(**overrides) -> PresentationLayerRequest:
    values = {
        "id": "cover",
        "type": "SOLID",
        "enabled": True,
        "z_index": 0,
        "anchor": "SUBTITLE",
        "geometry": {"width_percent": 85, "height_percent": 12},
        "style": {"color": "#101010", "opacity_percent": 55},
    }
    values.update(overrides)
    return PresentationLayerRequest(**values)


def blur_layer(**overrides) -> PresentationLayerRequest:
    values = {
        "id": "band",
        "type": "BLUR",
        "enabled": True,
        "z_index": 1,
        "anchor": "TOP",
        "geometry": {"width_percent": 80, "height_percent": 10},
        "style": {"blur_radius": 9},
    }
    values.update(overrides)
    return PresentationLayerRequest(**values)


def track(**overrides) -> SubtitleTrackRequest:
    values = {
        "format": "srt",
        "content_ref": "media/subtitle.srt",
        "mode": "HARD_SUB",
    }
    values.update(overrides)
    return SubtitleTrackRequest(**values)


class WireContractV2AcceptanceTest(unittest.TestCase):

    def test_worker_accepts_v2_layers_payload(self):
        t = track(layers=[solid_layer(), blur_layer()])
        self.assertEqual(len(t.layers), 2)
        first = t.layers[0]
        self.assertEqual(first.id, "cover")
        self.assertEqual(first.type, "SOLID")
        self.assertEqual(first.z_index, 0)
        self.assertEqual(first.geometry.width_percent, 85)
        self.assertEqual(first.style.opacity_percent, 55)

        # Wire serialization stays snake_case and drops unset keys.
        dumped = t.model_dump(exclude_none=True)["layers"][0]
        self.assertEqual(dumped["geometry"]["width_percent"], 85)
        self.assertIn("opacity_percent", dumped["style"])
        self.assertNotIn("blur_radius", dumped["style"])

    def test_worker_accepts_optional_free_layer_coordinates(self):
        layer = solid_layer(geometry={
            "width_percent": 40,
            "height_percent": 20,
            "x_percent": 25,
            "y_percent": 70,
        })
        self.assertEqual(layer.geometry.x_percent, 25)
        self.assertEqual(layer.geometry.y_percent, 70)
        dumped = layer.model_dump(exclude_none=True)
        self.assertEqual(dumped["geometry"]["x_percent"], 25)
        self.assertEqual(dumped["geometry"]["y_percent"], 70)

    def test_worker_accepts_outline_fields_on_track(self):
        t = track(outline_width=4, outline_color="#ABCDEF")
        self.assertEqual(t.outline_width, 4)
        self.assertEqual(t.outline_color, "#ABCDEF")

    def test_worker_rejects_malformed_layer_style_xor(self):
        # SOLID carrying a BLUR key → reject.
        with self.assertRaises(ValidationError):
            solid_layer(style={"color": "#101010", "opacity_percent": 55,
                               "blur_radius": 5})
        # BLUR carrying SOLID keys → reject.
        with self.assertRaises(ValidationError):
            blur_layer(style={"color": "#101010", "blur_radius": 5})
        # BLUR without a radius → reject.
        with self.assertRaises(ValidationError):
            blur_layer(style={"color": None})
        # Non-SOLID/BLUR type → reject at the enum.
        with self.assertRaises(ValidationError):
            solid_layer(type="GRADIENT")

    def test_worker_rejects_unknown_layer_keys_fail_closed(self):
        with self.assertRaises(ValidationError):
            solid_layer(padding_percent=2)
        with self.assertRaises(ValidationError):
            solid_layer(style={"mystery": 1})

    def test_worker_rejects_bad_id_anchor_and_geometry(self):
        with self.assertRaises(ValidationError):
            solid_layer(id="Cover!")
        with self.assertRaises(ValidationError):
            solid_layer(anchor="FREEFORM")
        with self.assertRaises(ValidationError):
            solid_layer(geometry={"width_percent": 10, "height_percent": 12})
        with self.assertRaises(ValidationError):
            solid_layer(style={"color": "red", "opacity_percent": 50})

    def test_worker_rejects_more_than_four_layers(self):
        with self.assertRaises(ValidationError):
            track(layers=[
                solid_layer(id=f"layer-{i}", z_index=i) for i in range(5)
            ])

    def test_worker_still_accepts_pure_v1_track_without_v2_fields(self):
        # Wire compatibility: a v1-shaped track (no colors/outline/layers)
        # validates exactly as before the V2 extension.
        t = track()
        self.assertIsNone(t.layers)
        self.assertIsNone(t.outline_width)
        self.assertIsNone(t.background_color)


if __name__ == "__main__":
    unittest.main()
