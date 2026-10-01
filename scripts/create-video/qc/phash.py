import argparse
import json
import sys

try:
    import cv2
    import numpy as np
except Exception:
    sys.exit(2)


def read_image(path):
    image = cv2.imread(path, cv2.IMREAD_COLOR)
    if image is None:
        raise SystemExit(f"画像を読めません: {path}")
    return image


def phash(path):
    image = read_image(path)
    gray = cv2.cvtColor(image, cv2.COLOR_BGR2GRAY)
    resized = cv2.resize(gray, (32, 32), interpolation=cv2.INTER_AREA)
    dct = cv2.dct(np.float32(resized))
    block = dct[:8, :8]
    values = block.flatten()[1:]
    median = np.median(values)
    return values > median


def compare(args):
    left = phash(args.left)
    right = phash(args.right)
    distance = int(np.count_nonzero(left != right))
    print(json.dumps({"distance": distance}, ensure_ascii=False))


def parse_rgb(value):
    raw = str(value).strip().lstrip("#")
    if len(raw) != 6:
        raise SystemExit(f"色は RGB 6 桁 hex で指定してください: {value}")
    return np.array([int(raw[4:6], 16), int(raw[2:4], 16), int(raw[0:2], 16)], dtype=np.float32)


def fill(args):
    image = read_image(args.image).astype(np.float32)
    color = parse_rgb(args.color)
    distance = np.linalg.norm(image - color, axis=2)
    ratio = float(np.count_nonzero(distance <= args.distance) / distance.size)
    print(json.dumps({"ratio": ratio}, ensure_ascii=False))


def main():
    parser = argparse.ArgumentParser(description="createVideo QC pHash / 色一致率")
    subparsers = parser.add_subparsers(dest="command", required=True)

    compare_parser = subparsers.add_parser("compare")
    compare_parser.add_argument("--left", required=True)
    compare_parser.add_argument("--right", required=True)
    compare_parser.set_defaults(func=compare)

    fill_parser = subparsers.add_parser("fill")
    fill_parser.add_argument("--image", required=True)
    fill_parser.add_argument("--color", required=True)
    fill_parser.add_argument("--distance", type=float, required=True)
    fill_parser.set_defaults(func=fill)

    args = parser.parse_args()
    args.func(args)


if __name__ == "__main__":
    main()
