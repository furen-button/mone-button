import type { ReactNode } from 'react'
import { FieldFrame } from './FieldFrame'
import { useEditorContext } from './EditorContext'
import { AlignField } from './fields/AlignField'
import { BooleanField } from './fields/BooleanField'
import { BoxFieldset } from './fields/BoxFieldset'
import { ColorField } from './fields/ColorField'
import { EnumField } from './fields/EnumField'
import { FadeField } from './fields/FadeField'
import { FontField } from './fields/FontField'
import { NullableField } from './fields/NullableField'
import { NumberField } from './fields/NumberField'
import { ObjectFieldset, type FormExpansion } from './fields/ObjectFieldset'
import { SizeField } from './fields/SizeField'
import { StringField } from './fields/StringField'
import { StringListField } from './fields/StringListField'
import { StringMapField } from './fields/StringMapField'
import {
  classify,
  derefSchema,
  nullableInnerSchema,
  type FieldKind,
  type SchemaNode,
} from './resolveSchema'

type SchemaFormProps = {
  rootKeys: string[]
  expansion: FormExpansion
}

export function SchemaForm({ rootKeys, expansion }: SchemaFormProps) {
  const context = useEditorContext()
  const rootProperties = record(context.schema.properties)

  return (
    <div className="cv-schemaForm">
      {rootKeys.map((rootKey) => {
        const node = rootProperties?.[rootKey]
        return node ? renderField({ node, path: [rootKey], rootPath: [rootKey], expansion, root: context.schema }) : null
      })}
    </div>
  )
}

// 指定パスの項目だけを描く。プレビュー画面のつまみのように、設定タブと同じ patch を共有したまま
// 一部のフィールドを別の場所に出すために使う。
export function SchemaFieldList({ paths }: { paths: string[][] }) {
  const context = useEditorContext()
  const expansion: FormExpansion = { mode: 'expand', token: 0 }
  return (
    <div className="cv-schemaForm cv-schemaForm--compact">
      {paths.map((path) => {
        const node = schemaNodeAt(context.schema, path)
        return node ? renderField({ node, path, rootPath: [path[0]], expansion, root: context.schema }) : null
      })}
    </div>
  )
}

function schemaNodeAt(root: SchemaNode, path: string[]): unknown {
  let node: unknown = root
  for (const key of path) {
    const { node: schema } = derefSchema(node, root)
    const properties = record(schema.properties)
    if (!properties || !(key in properties)) {
      return null
    }
    node = properties[key]
  }
  return node
}

type RenderArgs = {
  node: unknown
  path: string[]
  rootPath: string[]
  expansion: FormExpansion
  root: SchemaNode
}

function renderField({ node, path, rootPath, expansion, root }: RenderArgs): ReactNode {
  if (path.at(-1) === '$schema') {
    return null
  }

  const kind = classify(node, path, root)
  const schema = schemaWithDefName(node, root)

  if (kind === 'nullable') {
    const innerSchema = nullableInnerSchema(node, root)
    const innerKind = classify(innerSchema, path, root)
    return (
      <FieldFrame key={path.join('.')} path={path} schema={schema}>
        <NullableField path={path} innerKind={innerKind} innerSchema={innerSchema}>
          {renderScalarControl(innerKind, innerSchema, path)}
        </NullableField>
      </FieldFrame>
    )
  }

  if (kind === 'box') {
    return (
      <BoxFieldset key={path.join('.')} path={path} schema={schema} expansion={expansion}>
        {renderObjectChildren(schema, path, rootPath, expansion, root, new Set(['enabled']))}
      </BoxFieldset>
    )
  }

  if (kind === 'object') {
    return (
      <ObjectFieldset key={path.join('.')} path={path} schema={schema} rootPath={rootPath} expansion={expansion}>
        {renderObjectChildren(schema, path, rootPath, expansion, root)}
      </ObjectFieldset>
    )
  }

  return (
    <FieldFrame key={path.join('.')} path={path} schema={schema}>
      {renderScalarControl(kind, schema, path)}
    </FieldFrame>
  )
}

function renderObjectChildren(
  schema: SchemaNode,
  path: string[],
  rootPath: string[],
  expansion: FormExpansion,
  root: SchemaNode,
  skip = new Set<string>(),
): ReactNode {
  const properties = record(schema.properties)
  if (!properties) {
    return null
  }

  return Object.entries(properties).map(([key, child]) => {
    if (skip.has(key)) {
      return null
    }
    return renderField({ node: child, path: [...path, key], rootPath, expansion, root })
  })
}

function renderScalarControl(kind: FieldKind, schema: SchemaNode, path: string[]): ReactNode {
  switch (kind) {
    case 'color':
      return <ColorField path={path} />
    case 'align':
      return <AlignField path={path} />
    case 'size':
      return <SizeField path={path} />
    case 'font':
      return <FontField path={path} />
    case 'fade':
      return <FadeField path={path} schema={schema} />
    case 'enum':
      return <EnumField path={path} schema={schema} />
    case 'boolean':
      return <BooleanField path={path} />
    case 'number':
      return <NumberField path={path} schema={schema} />
    case 'string':
      return <StringField path={path} schema={schema} />
    case 'stringList':
      return <StringListField path={path} />
    case 'stringMap':
      return <StringMapField path={path} />
    default:
      return <p className="cv-controlNote">未対応の項目です。</p>
  }
}

function schemaWithDefName(node: unknown, root: SchemaNode): SchemaNode {
  const derefed = derefSchema(node, root)
  return derefed.defName ? { ...derefed.node, __cvDefName: derefed.defName } : derefed.node
}

function record(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === 'object' ? (value as Record<string, unknown>) : null
}
