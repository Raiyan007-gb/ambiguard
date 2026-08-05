import { useState } from 'react'
import { LEVELS, REASONERS } from '../config.js'
import {
  action, defeasibility, correctButContestable, movement, consistency,
} from '../lib/metrics.js'
import Threshold from './Threshold.jsx'
import InstanceDetail from './InstanceDetail.jsx'

// instance, truth, prediction, action, levels, flipped, acknowledged
const COLS = 4 + LEVELS.length + 2

function Prediction({ row }) {
  if (!row.verdict) return <span className="muted">pending</span>
  if (row.p_unsafe != null) return <span className="num">{row.p_unsafe.toFixed(2)}</span>
  return <span className="plain">{row.verdict}</span>
}

function Action({ row, threshold }) {
  if (!row.verdict) return <span className="verdict na">pending</span>
  const a = action(row, threshold)
  return <span className={`verdict ${a === 'blocked' ? 'block' : 'allow'}`}>{a}</span>
}

// Did the prediction move once the defeating assumption was added? Only defined
// where a defeater existed and the guard was actually re-run on it.
function Flipped({ row }) {
  const flip = row.record?.flip
  if (!flip?.run) {
    return <span className="flipmark na" title="No defeater to test">n/a</span>
  }
  return flip.moved
    ? <span className="flipmark yes" title="Prediction moved to the opposite label">flipped</span>
    : <span className="flipmark no" title="Prediction stayed the same">held</span>
}

function Stat({ name, desc, hint, s }) {
  return (
    <div className="stat2">
      <div className="stat2-name">
        {name}
        {hint && (
          <span className="info" tabIndex={0} role="button" aria-label={`More about ${name}`}>
            i<span className="tip">{hint}</span>
          </span>
        )}
      </div>
      <p className="stat2-desc">{desc}</p>
      <div className="stat2-vals">
        <div><span className="v">{s.a}</span><span className="k">{s.aLabel}</span></div>
        <div><span className="v">{s.b}</span><span className="k">{s.bLabel}</span></div>
      </div>
    </div>
  )
}

export default function AmbiguityView({
  rows, threshold, setThreshold, sliderEnabled, levels, setLevels, acked, setAcked,
  reasonerId, setReasonerId,
}) {
  const [open, setOpen] = useState(null)

  // Effective level and acknowledgment, so practitioner edits feed the stats.
  const scored = rows.map((r) => ({
    ...r,
    level: levels[r.id] || r.level,
    acknowledged: acked[r.id] !== false,
  }))

  const d = defeasibility(scored)
  const c = correctButContestable(scored, threshold)
  const m = movement(scored)
  const k = consistency(scored)

  return (
    <div className="exp ambiguity">
      <div className="tbl-wrap">
        <table>
          <thead>
            <tr>
              <th className="c-instance">Instance</th>
              <th className="c-truth">Ground truth</th>
              <th className="c-pred">Guard prediction</th>
              <th className="c-pred">Guard action</th>
              {LEVELS.map((l) => (
                <th className="lvl" key={l.key}><span>{l.short}</span></th>
              ))}
              <th className="flip">Flipped</th>
              <th className="ack">Acknow&shy;ledged</th>
            </tr>
          </thead>
          <tbody>
            {scored.map((row) => {
              const isOpen = open === row.id
              return [
                <tr
                  key={row.id}
                  className={`clickable${isOpen ? ' open' : ''}`}
                  onClick={() => setOpen(isOpen ? null : row.id)}
                >
                  <td className="c-instance">{row.instance}</td>
                  <td className="c-truth">{row.ground_truth || '\u2014'}</td>
                  <td className="c-pred"><Prediction row={row} /></td>
                  <td className="c-pred"><Action row={row} threshold={threshold} /></td>
                  {LEVELS.map((l) => (
                    <td className="lvl" key={l.key}>
                      <button
                        className={l.cls}
                        aria-pressed={row.level === l.key}
                        aria-label={`Mark as ${l.short}`}
                        title={l.short}
                        onClick={(e) => {
                          e.stopPropagation()
                          setLevels({ ...levels, [row.id]: l.key })
                        }}
                      />
                    </td>
                  ))}
                  <td className="flip"><Flipped row={row} /></td>
                  <td className="ack">
                    <input
                      type="checkbox"
                      checked={row.acknowledged}
                      aria-label="Acknowledge that this label is contestable"
                      onClick={(e) => e.stopPropagation()}
                      onChange={(e) => setAcked({ ...acked, [row.id]: e.target.checked })}
                    />
                  </td>
                </tr>,
                isOpen && (
                  <InstanceDetail key={`${row.id}-d`} record={row.record} colSpan={COLS} />
                ),
              ]
            })}
          </tbody>
        </table>
      </div>

      <aside className="side">
        <div className="panel">
          <div className="field" style={{ marginBottom: 14 }}>
            <label htmlFor="reasoner">Reasoning model</label>
            <select
              id="reasoner"
              value={reasonerId}
              onChange={(e) => setReasonerId(e.target.value)}
            >
              {REASONERS.map((r) => (
                <option key={r.id} value={r.id}>{r.label}</option>
              ))}
            </select>
          </div>

          <Threshold value={threshold} setValue={setThreshold} enabled={sliderEnabled} />

          <Stat
            name="Defeasibility"
            s={d}
            desc="Share of the guard's predictions that are defeasible, split by the direction it predicted."
            hint="Defeasible means a plausible assumption exists under which the opposite prediction is the reasonable one. Whether an assumption clears that bar is judged by the reasoning model, so this is a property of the reasoner, not of the guard or the prediction, so a different reasoning model may draw the line elsewhere."
          />
          <Stat
            name="Movement"
            s={m}
            desc="On defeasible instances, how often the guard prediction flips once the defeater is added, and the mean change in predicted probability."
            hint="Counted only over defeasible instances where a defeater existed and the guard was re-run on it; the Flipped column shows the per-instance result. Mean change needs a probability from the guard and shows a dash otherwise."
          />
          <Stat
            name="Consistency"
            s={k}
            desc="How often the prediction holds when the assumption it most plausibly rests on is stated explicitly, split by the direction predicted."
            hint="It should hold, since stating the reason a prediction most plausibly depends on is expected not to change that prediction."
          />
          {c.available && (
            <Stat
              name="Correct but contestable"
              s={c}
              desc="Of the instances matching the gold label, the share tagged defeasible — and the same where they did not match."
              hint="Shown only when the selection has ground truth. Every label can be contestable, whether or not it matched the gold label."
            />
          )}
        </div>
      </aside>
    </div>
  )
}