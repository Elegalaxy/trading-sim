import { debugLog } from './debug.ts'

function App() {
  debugLog('[ui]', 'app mounted')

  return (
    <p
      style={{
        color: '#eee',
        background: '#111',
        margin: 0,
        minHeight: '100vh',
        padding: 16,
      }}
    >
      Trading Sim – dev build
    </p>
  )
}

export default App
