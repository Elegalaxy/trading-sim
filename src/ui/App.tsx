import { debugLog } from './debug.ts'
import { Dashboard } from './Dashboard.tsx'
import { StartScreen } from './StartScreen.tsx'
import { StatEdge } from './StatEdge.tsx'
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

  return (
    <div className="app">
      <Dashboard />
      <StatEdge energy={run.game.stats.energy} stress={run.game.stats.stress} />
    </div>
  )
}

export default App
