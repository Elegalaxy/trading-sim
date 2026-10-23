import { debugLog } from './debug.ts'
import { AdminLog } from './AdminLog.tsx'
import { Dashboard } from './Dashboard.tsx'
import { useTradingStore } from './store.ts'
import './styles.css'

function App() {
  debugLog('[ui]', 'app mounted')
  const snapshot = useTradingStore()
  const run = snapshot.run
  const events = run === null ? [] : [...run.game.market.log, ...run.game.log]

  return (
    <div className="app">
      <Dashboard />
      {import.meta.env.DEV ? <AdminLog events={events} /> : null}
    </div>
  )
}

export default App
