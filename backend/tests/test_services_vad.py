import pytest
import numpy as np

pytestmark = pytest.mark.unit

from services_vad import EnergySpeechDetector, VadConfig, VadUtteranceSegmenter


def _pcm_frame(*, frame_samples: int, amp: int) -> bytes:
    samples = np.full((frame_samples,), int(amp), dtype=np.int16)
    return samples.tobytes()


def test_vad_segmenter_emits_on_silence_gap():
    cfg = VadConfig(
        sample_rate_hz=16000,
        frame_ms=20,
        speech_threshold=0.5,
        end_silence_ms=200,
        min_speech_ms=100,
        pre_roll_ms=0,
        max_utterance_ms=5000,
        engine="energy",
    )
    detector = EnergySpeechDetector(gain=20.0)
    seg = VadUtteranceSegmenter(detector, cfg)

    frame_samples = int(cfg.sample_rate_hz * cfg.frame_ms / 1000)
    silence = _pcm_frame(frame_samples=frame_samples, amp=0)
    speech = _pcm_frame(frame_samples=frame_samples, amp=6000)

    # 100ms silence (no start)
    out = []
    for _ in range(5):
        out += seg.process_pcm16(silence)
    assert out == []

    # 200ms speech
    for _ in range(10):
        out += seg.process_pcm16(speech)
    assert out == []

    # 240ms silence -> should close utterance once 200ms threshold exceeded
    for _ in range(12):
        out += seg.process_pcm16(silence)

    assert len(out) == 1
    utt = out[0]
    assert utt.speech_ms == 200

    expected_start = 5 * frame_samples
    expected_end = (5 + 10) * frame_samples
    assert utt.start_sample == expected_start
    assert utt.end_sample == expected_end
    assert len(utt.pcm16) > 0


def test_vad_segmenter_drops_too_short_noise():
    cfg = VadConfig(
        sample_rate_hz=16000,
        frame_ms=20,
        speech_threshold=0.5,
        end_silence_ms=200,
        min_speech_ms=100,
        pre_roll_ms=0,
        max_utterance_ms=5000,
        engine="energy",
    )
    detector = EnergySpeechDetector(gain=20.0)
    seg = VadUtteranceSegmenter(detector, cfg)

    frame_samples = int(cfg.sample_rate_hz * cfg.frame_ms / 1000)
    silence = _pcm_frame(frame_samples=frame_samples, amp=0)
    speech = _pcm_frame(frame_samples=frame_samples, amp=6000)

    # One 20ms "speech" blip, then enough silence to end -> should be dropped (< min_speech_ms).
    out = []
    out += seg.process_pcm16(speech)
    for _ in range(12):
        out += seg.process_pcm16(silence)
    assert out == []


def test_vad_segmenter_force_ends_long_utterance():
    cfg = VadConfig(
        sample_rate_hz=16000,
        frame_ms=20,
        speech_threshold=0.5,
        end_silence_ms=1000,  # large so we only force-end
        min_speech_ms=100,
        pre_roll_ms=0,
        max_utterance_ms=220,
        engine="energy",
    )
    detector = EnergySpeechDetector(gain=20.0)
    seg = VadUtteranceSegmenter(detector, cfg)

    frame_samples = int(cfg.sample_rate_hz * cfg.frame_ms / 1000)
    speech = _pcm_frame(frame_samples=frame_samples, amp=6000)

    out = []
    # 20ms * 12 = 240ms; should force-end once >=220ms.
    for _ in range(12):
        out += seg.process_pcm16(speech)

    assert len(out) >= 1
    assert out[0].speech_ms >= 100


def test_vad_segmenter_emits_stable_speech_start_once():
    cfg = VadConfig(
        sample_rate_hz=16000,
        frame_ms=20,
        speech_threshold=0.5,
        end_silence_ms=300,
        min_speech_ms=100,
        pre_roll_ms=0,
        max_utterance_ms=5000,
        engine="energy",
    )
    detector = EnergySpeechDetector(gain=20.0)
    seg = VadUtteranceSegmenter(detector, cfg)

    frame_samples = int(cfg.sample_rate_hz * cfg.frame_ms / 1000)
    speech = _pcm_frame(frame_samples=frame_samples, amp=6000)

    start_events = []
    for _ in range(8):
        seg.process_pcm16(speech)
        start_events.append(seg.pop_speech_start_sample())

    emitted = [s for s in start_events if s is not None]
    assert len(emitted) == 1
    assert emitted[0] == 0


def test_vad_segmenter_ignores_short_noise_for_speech_start():
    cfg = VadConfig(
        sample_rate_hz=16000,
        frame_ms=20,
        speech_threshold=0.5,
        end_silence_ms=200,
        min_speech_ms=100,
        pre_roll_ms=0,
        max_utterance_ms=5000,
        engine="energy",
    )
    detector = EnergySpeechDetector(gain=20.0)
    seg = VadUtteranceSegmenter(detector, cfg)

    frame_samples = int(cfg.sample_rate_hz * cfg.frame_ms / 1000)
    silence = _pcm_frame(frame_samples=frame_samples, amp=0)
    speech = _pcm_frame(frame_samples=frame_samples, amp=6000)

    seg.process_pcm16(speech)  # 20ms blip (< min_speech_ms)
    assert seg.pop_speech_start_sample() is None
    for _ in range(12):
        seg.process_pcm16(silence)
        assert seg.pop_speech_start_sample() is None
