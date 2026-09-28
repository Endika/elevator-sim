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
- **30 seeds by default** (2 at the least), reported as mean, spread and the paired difference.
  When the interval crosses zero that pair is `indistinguishable`, and when every pair is, the
  verdict says the algorithm barely matters instead of naming a winner.
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

## What it tells you

Describe your building and it answers the question people actually have — **what should we
do**. It tries every change a building can make, on the same seeds and the same passengers, and
ranks them by what they are measured to save and what they cost to do:

```
−86.5 s  BUILDING WORK   2 lifts instead of 1
−45.5 s  FREE            Nobody holds the doors while loading
−39.3 s  BUILDING WORK   A car that holds 8 instead of 6
−29.9 s  A PHONE CALL    One second off the doors, each way
−19.9 s  A PHONE CALL    Switch the controller to fcfs
 −2.0 s  A PHONE CALL    Switch the controller to etd
```

That is a real answer from a real building: 5 floors, one 6-person car, 165 residents, the evening
rush. The best algorithm is worth 20 seconds and the cheapest fix is worth 45 — which is the sort of
thing you cannot guess, and the reason the tool exists.

## What it found

The headlines, all from 30 seeds with paired intervals:

- **In a 7-floor block with one car, the algorithm barely matters** — `nearest-car` and
  `collective` are within seed noise, 0.7 s apart on a 32.6 s wait (95% interval −2.1 to 0.9), and
  only `fcfs` is measurably worse, by 3.2 s. **Half of every single-floor trip is doors, start
  delay and levelling**, and 61% of the whole journey is overhead above the physical minimum.
- **Where the car waits when idle can matter more than the algorithm.** In a 6-car tower the idle
  policy moves the mean wait by 38 s while the best algorithm moves it by 10.5 s — a factor of 3.6.
  Left where they stopped, the cars fall behind the morning rush altogether.
- **The best algorithm depends on the traffic.** In the tower `collective`'s directional sweep
  beats everything on interfloor traffic and loses to `fcfs` by 34 s on the evening rush.
- **Under saturation the sweep wins and greedy cost minimisation collapses** — and the clairvoyant
  reference, handed the future, comes out 32% *worse* than `collective`. Which is precisely why it
  is labelled a reference and never an optimum.
- **Validated against the classical up-peak round trip calculation** to within 1.8% on two of three
  buildings.

## Development

```sh
npm install
npm run dev
npm run format:check && npm run lint && npm run type:check && npm run test:run && npm run build

# Batch sweeps for the report — same engine as the browser
npm run sweep -- --preset residential-low --pattern all --idle all --seeds 30 --out out.json
```

Live: <https://endika.github.io/elevator-sim/>

## License

MIT
