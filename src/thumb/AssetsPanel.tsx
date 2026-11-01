import { useRef, useState } from 'react'
import type { Assets, Clip, Frame } from './api'
import { api, assetUrl, upload } from './api'
import { FONTS } from './fonts'
export function AssetsPanel({
  assets,
  clips,
  onImage,
  onError,
  onNotice,
}: {
  assets: Assets
  clips: Clip[]
  onImage: (src: string, frame?: Frame) => void
  onError: (message: string) => void
  onNotice: (message: string) => void
}) {
  const [tab, setTab] = useState('frame')
  const [kind, setKind] = useState('')
  const [source, setSource] = useState('')
  const [anime, setAnime] = useState(true)
  const [busy, setBusy] = useState(false)
  const video = useRef<HTMLVideoElement>(null)
  async function selectFrame() {
    setBusy(true)
    try {
      video.current?.pause()
      const frame = await api<Frame>('frame', {
        source,
        at: video.current?.currentTime || 0,
        upscale: anime ? 'anime4k' : 'none',
      })
      onImage(frame.src, frame)
      if (frame.fallback) {
        onNotice(`Lanczos で描画: ${frame.reason}`)
      }
    } catch (error) {
      onError(String(error))
    } finally {
      setBusy(false)
    }
  }
  async function uploadFile(file?: File) {
    if (!file) {
      return
    }
    setBusy(true)
    try {
      const result = await upload(`image?name=${encodeURIComponent(file.name)}`, file)
      onImage(result.src)
    } catch (error) {
      onError(String(error))
    } finally {
      setBusy(false)
    }
  }
  return (
    <section className="th-assets">
      <h2>素材</h2>
      <nav>
        {[
          ['frame', 'コマ'],
          ['face', 'もね'],
          ['image', '画像'],
          ['font', 'フォント'],
        ].map(([id, title]) => (
          <button key={id} aria-pressed={tab === id} onClick={() => setTab(id)}>
            {title}
          </button>
        ))}
      </nav>
      {tab === 'frame' && (
        <>
          <select
            aria-label="クリップ"
            value={clips.some((c) => c.source === source) ? source : ''}
            onChange={(e) => setSource(e.target.value)}
          >
            <option value="">クリップを選択</option>
            {clips.map((clip) => (
              <option key={clip.base} value={clip.source || clip.base} disabled={!clip.source}>
                {clip.serif || clip.base}
                {!clip.source ? '（高画質キャッシュ無し）' : ''}
              </option>
            ))}
          </select>
          {source && (
            <video
              ref={video}
              key={source}
              controls
              preload="metadata"
              src={`/__cv/file?kind=crop-source&name=${encodeURIComponent(source)}`}
            />
          )}
          <label>
            <input type="checkbox" checked={anime} onChange={(e) => setAnime(e.target.checked)} />
            Anime4K で拡大
          </label>
          <button disabled={!source || busy} onClick={() => void selectFrame()}>
            このコマを使う
          </button>
        </>
      )}
      {tab === 'face' && (
        <>
          <select aria-label="切り抜きの種類" value={kind} onChange={(e) => setKind(e.target.value)}>
            <option value="">全種類</option>
            {[...new Set(assets.faces.map((f) => f.kind))].map((v) => (
              <option key={v}>{v}</option>
            ))}
          </select>
          <div className="th-faceGrid">
            {assets.faces
              .filter((f) => !kind || f.kind === kind)
              .map((face) => (
                <button key={face.src} title={`${face.kind} / 評価 ${face.rating}`} onClick={() => onImage(face.src)}>
                  <img loading="lazy" src={assetUrl(face.preview)} alt={`${face.kind} ★${face.rating}`} />
                </button>
              ))}
          </div>
        </>
      )}
      {tab === 'image' && (
        <div
          className="th-drop"
          onDragOver={(e) => e.preventDefault()}
          onDrop={(e) => {
            e.preventDefault()
            void uploadFile(e.dataTransfer.files[0])
          }}
        >
          <p>PNG / JPEG / WebP をドロップ（20MBまで）</p>
          <input
            type="file"
            accept="image/png,image/jpeg,image/webp"
            disabled={busy}
            onChange={(e) => void uploadFile(e.target.files?.[0])}
          />
          <div className="th-faceGrid">
            {assets.images.map((image) => (
              <button key={image.src} onClick={() => onImage(image.src)}>
                <img src={assetUrl(image.src)} alt="アップロード画像" />
              </button>
            ))}
          </div>
        </div>
      )}
      {tab === 'font' &&
        FONTS.map((font) => (
          <p key={font.family}>
            <a href={font.specimen} target="_blank" rel="noreferrer">
              {font.family}
            </a>
            <small>
              {font.license} / {font.weights.join(', ')}
            </small>
          </p>
        ))}
      {busy && <p role="status">素材を準備しています…</p>}
    </section>
  )
}
