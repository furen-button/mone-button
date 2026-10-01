import type { ReactNode } from 'react'
import { useState } from 'react'
import { useEditorContext } from './EditorContext'
import {
  errorPathFromMessage,
  firstSentence,
  hasAtPath,
  inheritedValuePathFor,
  pathKey,
  type SchemaNode,
} from './resolveSchema'

type FieldFrameProps = {
  path: string[]
  schema: SchemaNode
  children: ReactNode
}

export function FieldFrame({ path, schema, children }: FieldFrameProps) {
  const context = useEditorContext()
  const [expanded, setExpanded] = useState(false)
  const key = pathKey(path)
  const inheritedPath = inheritedValuePathFor(path)
  const explicit = hasAtPath(context.draft, path)
  const inherited = !explicit && hasAtPath(context.resolved, inheritedPath)
  const dirty = context.patch.has(key) || context.unsetKeys.has(key)
  const removed = hasAtPath(context.raw, path) && context.unsetKeys.has(key)
  const errors = fieldErrors(path, context.preflight.response?.validation.errors ?? [])

  if (context.hideInherited && inherited && !dirty && errors.length === 0) {
    return null
  }

  const description = typeof schema.description === 'string' ? schema.description : ''
  const summary = firstSentence(description)
  const hasMoreDescription = description.length > summary.length
  const sourceNote = inherited && inheritedPath.join('.') !== path.join('.') ? inheritedPath.join('.') : ''
  const className = [
    'cv-fieldFrame',
    explicit ? 'is-explicit' : '',
    inherited ? 'is-inherited' : '',
    dirty ? 'is-dirty' : '',
    removed ? 'is-removed' : '',
  ].filter(Boolean).join(' ')

  return (
    <div className={className}>
      <div className="cv-fieldMeta">
        <div className="cv-fieldTitleRow">
          <span className="cv-fieldLabel">{path.at(-1)}</span>
          <span className="cv-fieldBadges">
            {explicit ? <span className="cv-fieldBadge is-explicit">明示</span> : null}
            {inherited ? <span className="cv-fieldBadge">継承</span> : null}
            {dirty ? <span className="cv-fieldBadge is-dirty">未保存</span> : null}
          </span>
          {explicit ? (
            <button
              type="button"
              className="cv-iconButton"
              title="設定から外して継承に戻す"
              aria-label={`${path.join('.')} を設定から外して継承に戻す`}
              onClick={() => context.unsetValue(path)}
            >
              ×
            </button>
          ) : null}
        </div>
        {summary ? (
          <p className="cv-fieldDescription">
            {expanded ? description : summary}
            {hasMoreDescription ? (
              <button
                type="button"
                className="cv-helpButton"
                aria-expanded={expanded}
                onClick={() => setExpanded((value) => !value)}
              >
                ?
              </button>
            ) : null}
          </p>
        ) : null}
        {sourceNote ? <p className="cv-inheritNote">継承元: {sourceNote}</p> : null}
      </div>
      <div className="cv-fieldControl">{children}</div>
      {errors.length > 0 ? (
        <ul className="cv-fieldErrors">
          {errors.map((error) => (
            <li key={error}>{error}</li>
          ))}
        </ul>
      ) : null}
    </div>
  )
}

function fieldErrors(path: string[], errors: string[]): string[] {
  const key = pathKey(path)
  return errors.filter((error) => {
    const errorPath = errorPathFromMessage(error)
    return errorPath ? pathKey(errorPath) === key : false
  })
}
