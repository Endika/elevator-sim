import type {
  BuildingConfig,
  CarSpec,
  Floor,
  FloorId,
  IdlePolicy,
  LandingButtons,
} from '../config/BuildingConfig';
import { parseBuilding } from '../config/BuildingConfig';

export class Building {
  private readonly byId: ReadonlyMap<FloorId, Floor>;

  private constructor(private readonly config: BuildingConfig) {
    this.byId = new Map(config.floors.map((floor) => [floor.id, floor]));
  }

  static of(config: BuildingConfig): Building {
    return new Building(config);
  }

  static parse(config: BuildingConfig): Building {
    return new Building(parseBuilding(config));
  }

  get name(): string {
    return this.config.name;
  }

  get floors(): readonly Floor[] {
    return this.config.floors;
  }

  get cars(): readonly CarSpec[] {
    return this.config.cars;
  }

  get destinationEntry(): boolean {
    return this.config.destinationEntry;
  }

  get landingButtons(): LandingButtons {
    return this.config.landingButtons;
  }

  /** True where the landing offers no way to say which direction you want. */
  singleButtonAt(floor: FloorId): boolean {
    if (this.landingButtons === 'single-any-direction') return true;
    const main = this.mainEntrance;
    return this.landingButtons === 'down-only' && main !== null && floor > main.id;
  }

  /** True where a single-button call stops a car travelling either way. */
  stopsEitherWayAt(floor: FloorId): boolean {
    return this.landingButtons === 'single-any-direction' && this.singleButtonAt(floor);
  }

  get idlePolicy(): IdlePolicy {
    return this.config.idlePolicy;
  }

  get idleDelaySeconds(): number {
    return this.config.idleDelaySeconds;
  }

  get floorIds(): readonly FloorId[] {
    return this.config.floors.map((floor) => floor.id);
  }

  get entrances(): readonly Floor[] {
    return this.config.floors.filter((floor) => floor.isEntrance);
  }

  /**
   * The street door, not the garage. A building with a basement entrance has two ways in, but the
   * main terminal — where a lift parks and what the up-peak calculation is built around — is the
   * ground floor. Taking the lowest entrance instead sends the car to wait in the car park.
   */
  get mainEntrance(): Floor | null {
    const entrances = this.entrances;
    return entrances.find((floor) => floor.id === 0) ?? entrances[0] ?? null;
  }

  get occupied(): readonly Floor[] {
    return this.config.floors.filter((floor) => floor.population > 0);
  }

  get totalPopulation(): number {
    return this.config.floors.reduce((sum, floor) => sum + floor.population, 0);
  }

  get busiest(): Floor | null {
    return (
      [...this.config.floors].sort((a, b) => b.population - a.population || a.id - b.id)[0] ?? null
    );
  }

  get middle(): Floor | null {
    return this.config.floors[Math.floor(this.config.floors.length / 2)] ?? null;
  }

  has(floor: FloorId): boolean {
    return this.byId.has(floor);
  }

  at(floor: FloorId): Floor {
    const found = this.byId.get(floor);
    if (!found) throw new Error(`Floor ${floor} is not in ${this.name}.`);
    return found;
  }

  heightOf(floor: FloorId): number {
    return this.at(floor).heightAboveGround;
  }

  /** Metres between two floors, always positive. */
  gap(from: FloorId, to: FloorId): number {
    return Math.abs(this.heightOf(to) - this.heightOf(from));
  }

  toConfig(): BuildingConfig {
    return this.config;
  }
}
