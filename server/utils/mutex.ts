/**
 * A minimal FIFO async mutex. Used to serialise read-modify-write sequences
 * (counters, customer statistics) inside this Node process.
 *
 * NOTE: this only protects a single process. Cross-process atomicity is
 * provided by the Apps Script driver via LockService — see sheets/drivers.
 */
export class Mutex {
  private queue: Array<() => void> = [];
  private locked = false;

  async acquire(): Promise<() => void> {
    if (!this.locked) {
      this.locked = true;
      return this.release;
    }
    return new Promise<() => void>((resolve) => {
      this.queue.push(() => resolve(this.release));
    });
  }

  private release = (): void => {
    const next = this.queue.shift();
    if (next) {
      next();
      return;
    }
    this.locked = false;
  };

  async runExclusive<T>(fn: () => Promise<T>): Promise<T> {
    const release = await this.acquire();
    try {
      return await fn();
    } finally {
      release();
    }
  }
}

const namedLocks = new Map<string, Mutex>();

/** Serialise work under a named lock, e.g. 'counter:OR_NUMBER'. */
export function withNamedLock<T>(name: string, fn: () => Promise<T>): Promise<T> {
  let lock = namedLocks.get(name);
  if (!lock) {
    lock = new Mutex();
    namedLocks.set(name, lock);
  }
  return lock.runExclusive(fn);
}
