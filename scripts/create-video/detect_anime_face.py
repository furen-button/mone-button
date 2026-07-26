#!/usr/bin/env python3
import argparse
import json
import sys


def load_cv2():
    try:
        import cv2  # pylint: disable=import-error
    except ImportError:
        print('opencv-python-headless<5 が必要です: pip install "opencv-python-headless<5"', file=sys.stderr)
        sys.exit(2)

    if not hasattr(cv2, 'CascadeClassifier'):
        print('opencv-python-headless<5 が必要です: pip install "opencv-python-headless<5"', file=sys.stderr)
        sys.exit(2)
    return cv2


def parse_args():
    parser = argparse.ArgumentParser(description='Detect anime faces with lbpcascade_animeface.')
    parser.add_argument('--cascade', required=True, help='Path to lbpcascade_animeface.xml')
    parser.add_argument('images', nargs='+', help='Image files to inspect')
    return parser.parse_args()


def detect_faces(cv2, cascade_path, image_path):
    image = cv2.imread(image_path)
    if image is None:
        return []

    gray = cv2.cvtColor(image, cv2.COLOR_BGR2GRAY)
    gray = cv2.equalizeHist(gray)
    faces = cascade_path.detectMultiScale(
        gray,
        scaleFactor=1.1,
        minNeighbors=5,
        minSize=(24, 24),
    )
    return [
        {'x': int(x), 'y': int(y), 'w': int(w), 'h': int(h)}
        for (x, y, w, h) in faces
    ]


def main():
    args = parse_args()
    cv2 = load_cv2()
    cascade = cv2.CascadeClassifier(args.cascade)
    if cascade.empty():
        print(f'カスケードを読み込めません: {args.cascade}', file=sys.stderr)
        sys.exit(1)

    results = [
        {'file': image_path, 'faces': detect_faces(cv2, cascade, image_path)}
        for image_path in args.images
    ]
    print(json.dumps(results, ensure_ascii=False))


if __name__ == '__main__':
    main()
