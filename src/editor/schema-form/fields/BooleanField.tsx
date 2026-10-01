import { useFieldSetter, useFieldValue } from './fieldUtils'

type BooleanFieldProps = {
  path: string[]
}

export function BooleanField({ path }: BooleanFieldProps) {
  const value = useFieldValue(path) === true
  const setValue = useFieldSetter(path)

  return (
    <label className="cv-checkboxControl">
      <input type="checkbox" checked={value} onChange={(event) => setValue(event.target.checked)} />
      <span>{value ? '有効' : '無効'}</span>
    </label>
  )
}
