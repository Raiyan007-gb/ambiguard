import { useEffect, useMemo, useState } from 'react'
import Header from './components/Header.jsx'
import DataPanel from './components/DataPanel.jsx'
import ModelPanel from './components/ModelPanel.jsx'
import StandardView from './components/StandardView.jsx'
import AmbiguityView from './components/AmbiguityView.jsx'
import ContrastView from './components/ContrastView.jsx'
import { GUARDS, REASONERS, MAX_LIVE_INSTANCES } from './config.js'
import { lookup } from './lib/cache.js'
import { runInstance } from './lib/pipeline.js'
import { useApiKey } from './lib/keystore.js'
import Footer from './components/Footer.jsx'

// Live-run records are keyed by what actually identifies them, not by row
// position, so they survive changing the guard or reasoner and can be shared
// with the Comparison view.
export function liveKey(text, guardId, reasonerId) {
  return [text.trim().replace(/\s+/g, ' '), guardId, reasonerId].join('|')
}

export default function App() {
  const [sampleRows, setSampleRows] = useState([])
  const [userRows, setUserRows] = useState([])
  const [selected, setSelected] = useState(new Set())

  const [guardId, setGuardId] = useState(GUARDS[0].id)
  const [reasonerId, setReasonerId] = useState(REASONERS[0].id)
  const [apiKey, setApiKey] = useApiKey()

  const [view, setView] = useState('standard')
  const [threshold, setThreshold] = useState(0.5)
  const [resolved, setResolved] = useState({})   // rowId -> record, current settings
  const [live, setLive] = useState({})           // liveKey -> record, every setting
  const [levels, setLevels] = useState({})
  const [acked, setAcked] = useState({})
  const [status, setStatus] = useState(null)
  const [busy, setBusy] = useState(false)

  const guard = GUARDS.find((g) => g.id === guardId)
  const sliderEnabled = Boolean(guard?.logprobs)

  const active = useMemo(() => {
    const all = [
      ...sampleRows.map((r, i) => ({ ...r, id: `s${i}`, source: 'sample' })),
      ...userRows.map((r, i) => ({ ...r, id: `u${i}`, source: 'user' })),
    ]
    return all.filter((r) => selected.has(r.id))
  }, [sampleRows, userRows, selected])

  const activeKey = active.map((r) => r.instance).join('\u0000')

  useEffect(() => {
    let cancelled = false
    if (!active.length) { setResolved({}); setStatus(null); return }
    setStatus('Loading precomputed results')
    Promise.all(active.map(async (row) => {
      const l = live[liveKey(row.instance, guardId, reasonerId)]
      if (l) return [row.id, l]
      return [row.id, await lookup(row.instance, guardId, reasonerId)]
    })).then((pairs) => {
      if (cancelled) return
      const next = {}
      for (const [id, rec] of pairs) if (rec) next[id] = rec
      setResolved(next)
      const missing = pairs.filter(([, rec]) => !rec).length
      setStatus(missing === 0 ? null
        : `${missing} of ${pairs.length} selected instances are not precomputed for this guard and reasoning model.`)
    })
    return () => { cancelled = true }
  }, [activeKey, guardId, reasonerId, live])

  const merged = active.map((row) => {
    const rec = resolved[row.id]
    return {
      ...row,
      record: rec || null,
      verdict: rec?.original?.verdict || null,
      p_unsafe: rec?.original?.p_unsafe ?? null,
      level: rec?.level || null,
    }
  })

  const missing = merged.filter((r) => !r.record)

  function addLive(rec) {
    setLive((prev) => ({ ...prev, [liveKey(rec.instance, rec.guard, rec.reasoner)]: rec }))
  }

  async function runMissing() {
    if (!apiKey) { setStatus('Enter an OpenRouter API key to run these instances.'); return }
    const todo = missing.slice(0, MAX_LIVE_INSTANCES)
    setBusy(true)
    try {
      for (const [i, row] of todo.entries()) {
        const rec = await runInstance({
          apiKey, guardId, reasonerId, text: row.instance,
          meta: { safety_type: row.safety_type, ground_truth: row.ground_truth },
          onStage: (s) => setStatus(`Instance ${i + 1} of ${todo.length}: ${s}`),
        })
        addLive(rec)
      }
      setStatus(null)
    } catch (err) {
      setStatus(`Run stopped: ${err.message}`)
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="wrap">
      <Header />

      <div className="setup">
        <DataPanel
          sampleRows={sampleRows} setSampleRows={setSampleRows}
          userRows={userRows} setUserRows={setUserRows}
          selected={selected} setSelected={setSelected}
        />
        <ModelPanel
          guardId={guardId} setGuardId={setGuardId}
          apiKey={apiKey} setApiKey={setApiKey}
        />
      </div>

      <div className="toggle-bar">
        <div className="toggle" role="group" aria-label="Analysis view">
          <button aria-pressed={view === 'standard'} onClick={() => setView('standard')}>
          Aggregate
          </button>
          <button aria-pressed={view === 'individual'} onClick={() => setView('individual')}>
          Assumptions
          </button>
          <button aria-pressed={view === 'contrast'} onClick={() => setView('contrast')}>
          Divergence
          </button>
        </div>
        <span className="info" tabIndex={0} role="button" aria-label="About the three views">
          i
          <span className="tip">
          <b>Aggregate</b> — the guard's decision on each instance, with the standard
            aggregate scores.
            <br /><br />
            <b>Assumptions</b> — the same instances, each marked by whether the guard's
            call holds up once a plausible opposing assumption is made explicit.
            <br /><br />
            <b>Divergence</b> — the same instances under two settings side by side: two
            reasoning models on one guard, or two guards under one reasoning model.
          </span>
        </span>
      </div>

      {status && (
        <div className="banner">
          {status}
          {missing.length > 0 && !busy && view !== 'contrast' && (
            <button
              className="secondary"
              style={{ marginLeft: 10, padding: '3px 10px' }}
              onClick={runMissing}
            >
              Run {Math.min(missing.length, MAX_LIVE_INSTANCES)} now
            </button>
          )}
        </div>
      )}

      {merged.length === 0 ? (
        <div className="empty">
          Load a sample set, or add your own instances, then select the evaluation mode.
        </div>
      ) : view === 'standard' ? (
        <StandardView
          rows={merged}
          threshold={threshold} setThreshold={setThreshold}
          sliderEnabled={sliderEnabled}
        />
      ) : view === 'individual' ? (
        <AmbiguityView
          rows={merged}
          threshold={threshold} setThreshold={setThreshold}
          sliderEnabled={sliderEnabled}
          levels={levels} setLevels={setLevels}
          acked={acked} setAcked={setAcked}
          reasonerId={reasonerId} setReasonerId={setReasonerId}
        />
      ) : (
        <ContrastView
          rows={merged}
          guardId={guardId}
          reasonerId={reasonerId}
          setReasonerId={setReasonerId}
          live={live}
          addLive={addLive}
          apiKey={apiKey}
        />
      )}
      <Footer />
    </div>
  )
}