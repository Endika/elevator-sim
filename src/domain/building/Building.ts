import type { BuildingConfig, CarSpec, Floor, FloorId, IdlePolicy } from '../config/BuildingConfig';
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
