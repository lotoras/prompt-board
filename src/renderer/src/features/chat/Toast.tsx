import { useStore } from '../../store'

export function Toast(): React.JSX.Element {
  const toast = useStore((s) => s.toast)
  return (
    <div className={`toast${toast?.visible ? ' show' : ''}`} role="status">
      {toast?.text ?? ''}
    </div>
  )
}
