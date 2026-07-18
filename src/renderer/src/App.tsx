import { useEffect } from 'react'
import { useIpcBootstrap } from './lib/ipc'
import { Shell } from './Shell'

function App(): React.JSX.Element {
  useIpcBootstrap()

  useEffect(() => {
    const onDragOver = (e: DragEvent): void => e.preventDefault()
    const onDrop = (e: DragEvent): void => e.preventDefault()
    window.addEventListener('dragover', onDragOver)
    window.addEventListener('drop', onDrop)
    return () => {
      window.removeEventListener('dragover', onDragOver)
      window.removeEventListener('drop', onDrop)
    }
  }, [])

  return <Shell />
}

export default App
