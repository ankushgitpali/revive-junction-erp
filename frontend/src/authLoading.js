export async function withLoadingState(setLoading, action) {
  setLoading(true);
  try {
    return await action();
  } finally {
    setLoading(false);
  }
}
