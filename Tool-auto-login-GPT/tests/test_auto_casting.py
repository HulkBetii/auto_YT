import unittest

from auto_yt.services import auto_casting
from auto_yt.services.voice_config import normalize_casting_profile


def _voice(
    voice_id: str,
    *,
    gender: str = "any",
    age_group: str = "any",
    roles: list[str] | None = None,
    styles: list[str] | None = None,
    auto_cast: bool = True,
) -> dict:
    return {
        "id": voice_id,
        "name": voice_id,
        "status": "active",
        "casting_profile": {
            "gender": gender,
            "age_group": age_group,
            "languages": ["vi"],
            "roles": roles or ["guest"],
            "styles": styles or [],
            "auto_cast": auto_cast,
        },
    }


class TestAutomaticCasting(unittest.TestCase):
    def setUp(self):
        self.voices = [
            _voice("mc-fixed", roles=["mc"], auto_cast=False),
            _voice("female-young", gender="female", age_group="young", styles=["warm"]),
            _voice("male-senior", gender="male", age_group="senior", styles=["serious"]),
            _voice("female-backup", gender="female", age_group="young"),
        ]
        script = "[MC]: Xin chào.\n[LAN]: Em xin chào.\n[ONG_NAM]: Tôi xin chia sẻ."
        self.manifest = auto_casting.build_speaker_manifest(
            script,
            provided_manifest={
                "speakers": [
                    {
                        "speaker_key": "LAN",
                        "name": "Lan",
                        "gender": "female",
                        "age_group": "young",
                        "styles": ["warm"],
                        "confidence": 0.95,
                    },
                    {
                        "speaker_key": "ONG_NAM",
                        "name": "Ông Nam",
                        "gender": "male",
                        "age_group": "senior",
                        "styles": ["serious"],
                        "confidence": 0.9,
                    },
                ]
            },
        )

    def test_profile_cast_keeps_fixed_mc_and_distinct_matching_guests(self):
        assignments = auto_casting.assign_cast(
            self.manifest,
            self.voices,
            mc_voice_id="mc-fixed",
        )
        by_speaker = {item["speaker_key"]: item for item in assignments}
        self.assertEqual(by_speaker["MC"]["voice_id"], "mc-fixed")
        self.assertEqual(by_speaker["LAN"]["voice_id"], "female-young")
        self.assertEqual(by_speaker["ONG_NAM"]["voice_id"], "male-senior")
        self.assertEqual(len({item["voice_id"] for item in assignments}), 3)

    def test_named_speaker_registry_wins_when_profile_still_matches(self):
        assignments = auto_casting.assign_cast(
            self.manifest,
            self.voices,
            mc_voice_id="mc-fixed",
            registry={"LAN": {"voice_id": "female-backup"}},
        )
        lan = next(item for item in assignments if item["speaker_key"] == "LAN")
        self.assertEqual(lan["voice_id"], "female-backup")
        self.assertEqual(lan["source"], "registry")

    def test_missing_distinct_guest_voice_requires_attention(self):
        with self.assertRaises(auto_casting.AutoCastingAttentionRequired):
            auto_casting.assign_cast(
                self.manifest,
                [self.voices[0], self.voices[1]],
                mc_voice_id="mc-fixed",
            )

    def test_inactive_or_opted_out_voice_is_never_auto_cast(self):
        opted_out = _voice("guest-disabled", auto_cast=False)
        normalized = normalize_casting_profile(opted_out["casting_profile"])
        self.assertFalse(normalized["auto_cast"])
        guest_manifest = [
            {"speaker_key": "MC", "speaker_name": "MC", "role": "mc"},
            {
                "speaker_key": "GUEST",
                "speaker_name": "Guest",
                "role": "guest",
                "gender": "any",
                "age_group": "any",
                "language": "vi",
                "styles": [],
                "confidence": 0.3,
            },
        ]
        with self.assertRaises(auto_casting.AutoCastingAttentionRequired):
            auto_casting.assign_cast(
                guest_manifest,
                [self.voices[0], opted_out],
                mc_voice_id="mc-fixed",
            )


if __name__ == "__main__":
    unittest.main()
