/**
 * A Promise that settles synchronously.
 *
 * Apps Script gives no event loop: doPost has to return its value before the
 * stack unwinds, which is exactly when a real promise would run its callbacks.
 * The services are async, so without this they could never produce an answer
 * in time.
 *
 * It works because nothing underneath is genuinely asynchronous — SpreadsheetApp,
 * LockService and Utilities all block — so every `await` in this codebase is
 * waiting on a value that already exists. Installing this as the global Promise
 * makes the compiled async functions run straight through to completion.
 *
 * The build must therefore target a level where esbuild lowers async/await onto
 * generators driven by the global Promise; see scripts/build-appsscript.mjs.
 */

type State = 'pending' | 'fulfilled' | 'rejected';

interface Callback {
  onFulfilled?: ((value: unknown) => unknown) | null;
  onRejected?: ((reason: unknown) => unknown) | null;
  resolve: (value: unknown) => void;
  reject: (reason: unknown) => void;
}

export class SyncPromise<T = unknown> {
  private state: State = 'pending';
  private value: unknown = undefined;
  private callbacks: Callback[] = [];

  constructor(
    executor: (
      resolve: (value: T | SyncPromise<T>) => void,
      reject: (reason?: unknown) => void,
    ) => void,
  ) {
    try {
      executor(
        (value) => this.settle('fulfilled', value),
        (reason) => this.settle('rejected', reason),
      );
    } catch (error) {
      this.settle('rejected', error);
    }
  }

  private settle(state: State, value: unknown): void {
    if (this.state !== 'pending') return;

    // Adopt a thenable so `resolve(anotherPromise)` behaves as promised.
    if (state === 'fulfilled' && value && typeof (value as { then?: unknown }).then === 'function') {
      try {
        (value as { then: (f: (v: unknown) => void, r: (e: unknown) => void) => void }).then(
          (inner) => this.settle('fulfilled', inner),
          (error) => this.settle('rejected', error),
        );
      } catch (error) {
        this.settle('rejected', error);
      }
      return;
    }

    this.state = state;
    this.value = value;
    const pending = this.callbacks;
    this.callbacks = [];
    for (const callback of pending) this.dispatch(callback);
  }

  private dispatch(callback: Callback): void {
    const handler = this.state === 'fulfilled' ? callback.onFulfilled : callback.onRejected;

    if (typeof handler !== 'function') {
      if (this.state === 'fulfilled') callback.resolve(this.value);
      else callback.reject(this.value);
      return;
    }

    try {
      callback.resolve(handler(this.value));
    } catch (error) {
      callback.reject(error);
    }
  }

  then<R1 = T, R2 = never>(
    onFulfilled?: ((value: T) => R1 | SyncPromise<R1>) | null,
    onRejected?: ((reason: unknown) => R2 | SyncPromise<R2>) | null,
  ): SyncPromise<R1 | R2> {
    return new SyncPromise<R1 | R2>((resolve, reject) => {
      const callback: Callback = {
        onFulfilled: onFulfilled as ((value: unknown) => unknown) | null | undefined,
        onRejected: onRejected as ((reason: unknown) => unknown) | null | undefined,
        resolve: resolve as (value: unknown) => void,
        reject,
      };
      if (this.state === 'pending') this.callbacks.push(callback);
      else this.dispatch(callback);
    });
  }

  catch<R = never>(onRejected?: ((reason: unknown) => R) | null): SyncPromise<T | R> {
    return this.then(null, onRejected);
  }

  finally(onFinally?: (() => void) | null): SyncPromise<T> {
    return this.then(
      (value) => {
        if (onFinally) onFinally();
        return value as never;
      },
      (reason) => {
        if (onFinally) onFinally();
        throw reason;
      },
    ) as SyncPromise<T>;
  }

  static resolve<V>(value?: V | SyncPromise<V>): SyncPromise<V> {
    if (value instanceof SyncPromise) return value;
    return new SyncPromise<V>((resolve) => resolve(value as V));
  }

  static reject<V = never>(reason?: unknown): SyncPromise<V> {
    return new SyncPromise<V>((_resolve, reject) => reject(reason));
  }

  static all<V>(items: Array<V | SyncPromise<V>>): SyncPromise<V[]> {
    return new SyncPromise<V[]>((resolve, reject) => {
      const list = Array.from(items);
      const results: V[] = new Array(list.length);
      let remaining = list.length;
      if (remaining === 0) {
        resolve(results);
        return;
      }
      list.forEach((item, index) => {
        SyncPromise.resolve(item).then(
          (value) => {
            results[index] = value as V;
            remaining -= 1;
            if (remaining === 0) resolve(results);
          },
          reject,
        );
      });
    });
  }

  static allSettled<V>(
    items: Array<V | SyncPromise<V>>,
  ): SyncPromise<Array<{ status: 'fulfilled'; value: V } | { status: 'rejected'; reason: unknown }>> {
    return SyncPromise.all(
      Array.from(items).map((item) =>
        SyncPromise.resolve(item).then(
          (value) => ({ status: 'fulfilled' as const, value: value as V }),
          (reason) => ({ status: 'rejected' as const, reason }),
        ),
      ),
    );
  }

  static race<V>(items: Array<V | SyncPromise<V>>): SyncPromise<V> {
    return new SyncPromise<V>((resolve, reject) => {
      for (const item of items) SyncPromise.resolve(item).then(resolve, reject);
    });
  }
}

/**
 * Read the value out of a promise that has already settled.
 *
 * If it has not settled, something genuinely asynchronous crept into a code
 * path that runs here — a real bug, and one worth failing loudly on rather than
 * returning an empty response.
 */
export function awaitSync<T>(promise: SyncPromise<T> | Promise<T>): T {
  let settled = false;
  let fulfilled = false;
  let value: unknown;
  let reason: unknown;

  (promise as SyncPromise<T>).then(
    (result) => {
      settled = true;
      fulfilled = true;
      value = result;
      return undefined as never;
    },
    (error) => {
      settled = true;
      reason = error;
      return undefined as never;
    },
  );

  if (!settled) {
    throw new Error(
      'An operation did not complete synchronously. Apps Script cannot wait for it.',
    );
  }
  if (!fulfilled) throw reason;
  return value as T;
}

declare const Utilities: { sleep: (ms: number) => void };

/** Install the synchronous promise, plus a timer shim built on Utilities.sleep. */
export function installSyncRuntime(): void {
  const target = globalThis as unknown as Record<string, unknown>;
  target.Promise = SyncPromise;

  if (typeof target.setTimeout !== 'function') {
    target.setTimeout = (fn: () => void, ms?: number): number => {
      if (ms && ms > 0) Utilities.sleep(ms);
      fn();
      return 0;
    };
    target.clearTimeout = (): void => undefined;
  }
}
