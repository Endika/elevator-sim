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
`etd` (estimated waiting cost, the family modern controllers belong to).

Idle parking policy is a separate, crossable dimension — not baked into the algorithm — because it
turns out to matter more than the algorithm in a tall building.

Two yardsticks sit outside that comparison:

- **`unavoidableJourneyTime`** — a provable lower bound within the model: the car already at your
  floor, nobody else in the building. Subtract it and what remains is pure overhead.
- **`clairvoyant`** — handed the passenger stream, allowed to see arrivals that have not happened.
  Impossible in reality, and **not an optimum**: under saturation it loses to `collective`.

Destination dispatch is deliberately not modelled — doing it faithfully needs boarding by
destination rather than by direction, which changes the engine's contract. The diagnosis
questionnaire says so outright instead of pretending otherwise.

## What it found

Full write-up in `../elevator-sim-notes/report.md`. The headlines, all from 30 seeds with paired
intervals:

- **In a 7-floor block with one car, the algorithm does matter** — `nearest-car` beats `collective`
  by 3.1 s of a 29.6 s wait (95% interval −4.7 to −1.6). But **half of every single-floor trip is
  doors, start delay and levelling**, and 56% of the whole journey is overhead above the physical
  minimum. Both facts are true; quoting one without the other misleads.
- **Where the car waits when idle can matter more than the algorithm.** In a 6-car tower the idle
  policy moves the mean wait by 5.5 s while the best algorithm moves it by 0.4 s — a factor of 12.
- **The best algorithm depends on the traffic.** `collective`'s directional sweep wins the morning
  rush and loses badly to everything, even `fcfs`, on interfloor traffic.
- **Under saturation the sweep wins and greedy cost minimisation collapses** — and the clairvoyant
  reference, handed the future, comes out 15% *worse* than `collective`. Which is precisely why it
  is labelled a reference and never an optimum.
- **Validated against the classical up-peak round trip calculation** to within 0.3% on two of three
  buildings.

## Development

```sh
npm install
npm run dev
npm run lint && npm run typecheck && npm test && npm run build

# Batch sweeps for the report — same engine as the browser
npm run sweep -- --preset residential-low --pattern all --idle all --seeds 30 --out out.json
```

Live: <https://endika.github.io/elevator-sim/>

## License

MIT
