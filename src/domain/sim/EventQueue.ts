/**
 * A time-ordered event queue with a fully determined order.
 *
 * Ties matter more than they look. Two events at the same instant must always come out in the
 * same order, or two runs of the same seed diverge and the whole paired-comparison method
 * collapses. Order is therefore (time, priority, insertion sequence) — never heap accident.
 */

export const PRIORITY = {
  /** A passenger presses a button before any car reacts at the same instant. */
  passengerArrival: 0,
  /** Doors and travel resolve next. */
  carMotion: 1,
  /** Decisions come last, so they see everything that happened at this instant. */
  carDecision: 2,
  /** Idle parking is the lowest priority of all. */
  idleCheck: 3,
} as const;

export interface QueuedEvent<T> {
  readonly time: number;
  readonly priority: number;
  readonly payload: T;
}

interface Entry<T> extends QueuedEvent<T> {
  readonly sequence: number;
}

function comesFirst<T>(a: Entry<T>, b: Entry<T>): boolean {
  if (a.time !== b.time) return a.time < b.time;
  if (a.priority !== b.priority) return a.priority < b.priority;
  return a.sequence < b.sequence;
}

export class EventQueue<T> {
  private readonly heap: Entry<T>[] = [];
  private sequence = 0;

  get size(): number {
    return this.heap.length;
  }

  push(time: number, priority: number, payload: T): void {
    if (!Number.isFinite(time)) {
      throw new Error(`Event time must be finite; got ${time}.`);
    }
    this.heap.push({ time, priority, payload, sequence: this.sequence });
    this.sequence += 1;
    this.siftUp(this.heap.length - 1);
  }

  peekTime(): number | null {
    return this.heap[0]?.time ?? null;
  }

  pop(): QueuedEvent<T> | null {
    const top = this.heap[0];
    if (!top) return null;

    const last = this.heap.pop();
    if (last && this.heap.length > 0) {
      this.heap[0] = last;
      this.siftDown(0);
    }
    return { time: top.time, priority: top.priority, payload: top.payload };
  }

  private siftUp(start: number): void {
    let index = start;
    while (index > 0) {
      const parent = (index - 1) >> 1;
      const child = this.heap[index];
      const above = this.heap[parent];
      if (!child || !above || !comesFirst(child, above)) break;
      this.heap[index] = above;
      this.heap[parent] = child;
      index = parent;
    }
  }

  private siftDown(start: number): void {
    let index = start;
    for (;;) {
      const left = index * 2 + 1;
      const right = left + 1;
      let smallest = index;

      const atLeft = this.heap[left];
      const atRight = this.heap[right];
      const atSmallest = this.heap[smallest];
      if (!atSmallest) break;

      if (atLeft && comesFirst(atLeft, atSmallest)) smallest = left;
      const candidate = this.heap[smallest];
      if (atRight && candidate && comesFirst(atRight, candidate)) smallest = right;

      if (smallest === index) break;

      const swap = this.heap[smallest];
      const current = this.heap[index];
      if (!swap || !current) break;
      this.heap[index] = swap;
      this.heap[smallest] = current;
      index = smallest;
    }
  }
}
