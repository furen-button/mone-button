import type { ReactNode } from 'react'
import { FieldFrame } from '../FieldFrame'
import { BooleanField } from './BooleanField'
import { useFieldValue } from './fieldUtils'
import type { FormExpansion } from './ObjectFieldset'
import { type SchemaNode } from '../resolveSchema'

type BoxFieldsetProps = {
  path: string[]
  schema: SchemaNode
  expansion: FormExpansion
  children: ReactNode
}

export function BoxFieldset({ path, schema, children }: BoxFieldsetProps) {
  const enabled = useFieldValue([...path, 'enabled']) !== false

  return (
    <FieldFrame path={path} schema={schema}>
      <div className="cv-boxFieldset">
        <div className="cv-boxHeader">
          <BooleanField path={[...path, 'enabled']} />
        </div>
        <fieldset disabled={!enabled}>
          <div className="cv-fieldGrid">{children}</div>
        </fieldset>
      </div>
    </FieldFrame>
  )
}
