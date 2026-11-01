import { useCallback, useEffect, useRef, useState } from 'react'
import { applyTemplate, normalizeProject } from '../../scripts/create-video/thumbnail.js'
import type { Layer, Project } from '../../scripts/create-video/thumbnail.js'
import { api, upload } from './api'
import type { Assets, Clip, Context, Frame, Template } from './api'
import { exportProject } from './render'
import { Stage } from './Stage'
import type { Edit } from './Stage'
import { AssetsPanel } from './AssetsPanel'
import { LayersPanel } from './LayersPanel'
import { PropertiesPanel } from './PropertiesPanel'
const EMPTY: Project = { version: 1, size: { width: 1280, height: 720 }, layers: [] }
type Output = { base: string; reviewed: boolean; thumbnail: boolean }
function inputFocused(target: EventTarget | null) {
  return (
    target instanceof HTMLElement &&
    (['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName) || target.isContentEditable)
  )
}
async function restoreFrames(project: Project, notice: (message: string) => void) {
  const result = structuredClone(project)
  for (const l of result.layers) {
    if (l.type !== 'image' || !l.recipe) {
      continue
    }
    const frame = await api<Frame>('frame', l.recipe)
    l.src = frame.src
    if (frame.fallback) {
      notice(`Lanczos で描画: ${frame.reason}`)
    }
  }
  return result
}
export function ThumbApp() {
  const [project, setProject] = useState<Project>(EMPTY)
  const current = useRef(project)
  const history = useRef<{ past: Project[]; future: Project[] }>({ past: [], future: [] })
  const gesture = useRef<Project | null>(null)
  const generation = useRef(0)
  const [assets, setAssets] = useState<Assets>({ faces: [], images: [], templates: [] })
  const [outputs, setOutputs] = useState<Output[]>([])
  const [clips, setClips] = useState<Clip[]>([])
  const [base, setBase] = useState('')
  const [name, setName] = useState('もねのサムネイル')
  const [templateName, setTemplateName] = useState('kirinuki-left-title')
  const [saveTemplateName, setSaveTemplateName] = useState('my-thumbnail')
  const [selected, setSelected] = useState<string | null>(null)
  const [safeArea, setSafeArea] = useState(true)
  const [format, setFormat] = useState<'jpg' | 'png'>('jpg')
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const [busy, setBusy] = useState(false)
  const [initialized, setInitialized] = useState(false)
  const onError = useCallback((message: string) => setError(message), [])
  function assign(next: Project) {
    current.current = next
    setProject(next)
  }
  function change(next: Project) {
    const normalized = normalizeProject(next)
    if (JSON.stringify(normalized) === JSON.stringify(current.current)) {
      return
    }
    history.current.past = [...history.current.past, current.current].slice(-50)
    history.current.future = []
    assign(normalized)
  }
  function undo(redo = false) {
    const h = history.current
    const from = redo ? h.future : h.past
    const to = redo ? h.past : h.future
    const next = from.pop()
    if (next) {
      to.push(current.current)
      assign(next)
    }
  }
  const edit: Edit = (id, patch, phase) => {
    if (phase === 'start') {
      gesture.current = current.current
      return
    }
    if (phase === 'end') {
      const previous = gesture.current
      gesture.current = null
      if (previous && JSON.stringify(previous) !== JSON.stringify(current.current)) {
        history.current.past = [...history.current.past, previous].slice(-50)
        history.current.future = []
      }
      return
    }
    const next = {
      ...current.current,
      layers: current.current.layers.map((l) => (l.id === id ? ({ ...l, ...patch } as Layer) : l)),
    }
    if (phase === 'move') {
      assign(normalizeProject(next))
    } else {
      change(next)
    }
  }
  function remove() {
    change({ ...current.current, layers: current.current.layers.filter((l) => l.id !== selected || l.locked) })
    setSelected(null)
  }
  // 入力中は編集キーを奪わない。ポインタ操作は pointerup で履歴を1件にまとめる。
  const keyActions = useRef({ undo, remove, selected, edit })
  useEffect(() => {
    keyActions.current = { undo, remove, selected, edit }
  })
  useEffect(() => {
    const keydown = (e: KeyboardEvent) => {
      if (inputFocused(e.target)) {
        return
      }
      const a = keyActions.current
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'z') {
        e.preventDefault()
        a.undo(e.shiftKey)
        return
      }
      if (e.key === 'Delete' || e.key === 'Backspace') {
        e.preventDefault()
        a.remove()
        return
      }
      const l = current.current.layers.find((layer) => layer.id === a.selected)
      if (!l || l.locked) {
        return
      }
      const direction = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] }[e.key]
      if (direction) {
        e.preventDefault()
        const step = e.shiftKey ? 10 : 1
        a.edit(l.id, { x: l.x + direction[0] * step, y: l.y + direction[1] * step })
      }
    }
    window.addEventListener('keydown', keydown)
    return () => window.removeEventListener('keydown', keydown)
  }, [])
  async function openOutput(output: string, template: Template | undefined, available: Assets, forceTemplate = false) {
    const token = ++generation.current
    setBusy(true)
    setError('')
    setNotice('')
    setBase(output)
    try {
      const context = output
        ? await api<Context>(`context?name=${encodeURIComponent(output)}`)
        : { title: '', clips: [], project: null }
      let next =
        !forceTemplate && context.project
          ? context.project
          : template
            ? applyTemplate(template.template, {
                ...(context.title ? { title: context.title } : {}),
                subtitle: context.clips[0]?.serif || 'もねの名場面',
                face: available.faces[0]?.src,
              })
            : EMPTY
      next = await restoreFrames(next, setNotice)
      const first = context.clips.find((c) => c.source)
      if (first && next.layers.some((l) => l.type === 'image' && l.slot === 'frame' && !l.src)) {
        const frame = await api<Frame>('frame', {
          source: first.source,
          at: Math.max(0, first.duration / 2),
          upscale: 'anime4k',
        })
        next = {
          ...next,
          layers: next.layers.map((l) =>
            l.type === 'image' && l.slot === 'frame' && !l.src ? { ...l, src: frame.src, recipe: frame.recipe } : l,
          ),
        }
        if (frame.fallback) {
          setNotice(`Lanczos で描画: ${frame.reason}`)
        }
      }
      if (generation.current !== token) {
        return
      }
      setClips(context.clips)
      assign(next)
      history.current = { past: [], future: [] }
      setSelected(null)
    } catch (e) {
      if (generation.current === token) {
        setError(String(e))
      }
    } finally {
      if (generation.current === token) {
        setBusy(false)
        setInitialized(true)
      }
    }
  }
  // 初期の出力・素材を読み、URL の base / template を適用する。
  useEffect(() => {
    let active = true
    void Promise.all([api<Assets>('assets'), api<Output[]>('outputs')])
      .then(([available, list]) => {
        if (!active) {
          return
        }
        setAssets(available)
        setOutputs(list)
        const params = new URLSearchParams(location.search)
        const requested = params.get('template') || 'kirinuki-left-title'
        setTemplateName(requested)
        void openOutput(
          params.get('base') || '',
          available.templates.find((t) => t.name === requested),
          available,
          params.has('template'),
        )
      })
      .catch((e: unknown) => {
        if (active) {
          setError(String(e))
        }
      })
    return () => {
      active = false
    }
    // 初回だけ。以降は出力・テンプレートの選択イベントが読み直す。
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])
  function image(src: string, frame?: Frame) {
    if (src.startsWith('image:') && !assets.images.some((i) => i.src === src)) {
      setAssets({ ...assets, images: [...assets.images, { src }] })
    }
    const selectedLayer = current.current.layers.find((l) => l.id === selected)
    const slot = src.startsWith('face:') ? 'face' : frame ? 'frame' : undefined
    const target =
      selectedLayer?.type === 'image' && !selectedLayer.locked && (!slot || selectedLayer.slot === slot)
        ? selectedLayer
        : slot
          ? current.current.layers.find((l) => l.type === 'image' && l.slot === slot && !l.locked)
          : undefined
    const patch = { src, recipe: frame?.recipe }
    if (target) {
      edit(target.id, patch)
      setSelected(target.id)
    } else {
      const next = normalizeProject({
        ...current.current,
        layers: [
          ...current.current.layers,
          {
            id: crypto.randomUUID(),
            type: 'image',
            x: 640,
            y: 360,
            scale: src.startsWith('face:') ? 0.5 : 1,
            fit: frame ? 'cover' : 'free',
            slot,
            ...patch,
          },
        ],
      })
      change(next)
      setSelected(next.layers.at(-1)!.id)
    }
  }
  function add(type: 'text' | 'rect') {
    const next = normalizeProject({
      ...current.current,
      layers: [
        ...current.current.layers,
        {
          id: crypto.randomUUID(),
          type,
          x: 300,
          y: 250,
          text: '文字を入力',
          outlines: [{ width: 10, color: '#FFFFFF' }],
        },
      ],
    })
    change(next)
    setSelected(next.layers.at(-1)!.id)
  }
  async function save() {
    setBusy(true)
    setError('')
    try {
      const snapshot = current.current
      const target = base || `name:${name}`
      const blob = await exportProject(snapshot, format)
      await api('project', { target, project: snapshot })
      await upload(`save?target=${encodeURIComponent(target)}&format=${format}`, blob)
      setNotice(`保存しました（1280×720 / ${Math.round(blob.size / 1024)}KB）`)
    } catch (e) {
      setError(String(e))
    } finally {
      setBusy(false)
    }
  }
  async function saveTemplate() {
    try {
      const template = structuredClone(current.current)
      for (const l of template.layers) {
        if (l.type === 'image') {
          delete l.recipe
          if (l.slot || !l.src?.startsWith('face:')) {
            delete l.src
          }
        }
      }
      await api('template', { name: saveTemplateName, template })
      const templates = await api<Template[]>('templates')
      setAssets({ ...assets, templates })
      setNotice('テンプレートを保存しました。')
    } catch (e) {
      setError(String(e))
    }
  }
  return (
    <main className="th-app">
      <header>
        <div>
          <span className="th-eyebrow">DEV / 1280 × 720</span>
          <h1>サムネイル工房</h1>
        </div>
        <a href="editor.html">設定エディタへ</a>
      </header>
      <div className="th-toolbar">
        <label>
          動画の出力
          <select
            disabled={busy}
            value={base}
            onChange={(e) =>
              void openOutput(
                e.target.value,
                assets.templates.find((t) => t.name === templateName),
                assets,
              )
            }
          >
            <option value="">出力を選ばない</option>
            {outputs.map((o) => (
              <option key={o.base} value={o.base}>
                {o.base}
                {o.reviewed ? '（レビュー済み）' : ''}
                {o.thumbnail ? ' ✓' : ''}
              </option>
            ))}
          </select>
        </label>
        {!base && (
          <label>
            保存名
            <input value={name} onChange={(e) => setName(e.target.value)} />
          </label>
        )}
        <label>
          テンプレート
          <select
            value={templateName}
            disabled={busy}
            onChange={(e) => {
              setTemplateName(e.target.value)
              void openOutput(
                base,
                assets.templates.find((t) => t.name === e.target.value),
                assets,
                true,
              )
            }}
          >
            {assets.templates.map((t) => (
              <option key={t.name}>{t.name}</option>
            ))}
          </select>
        </label>
        <select aria-label="保存形式" value={format} onChange={(e) => setFormat(e.target.value as 'jpg' | 'png')}>
          <option value="jpg">JPEG</option>
          <option value="png">PNG</option>
        </select>
        <button className="th-primary" disabled={busy} onClick={() => void save()}>
          保存
        </button>
      </div>
      <div className="th-actions">
        <button onClick={() => undo()}>元に戻す</button>
        <button onClick={() => undo(true)}>やり直し</button>
        <button onClick={() => add('text')}>＋文字</button>
        <button onClick={() => add('rect')}>＋図形</button>
        <label>
          <input type="checkbox" checked={safeArea} onChange={(e) => setSafeArea(e.target.checked)} />
          再生時間の範囲
        </label>
        <input
          aria-label="テンプレート保存名"
          value={saveTemplateName}
          onChange={(e) => setSaveTemplateName(e.target.value)}
        />
        <button onClick={() => void saveTemplate()}>テンプレートとして保存</button>
      </div>
      {error && (
        <p className="th-error" role="alert">
          {error}
        </p>
      )}
      {notice && (
        <p className="th-notice" role="status">
          {notice}
        </p>
      )}
      {busy && <p role="status">準備しています…</p>}
      <div className="th-workspace">
        <aside>
          <AssetsPanel
            key={base}
            assets={assets}
            clips={clips}
            onImage={image}
            onError={onError}
            onNotice={setNotice}
          />
        </aside>
        <div className="th-center">
          <Stage
            project={project}
            selected={selected}
            onSelect={setSelected}
            onEdit={edit}
            safeArea={safeArea}
            ready={initialized && !busy}
            onError={onError}
          />
          <p className="th-hint">
            ドラッグで移動 / ホイールで拡大 / 矢印で1px（Shiftで10px）/ Deleteで削除 / ⌘Zで元に戻す
          </p>
          <LayersPanel project={project} selected={selected} onSelect={setSelected} onEdit={edit} onChange={change} />
        </div>
        <aside>
          <PropertiesPanel layer={project.layers.find((l) => l.id === selected)} onEdit={edit} onRemove={remove} />
        </aside>
      </div>
    </main>
  )
}
