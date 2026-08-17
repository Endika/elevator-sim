/**
 * Order is (time, priority, insertion sequence). The last term matters: without it two events at
 * the same instant could come out in heap order, and two runs of one seed would diverge.
 */

/** Within one instant: buttons are seen, then motion resolves, then cars decide. */
export const PRIORITY = {
  passengerArrival: 0,
  carMotion: 1,
  carDecision: 2,
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

  push(time: number, priority: number, payload: T): void {
    if (!Number.isFinite(time)) {
      throw new Error(`Event time must be finite; got ${time}.`);
    }
    this.heap.push({ time, priority, payload, sequence: this.sequence });
    this.sequence += 1;
    this.siftUp(this.heap.length - 1);
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
