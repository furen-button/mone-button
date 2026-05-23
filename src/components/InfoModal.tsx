import type { VoiceClip } from '../voiceData'
import { formatUploadDate } from '../voiceData'

type InfoModalProps = {
  clip: VoiceClip
  onClose: () => void
}

export function InfoModal({ clip, onClose }: InfoModalProps) {
  return (
    <div className="info-modal-backdrop" role="presentation" onClick={onClose}>
      <section
        className="info-modal"
        role="dialog"
        aria-modal="true"
        aria-label="元動画情報"
        onClick={(event) => event.stopPropagation()}
      >
        <h2 className="info-modal-title">元動画情報</h2>
        <p className="info-modal-video-title">{clip.videoFile.metadata.title}</p>
        <p className="info-modal-date">配信日: {formatUploadDate(clip.videoFile.metadata.uploadDate)}</p>
        <dl className="info-modal-meta">
          <div className="info-modal-row">
            <dt>セリフ</dt>
            <dd>{clip.serif}</dd>
          </div>
          <div className="info-modal-row">
            <dt>ルビ</dt>
            <dd>{clip.ruby}</dd>
          </div>
          <div className="info-modal-row">
            <dt>カテゴリー</dt>
            <dd>{clip.categories.join(' / ')}</dd>
          </div>
        </dl>
        <a className="info-modal-link" href={clip.clipUrl} target="_blank" rel="noreferrer">
          このボイスの開始位置を開く
        </a>
        <a
          className="info-modal-link"
          href={clip.videoFile.metadata.url}
          target="_blank"
          rel="noreferrer"
        >
          元動画ページを開く
        </a>
        <button type="button" className="info-modal-close" onClick={onClose}>
          閉じる
        </button>
      </section>
    </div>
  )
}