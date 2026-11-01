// 顔の枠（前髪付近）より上の範囲にセリフを収める。値は manifest / still と共有する出力px。
export function planSerifRange({ config, reframe = null, size }) {
  const setting = config.telops?.serif?.faceRange;
  if (!setting?.enabled || config.telops.serif.layout !== 'space-lines') {
    return null;
  }
  const top = size.height * setting.top;
  let faceTop = null;
  if (reframe?.applied && !reframe.fallback && reframe.faceHeight > 0) {
    if (reframe.frame && reframe.from && reframe.focus) {
      faceTop = (reframe.focus.y * reframe.from.height - reframe.faceHeight * reframe.from.height / 2 - reframe.frame.y)
        * size.height / reframe.frame.h;
    } else if (reframe.target && reframe.zoom > 0) {
      faceTop = (reframe.target.y - reframe.faceHeight * reframe.zoom / 2) * size.height;
    }
  }
  const rawHeight = faceTop === null ? size.height * setting.fallbackBottom - top : faceTop - top;
  const height = faceTop === null ? rawHeight : Math.max(size.height * setting.minHeight, Math.min(size.height * setting.maxHeight, rawHeight));
  return {
    source: faceTop === null ? 'fallback' : 'face',
    faceTop,
    top,
    bottom: top + height,
    height,
    clamped: faceTop === null ? null : (rawHeight < height ? 'min' : (rawHeight > height ? 'max' : null)),
  };
}

export function serifRangeOverrides(range, size, margins = {}) {
  if (!range) {
    return {};
  }
  return {
    align: 'center',
    textPos: { x: ((margins.marginL ?? 0) + size.width - (margins.marginR ?? 0)) / 2, y: (range.top + range.bottom) / 2 },
    maxHeight: range.height / size.height,
  };
}
