import { useIpcBootstrap } from './lib/ipc'
import { Shell } from './Shell'

function App(): React.JSX.Element {
  useIpcBootstrap()

  return <Shell />
}

export default App
