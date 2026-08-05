import { useEffect, useMemo, useState } from 'react'
import { GUARDS, REASONERS, LEVELS, MAX_LIVE_INSTANCES } from '../config.js'
import { lookup } from '../lib/cache.js'
import { runInstance } from '../lib/pipeline.js'
import { liveKey } from '../App.jsx'
import Injected from './Injected.jsx'

const LABEL = Object.fromEntries(LEVELS.map((l) => [l.key, l]))
const pct = (n, d) => (d > 0 ? `${Math.round((100 * n) / d)}%` : '\u2014')

function LevelCell({ rec }) {
  if (!rec) return <span className="muted">{'\u2014'}</span>
  const l = LABEL[rec.level]
  return (
    <span className="lvlchip">
      <i className={l?.cls} />
      {l?.short || rec.level}
      {rec.flip?.moved && <b title="Guard flipped under the defeater">&#8634;</b>}
    </span>
  )
}

function Verdict({ run }) {
  if (!run) return <span className="verdict na">not run</span>
  return (
    <span className={`verdict ${run.verdict === 'unsafe' ? 'block' : 'allow'}`}>
      {run.verdict}
    </span>
  )
}

function Side({ title, rec }) {
  return (
    <div className="side-block">
      <h5>{title}</h5>
      {!rec ? (
        <p className="note" style={{ margin: 0 }}>No record.</p>
      ) : (
        <div className="arms">
          <div className="arm">
            <h4>With the assumption the prediction needs</h4>
            <Injected original={rec.instance} injection={rec.support?.injection} />
            <Verdict run={rec.support?.run || rec.original} />
          </div>
          <div className="arrow" aria-hidden="true">&#8594;</div>
          <div className="arm">
            <h4>With the most plausible assumption for the opposite prediction</h4>
            {rec.flip?.assumption ? (
              <>
                <Injected original={rec.instance} injection={rec.flip.injection} />
                <Verdict run={rec.flip.run} />
              </>
            ) : (
              <div className="body" style={{ color: 'var(--ink-faint)' }}>
                No assumption cleared the plausibility bar.
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  )
}

function summarise(recs) {
  const rs = recs.filter(Boolean)
  const def = rs.filter((r) => r.level?.startsWith('defeasibly'))
  const withRun = def.filter((r) => r.flip?.run)
  const sup = rs.filter((r) => r.support?.run)
  return {
    // each stat carries its own denominator, because they differ:
    // defeasibility is over all records, movement only over defeasible
    // instances that were re-run, consistency only over support re-runs.
    defeasibility: pct(def.length, rs.length),
    defeasibility_n: rs.length,
    movement: pct(withRun.filter((r) => r.flip.moved).length, withRun.length),
    movement_n: withRun.length,
    consistency: pct(sup.filter((r) => !r.support.inconsistent).length, sup.length),
    consistency_n: sup.length,
  }
}

export default function ContrastView({
  rows, guardId, reasonerId, setReasonerId, live = {}, addLive, apiKey,
}) {
  const [mode, setMode] = useState('reasoners')
  const [pickA, setPickA] = useState(REASONERS[0].id)
  const [pickB, setPickB] = useState(REASONERS[1]?.id || REASONERS[0].id)
  const [recs, setRecs] = useState({ a: {}, b: {} })
  const [open, setOpen] = useState(null)
  const [loading, setLoading] = useState(false)
  const [running, setRunning] = useState(null)

  const options = mode === 'reasoners' ? REASONERS : GUARDS
  const nameOf = (id) => options.find((o) => o.id === id)?.label || id

  // Reset the picks whenever the axis changes, so a reasoner id never ends up
  // being looked up as a guard.
  useEffect(() => {
    const o = mode === 'reasoners' ? REASONERS : GUARDS
    setPickA(o[0].id)
    setPickB(o[1]?.id || o[0].id)
  }, [mode])

  const pair = useMemo(() => (
    mode === 'reasoners'
      ? { a: { guard: guardId, reasoner: pickA }, b: { guard: guardId, reasoner: pickB } }
      : { a: { guard: pickA, reasoner: reasonerId }, b: { guard: pickB, reasoner: reasonerId } }
  ), [mode, pickA, pickB, guardId, reasonerId])

  const key = rows.map((r) => r.instance).join('\u0000')

  useEffect(() => {
    let cancelled = false
    if (!rows.length) { setRecs({ a: {}, b: {} }); return }
    setLoading(true)
    // Live-run records are not in the cache, so check them first.
    const fetchSide = (cfg) => Promise.all(
      rows.map(async (r) => {
        const l = live[liveKey(r.instance, cfg.guard, cfg.reasoner)]
        if (l) return [r.id, l]
        return [r.id, await lookup(r.instance, cfg.guard, cfg.reasoner)]
      }),
    ).then(Object.fromEntries)

    Promise.all([fetchSide(pair.a), fetchSide(pair.b)]).then(([a, b]) => {
      if (cancelled) return
      setRecs({ a, b })
      setLoading(false)
    })
    return () => { cancelled = true }
  }, [key, pair, live])

  const sameVerdict = mode === 'reasoners'
  const sA = summarise(rows.map((r) => recs.a[r.id]))
  const sB = summarise(rows.map((r) => recs.b[r.id]))
  const both = rows.filter((r) => recs.a[r.id] && recs.b[r.id])
 // Reasoner mode: both sides share the guard, so comparing levels is the point
  // — it shows where the two reasoners draw the robust/defeasible line.
  // Guard mode: the level is the reasoner's product, so comparing it would fold
  // the (held) reasoner into a guard-vs-guard number. Compare the bare
  // prediction instead, which is purely the guard's.
  const agree = both.filter((r) =>
    mode === 'reasoners'
      ? recs.a[r.id].level === recs.b[r.id].level
      : recs.a[r.id].original.verdict === recs.b[r.id].original.verdict,
  )

  // A gap is one missing side of one instance. Filling both sides of one
  // instance is two gaps and about ten model calls.
  const gaps = rows.flatMap((r) => [
    ...(recs.a[r.id] ? [] : [{ row: r, cfg: pair.a }]),
    ...(recs.b[r.id] ? [] : [{ row: r, cfg: pair.b }]),
  ])

  async function runGaps() {
    if (!apiKey) { setRunning('Enter an OpenRouter API key in the panel above.'); return }
    const todo = gaps.slice(0, MAX_LIVE_INSTANCES)
    try {
      for (const [i, g] of todo.entries()) {
        setRunning(`Running ${i + 1} of ${todo.length}\u2026`)
        const rec = await runInstance({
          apiKey,
          guardId: g.cfg.guard,
          reasonerId: g.cfg.reasoner,
          text: g.row.instance,
          meta: { safety_type: g.row.safety_type, ground_truth: g.row.ground_truth },
        })
        addLive(rec)
      }
      setRunning(null)
    } catch (err) {
      setRunning(`Stopped: ${err.message}`)
    }
  }

  const COLS = 3 + (sameVerdict ? 1 : 2) + 2

  return (
    <div className="exp ambiguity">
      <div className="tbl-wrap">
        <table>
          <thead>
            <tr>
              <th className="c-instance">Instance</th>
              <th className="c-truth">Ground truth</th>
              {sameVerdict ? (
                <th className="c-pred">Guard prediction</th>
              ) : (
                <>
                  <th className="c-pred">{nameOf(pickA)}</th>
                  <th className="c-pred">{nameOf(pickB)}</th>
                </>
              )}
              <th>{nameOf(pickA)}</th>
              <th>{nameOf(pickB)}</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => {
              const a = recs.a[row.id]
              const b = recs.b[row.id]
              const differs = a && b && a.level !== b.level
              const isOpen = open === row.id
              return [
                <tr
                  key={row.id}
                  className={`clickable${isOpen ? ' open' : ''}${differs ? ' disagree' : ''}`}
                  onClick={() => setOpen(isOpen ? null : row.id)}
                >
                  <td className="c-instance">{row.instance}</td>
                  <td className="c-truth">{row.ground_truth || '\u2014'}</td>
                  {sameVerdict ? (
                    <td className="c-pred">
                      <span className={`verdict ${a?.original?.verdict === 'unsafe' ? 'block' : 'allow'}`}>
                        {a?.original?.verdict || '\u2014'}
                      </span>
                    </td>
                  ) : (
                    <>
                      <td className="c-pred">
                        <span className={`verdict ${a?.original?.verdict === 'unsafe' ? 'block' : 'allow'}`}>
                          {a?.original?.verdict || '\u2014'}
                        </span>
                      </td>
                      <td className="c-pred">
                        <span className={`verdict ${b?.original?.verdict === 'unsafe' ? 'block' : 'allow'}`}>
                          {b?.original?.verdict || '\u2014'}
                        </span>
                      </td>
                    </>
                  )}
                  <td><LevelCell rec={a} /></td>
                  <td><LevelCell rec={b} /></td>
                </tr>,
                isOpen && (
                  <tr className="detail" key={`${row.id}-d`}>
                    <td colSpan={COLS}>
                      <div className="detail-inner">
                        <Side title={nameOf(pickA)} rec={a} />
                        <Side title={nameOf(pickB)} rec={b} />
                      </div>
                    </td>
                  </tr>
                ),
              ]
            })}
          </tbody>
        </table>
      </div>

      <aside className="side">
        <div className="panel">
          <div className="field">
            <label htmlFor="axis">Compare</label>
            <select id="axis" value={mode} onChange={(e) => setMode(e.target.value)}>
              <option value="reasoners">Two reasoning models, one guard</option>
              <option value="guards">Two guards, one reasoning model</option>
            </select>
            <p className="note">
              {mode === 'reasoners'
                ? `Guard held at ${GUARDS.find((g) => g.id === guardId)?.label}.`
                : `Reasoning model held at ${REASONERS.find((r) => r.id === reasonerId)?.label}.`}
              {' '}Change the comparison mode in the dropdown above.
            </p>
          </div>

          {mode === 'guards' && (
            <div className="field">
              <label htmlFor="held-reasoner">Reasoning model (held)</label>
              <select
                id="held-reasoner"
                value={reasonerId}
                onChange={(e) => setReasonerId(e.target.value)}
              >
                {REASONERS.map((r) => (
                  <option key={r.id} value={r.id}>{r.label}</option>
                ))}
              </select>
            </div>
          )}

          <div className="field">
            <label htmlFor="pa">Left</label>
            <select id="pa" value={pickA} onChange={(e) => setPickA(e.target.value)}>
              {options.map((o) => <option key={o.id} value={o.id}>{o.label}</option>)}
            </select>
          </div>
          <div className="field">
            <label htmlFor="pb">Right</label>
            <select id="pb" value={pickB} onChange={(e) => setPickB(e.target.value)}>
              {options.map((o) => <option key={o.id} value={o.id}>{o.label}</option>)}
            </select>
          </div>

          {gaps.length > 0 && (
            <div className="field">
              <button className="secondary" onClick={runGaps} disabled={Boolean(running)}>
                Run {Math.min(gaps.length, MAX_LIVE_INSTANCES)} missing
              </button>
              <p className="note">
                {gaps.length} side{gaps.length === 1 ? '' : 's'} not precomputed. Each is
                about five model calls and takes half a minute.
              </p>
            </div>
          )}
          {running && <p className="note">{running}</p>}

          <div className="stat2" style={{ borderTop: '1px solid var(--rule)', paddingTop: 14 }}>
            <div className="stat2-name">Agreement</div>
            <p className="stat2-desc">
              {mode === 'reasoners'
                ? 'Share of instances where both reasoning models place the guard\u2019s prediction in the same contestability category'
                : 'Share of instances where both guards make the same safe / unsafe prediction'}
            </p>
            <div className="stat2-vals">
              <div>
                <span className="v">{pct(agree.length, both.length)}</span>
                <span className="k">of {both.length}</span>
              </div>
            </div>
          </div>

          {[
            ['Defeasibility', 'defeasibility', 'Share of predictions with a plausible opposing assumption'],
            ['Movement', 'movement', 'Of defeasible instances, how often the guard actually flipped its prediction'],
            ['Consistency', 'consistency', 'How often the guard prediction held when the most plausible assumption was explicitly stated'],
          ].map(([name, k, desc]) => (
            <div className="stat2" key={k}>
              <div className="stat2-name">{name}</div>
              <p className="stat2-desc">{desc}</p>
              <div className="stat2-vals">
                <div><span className="v">{sA[k]}</span><span className="k">n={sA[`${k}_n`]}</span></div>
                <div><span className="v">{sB[k]}</span><span className="k">n={sB[`${k}_n`]}</span></div>
              </div>
            </div>
          ))}

          {loading && <p className="note">Loading\u2026</p>}
          {pickA === pickB && (
            <p className="note" style={{ color: 'var(--block-3)' }}>
              Both sides are set to the same option.
            </p>
          )}
        </div>
      </aside>
    </div>
  )
}