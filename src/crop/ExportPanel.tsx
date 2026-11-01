import type { JobSummary } from '../editor/types'
import type { CropStillMeta, Scaler } from './types'

export type SourceOption = { source: string; label: string }

type Props = {
  sizes: string[]
  size: string
  onSize: (size: string) => void
  scaler: Scaler
  onScaler: (scaler: Scaler) => void
  sourceOptions: SourceOption[]
  source: string | null
  onSource: (source: string) => void
  // 書き出せない理由（null なら書き出せる）。
  blocked: string | null
  job: JobSummary | null
  resultUrl: string | null
  onExport: () => void
  onCancel: () => void
  still: { url: string; meta: CropStillMeta } | null
  stillBusy: boolean
  onStill: () => void
}

// 書き出しと「高画質で確認」。書き出しは createVideo のビルドと同じジョブで 1 本ずつ走る。
export function ExportPanel(props: Props) {
  const { job } = props
  const running = job?.state === 'running'
  const percent = job?.progress ? Math.round((job.progress.i / Math.max(1, job.progress.n)) * 100) : 0
  return (
    <section className="cr-panel" aria-label="書き出し">
      <h2>書き出し</h2>
      <div className="cr-fieldGrid">
        <label className="cr-field">
          <span>サイズ</span>
          <select value={props.size} onChange={(event) => props.onSize(event.target.value)}>
            {props.sizes.map((size) => <option key={size} value={size}>{size.replace('x', '×')}</option>)}
          </select>
        </label>
        <label className="cr-field">
          <span>拡大</span>
          <select value={props.scaler} onChange={(event) => props.onScaler(event.target.value as Scaler)}>
            <option value="anime4k">Anime4K（線を整える）</option>
            <option value="lanczos">Lanczos（速い）</option>
          </select>
        </label>
        {props.sourceOptions.length > 0 && (
          <label className="cr-field cr-fieldWide">
            <span>元にする動画</span>
            <select value={props.source ?? ''} onChange={(event) => props.onSource(event.target.value)}>
              {props.sourceOptions.map((option) => <option key={option.source} value={option.source}>{option.label}</option>)}
            </select>
          </label>
        )}
      </div>
      <div className="cr-buttons">
        <button type="button" onClick={props.onStill} disabled={Boolean(props.blocked) || props.stillBusy}>
          {props.stillBusy ? '描画中…' : '高画質で確認'}
        </button>
        {running ? (
          <button type="button" className="cr-danger" onClick={props.onCancel}>止める</button>
        ) : (
          <button type="button" className="cr-primary" onClick={props.onExport} disabled={Boolean(props.blocked)}>書き出す</button>
        )}
      </div>
      {props.blocked && <p className="cr-note">{props.blocked}</p>}
      {job && (
        <div className="cr-job">
          <progress max={100} value={job.state === 'done' ? 100 : percent} />
          <span>{jobStateLabel(job.state)} {running ? `${percent}%` : ''}</span>
          {job.error && <p className="cr-error">{job.error}</p>}
        </div>
      )}
      {props.resultUrl && (
        <div className="cr-result">
          <video src={props.resultUrl} controls playsInline className="cr-resultVideo" />
          <p className="cr-note">{job?.outPath}</p>
        </div>
      )}
      {props.still && (
        <figure className="cr-still">
          <img src={props.still.url} alt="高画質の確認画像" />
          <figcaption>
            {props.still.meta.enhance ? 'Anime4K' : 'Lanczos'} · {props.still.meta.backend}
            {props.still.meta.backend === 'sendcmd' ? '（libplacebo が使えないため整数 px の切り出し）' : ''}
            {' · '}{props.still.meta.cached ? 'キャッシュ' : `${props.still.meta.ms}ms`}
          </figcaption>
        </figure>
      )}
    </section>
  )
}

const JOB_STATE_LABELS: Record<JobSummary['state'], string> = {
  running: '書き出し中',
  done: '完了',
  error: '失敗',
  cancelled: '中止',
}

function jobStateLabel(state: JobSummary['state']): string {
  return JOB_STATE_LABELS[state]
}
