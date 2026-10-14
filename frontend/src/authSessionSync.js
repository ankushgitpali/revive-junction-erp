export function createAuthSessionSync(setSession, setLoading) {
  let authEventReceived = false;
  let active = true;

  return {
    applyInitialSession(session) {
      if (!active || authEventReceived) return false;
      setSession(session);
      setLoading(false);
      return true;
    },
    applyAuthEvent(session) {
      if (!active) return false;
      authEventReceived = true;
      setSession(session);
      setLoading(false);
      return true;
    },
    finishInitialLoad() {
      if (!active || authEventReceived) return false;
      setLoading(false);
      return true;
    },
    dispose() {
      active = false;
    },
  };
}
