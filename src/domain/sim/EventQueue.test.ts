import { describe, expect, it } from 'vitest';
import { EventQueue, PRIORITY } from './EventQueue';

function drain<T>(queue: EventQueue<T>): T[] {
  const out: T[] = [];
  for (;;) {
    const event = queue.pop();
    if (!event) return out;
    out.push(event.payload);
  }
}

describe('ordering', () => {
  it('comes out in time order regardless of insertion order', () => {
    const queue = new EventQueue<string>();
    queue.push(30, 0, 'c');
    queue.push(10, 0, 'a');
    queue.push(20, 0, 'b');
    expect(drain(queue)).toEqual(['a', 'b', 'c']);
  });

  it('breaks ties by priority, so a button press is seen before a car reacts', () => {
    const queue = new EventQueue<string>();
    queue.push(10, PRIORITY.carDecision, 'decision');
    queue.push(10, PRIORITY.passengerArrival, 'arrival');
    queue.push(10, PRIORITY.carMotion, 'motion');
    expect(drain(queue)).toEqual(['arrival', 'motion', 'decision']);
  });

  it('breaks remaining ties by insertion order, never by heap accident', () => {
    const queue = new EventQueue<string>();
    for (const label of ['first', 'second', 'third', 'fourth']) {
      queue.push(5, 1, label);
    }
    expect(drain(queue)).toEqual(['first', 'second', 'third', 'fourth']);
  });

  it('orders a large mixed batch identically every time', () => {
    const build = () => {
      const queue = new EventQueue<string>();
      // A deliberately awkward interleaving: repeated times, repeated priorities.
      for (let i = 0; i < 200; i += 1) {
        queue.push((i * 7) % 13, i % 3, `e${i}`);
      }
      return drain(queue);
    };
    expect(build()).toEqual(build());
  });

  it('keeps time order across a long run of pushes and pops', () => {
    const queue = new EventQueue<number>();
    let last = Number.NEGATIVE_INFINITY;
    for (let i = 0; i < 500; i += 1) queue.push((i * 31) % 97, 0, i);
    for (;;) {
      const event = queue.pop();
      if (!event) break;
      expect(event.time).toBeGreaterThanOrEqual(last);
      last = event.time;
      // Re-queue each qualifying event exactly once. The 1000 offset marks it as already
      // re-queued; without that check the loop feeds itself forever, since payload + 1000 is
      // still a multiple of 5.
      if (event.payload < 1000 && event.payload % 5 === 0) {
        queue.push(event.time + 3, 0, event.payload + 1000);
      }
    }
  });
});

describe('bookkeeping', () => {
  it('reports its size', () => {
    const queue = new EventQueue<string>();
    expect(queue.size).toBe(0);
    queue.push(1, 0, 'a');
    queue.push(2, 0, 'b');
    expect(queue.size).toBe(2);
    queue.pop();
    expect(queue.size).toBe(1);
  });

  it('peeks the next time without consuming', () => {
    const queue = new EventQueue<string>();
    queue.push(9, 0, 'later');
    queue.push(4, 0, 'sooner');
    expect(queue.peekTime()).toBe(4);
    expect(queue.size).toBe(2);
  });

  it('returns null when empty rather than undefined behaviour', () => {
    const queue = new EventQueue<string>();
    expect(queue.pop()).toBeNull();
    expect(queue.peekTime()).toBeNull();
  });

  it('rejects a non-finite time, which would poison the ordering', () => {
    const queue = new EventQueue<string>();
    expect(() => queue.push(Number.POSITIVE_INFINITY, 0, 'x')).toThrow(/must be finite/);
    expect(() => queue.push(Number.NaN, 0, 'x')).toThrow(/must be finite/);
  });
});
