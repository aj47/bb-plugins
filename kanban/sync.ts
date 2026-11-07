// Keeps the page's copy of the board in step with the file. Realtime signals
// are ephemeral, so the page also reloads whenever it may have missed one, and
// only the newest load may touch the page: a slow, older response must not
// replace newer state.
export type Loader<T> = () => Promise<T>;

export function createBoardSync<T>(load: Loader<T>, apply: (value: T) => void, fail: (cause: unknown) => void) {
  let latest = 0;

  async function refetch() {
    const request = ++latest;
    try {
      const value = await load();
      if (request === latest) apply(value);
    } catch (cause) {
      if (request === latest) fail(cause);
    }
  }

  /**
   * Finish a write. Reloading on failure too drops an optimistic move the
   * server refused; the error is reported after the reload, which clears it.
   */
  async function settle(write: Promise<unknown>) {
    try {
      await write;
    } catch (cause) {
      await refetch();
      fail(cause);
      return;
    }
    await refetch();
  }

  return { refetch, settle };
}
