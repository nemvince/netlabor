/** Unbounded async queue that also behaves as an async iterator. */

export class AsyncQueue<T> implements AsyncIteratorObject<T> {
  private readonly buffer: T[] = [];
  private waiters: ((result: IteratorResult<T>) => void)[] = [];
  private closed = false;

  push(item: T): void {
    if (this.closed) return;
    const waiter = this.waiters.shift();
    if (waiter) waiter({ value: item, done: false });
    else this.buffer.push(item);
  }

  close(): void {
    if (this.closed) return;
    this.closed = true;
    for (const waiter of this.waiters.splice(0)) waiter({ value: undefined, done: true });
  }

  next(): Promise<IteratorResult<T>> {
    if (this.buffer.length > 0) {
      const value = this.buffer.shift() as T;
      return Promise.resolve({ value, done: false });
    }
    if (this.closed) return Promise.resolve({ value: undefined, done: true });
    const { promise, resolve } = Promise.withResolvers<IteratorResult<T>>();
    this.waiters.push(resolve);
    return promise;
  }

  return(): Promise<IteratorResult<T>> {
    this.close();
    return Promise.resolve({ value: undefined, done: true });
  }

  throw(error?: unknown): Promise<IteratorResult<T>> {
    this.close();
    return Promise.reject(error);
  }

  [Symbol.asyncIterator](): AsyncIteratorObject<T> {
    return this;
  }

  [Symbol.asyncDispose](): Promise<void> {
    this.close();
    return Promise.resolve();
  }
}
