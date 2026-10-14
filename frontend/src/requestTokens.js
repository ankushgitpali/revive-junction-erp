function createUuid() {
  if (globalThis.crypto?.randomUUID) return globalThis.crypto.randomUUID();
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, character => {
    const random = Math.floor(Math.random() * 16);
    return (character === 'x' ? random : (random & 0x3) | 0x8).toString(16);
  });
}

export async function getRequestToken(reference, payload, workflowKey = 'transaction') {
  return getPersistentRequestToken(reference, payload, workflowKey);
}

export function clearRequestToken(reference) {
  const pending = reference.current;
  if (pending?.storageKey) {
    try {
      globalThis.localStorage?.removeItem(pending.storageKey);
    } catch {
      // Storage can be disabled; the in-memory request token is still cleared.
    }
  }
  reference.current = null;
}

export async function getPersistentRequestToken(reference, payload, workflowKey = 'transaction') {
  const signature = JSON.stringify(payload);
  if (reference.current?.signature === signature) return reference.current;

  const fingerprint = await fingerprintPayload(signature);
  if (reference.current?.signature === signature) return reference.current;
  if (!fingerprint) {
    reference.current = { id: createUuid(), signature, createdAt: new Date().toISOString() };
    return reference.current;
  }
  const storageKey = `rj:pending:${workflowKey}:${fingerprint}`;
  let pending = null;
  try {
    const saved = globalThis.localStorage?.getItem(storageKey);
    if (saved) {
      const parsed = JSON.parse(saved);
      if (parsed?.fingerprint === fingerprint && parsed.id && parsed.createdAt) pending = parsed;
    }
  } catch {
    // Fall back to the in-memory token when browser storage is unavailable.
  }

  if (!pending) {
    pending = { id: createUuid(), createdAt: new Date().toISOString(), fingerprint };
    try {
      globalThis.localStorage?.setItem(storageKey, JSON.stringify(pending));
    } catch {
      // The operation remains protected from double clicks for this page session.
    }
  }

  reference.current = { ...pending, signature, storageKey };
  return reference.current;
}

async function fingerprintPayload(value) {
  if (!globalThis.crypto?.subtle || !globalThis.TextEncoder) return null;
  try {
    const digest = await globalThis.crypto.subtle.digest('SHA-256', new TextEncoder().encode(value));
    return [...new Uint8Array(digest)].map(byte => byte.toString(16).padStart(2, '0')).join('');
  } catch {
    return null;
  }
}
