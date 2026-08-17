# elevator-sim

Describe a building, get a straight answer about which elevator dispatch algorithm suits it —
and whether the choice even matters.

Discrete-event simulator with a configurable building: floors, basements, cars, capacity,
speed, acceleration, door timings and what the car does while nobody is calling it. Runs
entirely in the browser, no backend.

## Why

Most complaints about a lift ("it went past me", "it always serves the other guy") are blamed on
the algorithm. Often the algorithm is fine and the time is going into door dwell and where the
car parks when idle. This tells the two apart with numbers instead of opinions.

## Method

- **Discrete-event simulation** with real travel physics: a one-floor hop does not reach nominal
  speed, doors take as long as doors take, a full car passes the call by.
- **Common random numbers**: for a given seed one passenger stream is generated and handed to
  every algorithm, so comparisons are paired rather than two independent means.
- **30 seeds minimum**, reported as mean, spread and the paired difference. When the interval
  crosses zero the verdict is `indistinguishable` — no winner is crowned inside the noise.
- **Validated against classical lift traffic theory**: measured up-peak handling capacity is
  checked against the closed-form round-trip-time result. If they disagree, the simulator is
  wrong and the test fails.

## Algorithms

`fcfs` · `nearest-car` · `collective` (SCAN/LOOK, what most single-car installations run) ·
`etd` (estimated cost) · `destination-dispatch` · plus an offline bound to measure everyone
against.

Idle parking policy is a separate, crossable dimension — not baked into the algorithm.

## Development

```sh
npm install
npm run dev
npm run lint && npm run typecheck && npm test && npm run build
```

## License

MIT
