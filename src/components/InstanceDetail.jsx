import Injected from './Injected.jsx'

function Verdict({ run }) {
  if (!run) return <span className="verdict na">not run</span>
  return (
    <span className={`verdict ${run.verdict === 'unsafe' ? 'block' : 'allow'}`}>
      {run.verdict}
      {run.p_unsafe != null && ` ${run.p_unsafe.toFixed(2)}`}
    </span>
  )
}

export default function InstanceDetail({ record, colSpan }) {
  if (!record) {
    return (
      <tr className="detail">
        <td colSpan={colSpan}>
          <div className="detail-inner">
            <p className="note" style={{ margin: 0 }}>
              No reconstruction for this instance yet.
            </p>
          </div>
        </td>
      </tr>
    )
  }

  const { support, flip, original } = record

  return (
    <tr className="detail">
      <td colSpan={colSpan}>
        <div className="detail-inner">
          <div className="arms">
            <div className="arm">
              <h4>With the assumption the prediction needs</h4>
              <Injected original={record.instance} injection={support?.injection} />
              <Verdict run={support?.run || original} />
            </div>

            <div className="arrow" aria-hidden="true">&#8594;</div>

            <div className="arm">
              <h4>With the most plausible assumption for the opposite prediction</h4>
              {flip?.assumption ? (
                <>
                  <Injected original={record.instance} injection={flip.injection} />
                  <Verdict run={flip.run} />
                </>
              ) : (
                <div className="body" style={{ color: 'var(--ink-faint)' }}>
                  No assumption cleared the plausibility bar. For this instance the prediction
                  holds up under any reasonable rereading.
                </div>
              )}
            </div>
          </div>
        </div>
      </td>
    </tr>
  )
}