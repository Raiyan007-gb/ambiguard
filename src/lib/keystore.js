import { useEffect, useState } from 'react'

const DB_NAME = 'ambiguard'
const STORE = 'keystore'
const WRAP_ID = 'wrap'

// The envelope lives in sessionStorage, not IndexedDB, so it dies with the tab.
// IndexedDB would outlive a browser restart and hand one participant's key to
// the next on a shared machine. The orphaned wrapping key left in IndexedDB
// decrypts nothing once the envelope is gone.
//
// Namespaced because GitHub Pages project sites share one origin
// (https://uofthcdslab.github.io) and storage is scoped to origin, not path.
const ENVELOPE = 'ambiguard:openrouter-key'

function openDb() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1)
    req.onupgradeneeded = () => req.result.createObjectStore(STORE)
    req.onsuccess = () => resolve(req.result)
    req.onerror = () => reject(req.error)
  })
}

function tx(db, mode, fn) {
  return new Promise((resolve, reject) => {
    const req = fn(db.transaction(STORE, mode).objectStore(STORE))
    req.onsuccess = () => resolve(req.result)
    req.onerror = () => reject(req.error)
  })
}

// extractable: false keeps the raw bytes out of the JS heap. exportKey() throws
// on this handle, so the wrapping key can be used but never read back out of
// IndexedDB. SECURITY.md records what that does and does not defend against.
async function wrappingKey() {
  const db = await openDb()
  const found = await tx(db, 'readonly', (s) => s.get(WRAP_ID))
  if (found) return found
  const key = await crypto.subtle.generateKey(
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt'],
  )
  await tx(db, 'readwrite', (s) => s.put(key, WRAP_ID))
  return key
}

async function write(value) {
  if (!value) {
    sessionStorage.removeItem(ENVELOPE)
    return
  }
  const iv = crypto.getRandomValues(new Uint8Array(12))
  const ct = await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv },
    await wrappingKey(),
    new TextEncoder().encode(value),
  )
  sessionStorage.setItem(
    ENVELOPE,
    JSON.stringify({ iv: [...iv], ct: [...new Uint8Array(ct)] }),
  )
}

async function read() {
  const raw = sessionStorage.getItem(ENVELOPE)
  if (!raw) return ''
  const { iv, ct } = JSON.parse(raw)
  const plain = await crypto.subtle.decrypt(
    { name: 'AES-GCM', iv: new Uint8Array(iv) },
    await wrappingKey(),
    new Uint8Array(ct),
  )
  return new TextDecoder().decode(plain)
}

// Encrypting is async, so two keystrokes can finish out of order and persist a
// stale prefix over the newer value. Chaining pins the last write to the last
// value typed.
let queue = Promise.resolve()

function save(value) {
  queue = queue.then(() => write(value)).catch(() => {})
  return queue
}

// A browser that blocks IndexedDB or serves the page over plain http has no
// crypto.subtle, so every path above rejects. The catch degrades to holding the
// key in memory for this page view instead of breaking the panel.
export function useApiKey() {
  const [apiKey, setApiKey] = useState('')
  const [loaded, setLoaded] = useState(false)

  useEffect(() => {
    let cancelled = false
    read().catch(() => '').then((value) => {
      if (cancelled) return
      if (value) setApiKey(value)
      setLoaded(true)
    })
    return () => { cancelled = true }
  }, [])

  // Writing before the first read resolves would persist the empty initial
  // state over a stored envelope.
  useEffect(() => {
    if (!loaded) return
    save(apiKey)
  }, [apiKey, loaded])

  return [apiKey, setApiKey]
}
