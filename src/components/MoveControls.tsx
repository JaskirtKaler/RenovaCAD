import { useEffect, useRef, useState } from 'react'
import { ArrowDown, ArrowLeft, ArrowRight, ArrowUp } from 'lucide-react'
import { POSITION_LIMIT_MM, TILE_MM, canNudge, displayMeasurement, type Axis, type SceneObject, type Unit } from '../workspace'

interface MoveControlsProps {
  object: SceneObject
  unit: Unit
  onNudge: (axis: Axis, direction: -1 | 1) => void
  onSetPosition: (axis: Axis, valueMm: number) => void
}

const axes = [
  { axis: 'x', name: 'Left / right', negative: 'Move left one tile', positive: 'Move right one tile', minus: ArrowLeft, plus: ArrowRight },
  { axis: 'y', name: 'Height from floor', negative: 'Lower one tile', positive: 'Raise one tile', minus: ArrowDown, plus: ArrowUp },
  { axis: 'z', name: 'Back / forward', negative: 'Move back one tile', positive: 'Move forward one tile', minus: ArrowUp, plus: ArrowDown },
] satisfies { axis: Axis; name: string; negative: string; positive: string; minus: typeof ArrowLeft; plus: typeof ArrowLeft }[]

function PositionInput({ axis, object, unit, onNudge, onSetPosition }: { axis: Axis; object: SceneObject; unit: Unit; onNudge: (axis: Axis, direction: -1 | 1) => void; onSetPosition: (axis: Axis, valueMm: number) => void }) {
  const value = displayMeasurement(object.positionMm[axis], unit)
  const [draft, setDraft] = useState(value)
  const [invalid, setInvalid] = useState(false)
  const skipCommit = useRef(false)

  useEffect(() => {
    setDraft(value)
    setInvalid(false)
  }, [value, object.id, unit])

  const limitDisplay = unit === 'in' ? POSITION_LIMIT_MM / 25.4 : POSITION_LIMIT_MM
  const min = -limitDisplay
  const max = limitDisplay

  const commit = () => {
    if (draft === value) {
      setInvalid(false)
      return
    }
    const trimmed = draft.trim()
    const parsed = Number(draft)
    if (!trimmed || !Number.isFinite(parsed) || parsed < min - 1e-9 || parsed > max + 1e-9) {
      setDraft(value)
      setInvalid(true)
      return
    }
    setInvalid(false)
    const valueMm = unit === 'in' ? parsed * 25.4 : parsed
    const roundedMm = Math.round(valueMm * 1000) / 1000
    if (Math.abs(object.positionMm[axis] - roundedMm) < 0.0005) {
      setDraft(value)
      return
    }
    if (Math.abs(roundedMm) > POSITION_LIMIT_MM + 1e-9) {
      setDraft(value)
      setInvalid(true)
      return
    }
    onSetPosition(axis, roundedMm)
  }

  const axisMeta = axes.find((item) => item.axis === axis)!
  const MinusIcon = axisMeta.minus
  const PlusIcon = axisMeta.plus

  return (
    <div className="position-row" key={axis}>
      <span className={`axis-label axis-${axis}`}>{axis.toUpperCase()}<small>{axisMeta.name}</small></span>
      <div className={`position-stepper ${invalid ? 'invalid' : ''}`}>
        <button type="button" aria-label={axisMeta.negative} title={axisMeta.negative} disabled={!canNudge(object, axis, -1)} onClick={() => onNudge(axis, -1)}><MinusIcon size={13} /></button>
        <input
          id={`field-position-${axis}`}
          aria-label={`${axis.toUpperCase()} position`}
          aria-invalid={invalid}
          title={invalid ? `Enter a value between ${Number(min.toFixed(2))} and ${Number(max.toFixed(2))}.` : undefined}
          type="number"
          step="any"
          value={draft}
          onChange={(event) => { setDraft(event.target.value); setInvalid(false) }}
          onBlur={() => {
            if (skipCommit.current) { skipCommit.current = false; return }
            commit()
          }}
          onKeyDown={(event) => {
            if (event.key === 'Enter') event.currentTarget.blur()
            if (event.key === 'Escape') { skipCommit.current = true; setDraft(value); setInvalid(false); (event.currentTarget as HTMLInputElement).blur() }
          }}
          aria-describedby={invalid ? `error-position-${axis}` : undefined}
        />
        <span className="position-suffix">{unit}</span>
        <button type="button" aria-label={axisMeta.positive} title={axisMeta.positive} disabled={!canNudge(object, axis, 1)} onClick={() => onNudge(axis, 1)}><PlusIcon size={13} /></button>
      </div>
      {invalid && <span id={`error-position-${axis}`} className="sr-only" role="alert">Enter a number between {Number(min.toFixed(2))} and {Number(max.toFixed(2))}.</span>}
    </div>
  )
}

export function MoveControls({ object, unit, onNudge, onSetPosition }: MoveControlsProps) {
  return <section className="position-controls" aria-label="Object position">
    <div className="property-heading">Position<span>1 tile = {displayMeasurement(TILE_MM, unit)} {unit}</span></div>
    {axes.map(({ axis }) => (
      <PositionInput key={`${object.id}-${axis}-${unit}`} axis={axis} object={object} unit={unit} onNudge={onNudge} onSetPosition={onSetPosition} />
    ))}
    <p className="position-hint">World axes · Y can be above or below the floor.</p>
  </section>
}
