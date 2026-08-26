import { GUARDS } from '../config.js'

export default function ModelPanel({ guardId, setGuardId, apiKey, setApiKey }) {
  return (
    <section className="panel">
      <h2>Guardrail model</h2>

      <div className="field">
        <label htmlFor="guard">Guard</label>
        <select id="guard" value={guardId} onChange={(e) => setGuardId(e.target.value)}>
          {GUARDS.map((g) => (
            <option key={g.id} value={g.id}>{g.label}</option>
          ))}
        </select>
      </div>

      <div className="field">
        <label htmlFor="key">
          OpenRouter API key — only needed for instances that are not precomputed
        </label>
        <div className="key-row">
          <input
            id="key"
            type="password"
            value={apiKey}
            // Chrome ignores autoComplete="off" on password fields: it offered to
            // save a pasted key and then autofilled it back on later visits, which
            // parks the key in the browser's credential store (and syncs it to the
            // signed-in account) long after the tab that owned it is gone.
            // "new-password" is the value Chrome honours to suppress that.
            autoComplete="new-password"
            spellCheck={false}
            placeholder="sk-or-..."
            onChange={(e) => setApiKey(e.target.value)}
          />
          <button
            className="secondary"
            disabled={!apiKey}
            aria-label="Remove the stored API key"
            onClick={() => setApiKey('')}
          >
            Remove
          </button>
        </div>
        <p className="note">
          Only needed for instances that are not already precomputed. The key is stored
          <b> encrypted</b>, under a key the browser will not let any script read, so it
          survives a reload without sitting in readable storage. It is discarded when you
          close the tab, or straight away if you press <b>Remove</b>. It is still
          <b> visible in the network request</b> to OpenRouter, because the browser is what
          calls the API. Use a project-scoped key with a small credit budget, and rotate it
          after the session.
        </p>
      </div>
    </section>
  )
}