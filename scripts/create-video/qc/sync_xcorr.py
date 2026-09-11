import argparse
import json
import wave

import numpy as np


def read_wav(path):
    with wave.open(path, "rb") as wav:
        rate = wav.getframerate()
        channels = wav.getnchannels()
        width = wav.getsampwidth()
        frames = wav.readframes(wav.getnframes())

    if width == 2:
        audio = np.frombuffer(frames, dtype=np.int16).astype(np.float32) / 32768.0
    elif width == 4:
        audio = np.frombuffer(frames, dtype=np.int32).astype(np.float32) / 2147483648.0
    else:
        audio = np.frombuffer(frames, dtype=np.uint8).astype(np.float32)
        audio = (audio - 128.0) / 128.0

    if channels > 1:
        audio = audio.reshape((-1, channels)).mean(axis=1)
    audio = audio - float(np.mean(audio))
    return rate, audio


def next_power_of_two(value):
    return 1 << (int(value) - 1).bit_length()


def best_offset(source, target, rate):
    if len(source) == 0 or len(target) < len(source):
        return None

    source_energy = float(np.sum(source * source))
    if source_energy <= 1e-9:
        return None

    n = len(source)
    size = next_power_of_two(len(target) + n - 1)
    corr = np.fft.irfft(
        np.fft.rfft(target, size) * np.fft.rfft(source[::-1], size),
        size,
    )
    valid = corr[n - 1:len(target)]
    window_energy = np.cumsum(np.concatenate(([0.0], target * target)))
    window_energy = window_energy[n:] - window_energy[:-n]
    denom = np.sqrt(np.maximum(window_energy, 1e-12) * source_energy)
    score = valid / denom
    index = int(np.argmax(score))
    return {
        "targetOffsetSec": index / rate,
        "correlation": float(score[index]),
    }


def main():
    parser = argparse.ArgumentParser(description="createVideo QC 音声相互相関")
    parser.add_argument("--source", required=True)
    parser.add_argument("--target", required=True)
    args = parser.parse_args()

    source_rate, source = read_wav(args.source)
    target_rate, target = read_wav(args.target)
    if source_rate != target_rate:
        raise SystemExit("sample rate mismatch")

    result = best_offset(source, target, source_rate)
    if result is None:
        result = {"targetOffsetSec": None, "correlation": 0.0}
    print(json.dumps(result, ensure_ascii=False))


if __name__ == "__main__":
    main()
