import { useFieldSetter, useFieldValue } from './fieldUtils'

type AlignFieldProps = {
  path: string[]
}

const ALIGN_VALUES = [
  'top-left',
  'top-center',
  'top-right',
  'middle-left',
  'center',
  'middle-right',
  'bottom-left',
  'bottom-center',
  'bottom-right',
]

export function AlignField({ path }: AlignFieldProps) {
  const value = useFieldValue(path)
  const setValue = useFieldSetter(path)
  const text = typeof value === 'string' ? value : 'center'

  return (
    <div className="cv-alignGrid" role="radiogroup">
      {ALIGN_VALUES.map((option) => (
        <button
          type="button"
          key={option}
          className={text === option ? 'cv-alignCell is-active' : 'cv-alignCell'}
          title={option}
          aria-label={option}
          aria-pressed={text === option}
          onClick={() => setValue(option)}
        >
          <span />
        </button>
      ))}
    </div>
  )
}
