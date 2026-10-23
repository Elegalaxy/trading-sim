import { debugLog } from './debug.ts'
import { AdminLog } from './AdminLog.tsx'
import { Dashboard } from './Dashboard.tsx'
import { StartScreen } from './StartScreen.tsx'
import { useTradingStore } from './store.ts'
import './styles.css'

function App() {
  debugLog('[ui]', 'app mounted')
  const snapshot = useTradingStore()
  const run = snapshot.run
  if (run === null) {
    return (
      <div className="app">
        <StartScreen />
      </div>
    )
  }
  const events = [...run.game.market.log, ...run.game.log, ...run.game.perception.events]

  return (
    <div className="app">
      <Dashboard />
      {import.meta.env.DEV ? <AdminLog events={events} /> : null}
    </div>
  )
}

export default App
