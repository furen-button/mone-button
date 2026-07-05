import { useMemo } from 'react'

// 背景装飾（花びら・きらめき）。props を持たない自己完結のプレゼンテーション層。
export function AmbientLayer() {
  const petals = useMemo(
    () =>
      Array.from({ length: 10 }, (_, index) => ({
        id: `petal-${index}`,
        left: `${(index * 11 + 7) % 100}%`,
        top: `${(index * 13 + 9) % 100}%`,
        size: `${12 + (index % 4) * 4}px`,
        delay: `${-index * 0.8}s`,
        duration: `${10 + (index % 3) * 2}s`,
      })),
    [],
  )

  const sparkles = useMemo(
    () =>
      Array.from({ length: 8 }, (_, index) => ({
        id: `sparkle-${index}`,
        left: `${(index * 17 + 12) % 100}%`,
        top: `${(index * 19 + 8) % 100}%`,
        size: `${6 + (index % 3) * 3}px`,
        delay: `${-index * 0.6}s`,
        duration: `${7 + (index % 4)}s`,
      })),
    [],
  )

  return (
    <div className="ambient-layer" aria-hidden="true">
      {petals.map((petal) => (
        <span
          className="petal"
          key={petal.id}
          style={{
            left: petal.left,
            top: petal.top,
            width: petal.size,
            height: petal.size,
            animationDelay: petal.delay,
            animationDuration: petal.duration,
          }}
        />
      ))}
      {sparkles.map((sparkle) => (
        <span
          className="sparkle"
          key={sparkle.id}
          style={{
            left: sparkle.left,
            top: sparkle.top,
            width: sparkle.size,
            height: sparkle.size,
            animationDelay: sparkle.delay,
            animationDuration: sparkle.duration,
          }}
        />
      ))}
    </div>
  )
}
