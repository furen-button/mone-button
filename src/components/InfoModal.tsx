import type { VoiceClip } from '../voiceData'
import { formatUploadDate } from '../voiceData'
import { t } from '../i18n'
import { useLocale } from '../i18n'

type InfoModalProps = {
  clip: VoiceClip
  onClose: () => void
  onClickClipLink: (linkType: 'clip', clip: VoiceClip) => void
  onClickSourceVideoLink: (linkType: 'source_video', clip: VoiceClip) => void
  // dev 限定: 指定された場合のみ「編集」ボタンを表示する（本番では未指定）。
  onEdit?: (clip: VoiceClip) => void
}

export function InfoModal({ clip, onClose, onClickClipLink, onClickSourceVideoLink, onEdit }: InfoModalProps) {
  const locale = useLocale()

  return (
    <div className="info-modal-backdrop" role="presentation" onClick={onClose}>
      <section
        className="info-modal"
        role="dialog"
        aria-modal="true"
        aria-label={t('infoModal.title', {}, locale)}
        onClick={(event) => event.stopPropagation()}
      >
        <h2 className="info-modal-title">{t('infoModal.title', {}, locale)}</h2>
        <p className="info-modal-video-title">{clip.videoFile.metadata.title}</p>
        <p className="info-modal-date">{t('infoModal.uploadDate', { date: formatUploadDate(clip.videoFile.metadata.uploadDate) }, locale)}</p>
        <dl className="info-modal-meta">
          <div className="info-modal-row">
            <dt>{t('infoModal.serif', {}, locale)}</dt>
            <dd>{clip.serif}</dd>
          </div>
          <div className="info-modal-row">
            <dt>{t('infoModal.ruby', {}, locale)}</dt>
            <dd>{clip.ruby}</dd>
          </div>
          <div className="info-modal-row">
            <dt>{t('infoModal.category', {}, locale)}</dt>
            <dd>{clip.categories.join(' / ')}</dd>
          </div>
        </dl>
        <a
          className="info-modal-link"
          href={clip.clipUrl}
          target="_blank"
          rel="noreferrer"
          onClick={() => onClickClipLink('clip', clip)}
        >
          {t('infoModal.openClip', {}, locale)}
        </a>
        <a
          className="info-modal-link"
          href={clip.videoFile.metadata.url}
          target="_blank"
          rel="noreferrer"
          onClick={() => onClickSourceVideoLink('source_video', clip)}
        >
          {t('infoModal.openVideo', {}, locale)}
        </a>
        {onEdit ? (
          <button type="button" className="info-modal-edit" onClick={() => onEdit(clip)}>
            🔧 編集（DEV）
          </button>
        ) : null}
        <button type="button" className="info-modal-close" onClick={onClose}>
          {t('infoModal.close', {}, locale)}
        </button>
      </section>
    </div>
  )
}