import { setReduceVisualEffects, useVisualSettings } from './effects.ts'

export function Settings() {
  const settings = useVisualSettings()

  return (
    <section className="panel visual-settings" aria-label="Visual settings">
      <label htmlFor="reduce-visual-effects">
        <input
          id="reduce-visual-effects"
          type="checkbox"
          checked={settings.reduceVisualEffects}
          onChange={(event) => {
            setReduceVisualEffects(event.target.checked)
          }}
        />
        Reduce visual effects
      </label>
    </section>
  )
}
