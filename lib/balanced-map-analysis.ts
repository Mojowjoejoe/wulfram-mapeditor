import { rotationalTerrainMismatches } from './balanced-map-generator.ts';
import {
  sampleSlopeDegrees,
  validateProject,
  type StateEntity,
  type TerrainData,
  type ValidationIssue,
  type WulframProject,
} from './wulfram.ts';

export interface BalancedTraversalProfile {
  maxSlopeDegrees: number;
  minimumTraversableFraction: number;
  targetTraversableFraction: number;
  minimumRouteCount: number;
  routeSeparationVertices: number;
  minimumRouteClearanceVertices: number;
  maximumAnchorSnapVertices: number;
  objectiveRadiusVertices: number;
  minimumReachableFraction: number;
  minimumReachableHighGroundFraction: number;
  pairedCostTolerance: number;
}

export interface BalanceGate {
  code: string;
  passed: boolean;
  message: string;
}

export interface TeamTraversalMetrics {
  anchor: [number, number];
  anchorVertex: [number, number] | null;
  reachableFractionOfTraversable: number;
  objectiveCost: number | null;
  routeCount: number;
  alternateObjectiveCost: number | null;
  reachableHighGroundFraction: number;
}

export interface BalancedTerrainAnalysis {
  passed: boolean;
  profile: BalancedTraversalProfile;
  gates: BalanceGate[];
  metrics: {
    terrainVertices: number;
    finiteVertices: number;
    rotationalMismatches: number;
    traversableVertices: number;
    traversableFraction: number;
    clearanceTraversableVertices: number;
    clearanceTraversableFraction: number;
    highGroundThreshold: number | null;
    pairedObjectiveCostDelta: number | null;
    pairedObjectiveCostDeltaRatio: number | null;
    teams: [TeamTraversalMetrics, TeamTraversalMetrics];
  };
}

export interface EntityPairingAnalysis {
  passed: boolean;
  matchedPairs: number;
  mismatchCount: number;
  maximumPlanarDelta: number;
  maximumHeightDelta: number;
  maximumRotationDelta: number;
  message: string;
}

export interface BalancedProjectAnalysis {
  passed: boolean;
  terrain: BalancedTerrainAnalysis;
  entityPairing: EntityPairingAnalysis;
  projectIssues: ValidationIssue[];
  projectErrorCount: number;
  projectWarningCount: number;
}

export const DEFAULT_BALANCED_TRAVERSAL_PROFILE: BalancedTraversalProfile = {
  maxSlopeDegrees: 22,
  minimumTraversableFraction: 0.58,
  targetTraversableFraction: 0.7,
  minimumRouteCount: 2,
  routeSeparationVertices: 2,
  minimumRouteClearanceVertices: 1,
  maximumAnchorSnapVertices: 3,
  objectiveRadiusVertices: 2,
  minimumReachableFraction: 0.7,
  minimumReachableHighGroundFraction: 0.5,
  pairedCostTolerance: 1e-9,
};

const MAX_ANALYSIS_DIMENSION = 513;
const ENTITY_PLANAR_TOLERANCE = 1e-6;
const ENTITY_HEIGHT_TOLERANCE = 1;
const ENTITY_ROTATION_TOLERANCE = 1e-6;

function angularDelta(left: number, right: number): number {
  const fullTurn = Math.PI * 2;
  const difference = Math.abs(((left - right + Math.PI) % fullTurn + fullTurn) % fullTurn - Math.PI);
  return difference;
}

function sameEntityKind(left: StateEntity, right: StateEntity): boolean {
  return left.token === right.token
    && left.subtype === right.subtype
    && left.active === right.active;
}

export function analyzeRotationalEntityPairs(project: WulframProject): EntityPairingAnalysis {
  const firstTeam = project.entities.filter((entity) => entity.team === 1);
  const secondTeam = project.entities.filter((entity) => entity.team === 2);
  const neutral = project.entities.filter((entity) => entity.team !== 1 && entity.team !== 2);
  const usedSecond = new Set<number>();
  const usedNeutral = new Set<number>();
  let matchedPairs = 0;
  let mismatchCount = 0;
  let maximumPlanarDelta = 0;
  let maximumHeightDelta = 0;
  let maximumRotationDelta = 0;

  const comparePair = (left: StateEntity, right: StateEntity, expectedTeam: number) => {
    const expectedX = project.terrain.worldWidth - left.position[0];
    const expectedY = project.terrain.worldHeight - left.position[1];
    const planarDelta = Math.hypot(right.position[0] - expectedX, right.position[1] - expectedY);
    const heightDelta = Math.abs(right.position[2] - left.position[2]);
    const rotationDelta = Math.max(
      angularDelta(right.rotation[0], left.rotation[0]),
      angularDelta(right.rotation[1], left.rotation[1]),
      angularDelta(right.rotation[2], left.rotation[2] + Math.PI),
    );
    maximumPlanarDelta = Math.max(maximumPlanarDelta, planarDelta);
    maximumHeightDelta = Math.max(maximumHeightDelta, heightDelta);
    maximumRotationDelta = Math.max(maximumRotationDelta, rotationDelta);
    matchedPairs += 1;
    if (!sameEntityKind(left, right)
      || right.team !== expectedTeam
      || planarDelta > ENTITY_PLANAR_TOLERANCE
      || heightDelta > ENTITY_HEIGHT_TOLERANCE
      || rotationDelta > ENTITY_ROTATION_TOLERANCE) mismatchCount += 1;
  };

  for (const entity of firstTeam) {
    const expectedX = project.terrain.worldWidth - entity.position[0];
    const expectedY = project.terrain.worldHeight - entity.position[1];
    let matchIndex = -1;
    let bestDistance = Number.POSITIVE_INFINITY;
    for (let index = 0; index < secondTeam.length; index += 1) {
      if (usedSecond.has(index) || !sameEntityKind(entity, secondTeam[index])) continue;
      const distance = Math.hypot(
        secondTeam[index].position[0] - expectedX,
        secondTeam[index].position[1] - expectedY,
      );
      if (distance < bestDistance) {
        bestDistance = distance;
        matchIndex = index;
      }
    }
    if (matchIndex < 0) {
      mismatchCount += 1;
      continue;
    }
    usedSecond.add(matchIndex);
    comparePair(entity, secondTeam[matchIndex], 2);
  }
  mismatchCount += secondTeam.length - usedSecond.size;

  const centerX = project.terrain.worldWidth * 0.5;
  const centerY = project.terrain.worldHeight * 0.5;
  for (let index = 0; index < neutral.length; index += 1) {
    if (usedNeutral.has(index)) continue;
    const entity = neutral[index];
    if (Math.hypot(entity.position[0] - centerX, entity.position[1] - centerY) <= ENTITY_PLANAR_TOLERANCE) {
      usedNeutral.add(index);
      continue;
    }
    const expectedX = project.terrain.worldWidth - entity.position[0];
    const expectedY = project.terrain.worldHeight - entity.position[1];
    let matchIndex = -1;
    let bestDistance = Number.POSITIVE_INFINITY;
    for (let candidateIndex = index + 1; candidateIndex < neutral.length; candidateIndex += 1) {
      if (usedNeutral.has(candidateIndex) || !sameEntityKind(entity, neutral[candidateIndex])) continue;
      const distance = Math.hypot(
        neutral[candidateIndex].position[0] - expectedX,
        neutral[candidateIndex].position[1] - expectedY,
      );
      if (distance < bestDistance) {
        bestDistance = distance;
        matchIndex = candidateIndex;
      }
    }
    if (matchIndex < 0) {
      mismatchCount += 1;
      usedNeutral.add(index);
      continue;
    }
    usedNeutral.add(index);
    usedNeutral.add(matchIndex);
    comparePair(entity, neutral[matchIndex], entity.team);
  }

  const passed = mismatchCount === 0 && firstTeam.length === secondTeam.length;
  return {
    passed,
    matchedPairs,
    mismatchCount,
    maximumPlanarDelta,
    maximumHeightDelta,
    maximumRotationDelta,
    message: passed
      ? `${matchedPairs} team/neutral entity pairs satisfy the rotational transform.`
      : `${mismatchCount} entity pairing mismatch${mismatchCount === 1 ? '' : 'es'} detected.`,
  };
}

interface HeapEntry {
  cost: number;
  index: number;
}

class MinimumHeap {
  #values: HeapEntry[] = [];

  get length(): number {
    return this.#values.length;
  }

  push(entry: HeapEntry): void {
    this.#values.push(entry);
    let index = this.#values.length - 1;
    while (index > 0) {
      const parent = Math.floor((index - 1) / 2);
      const parentEntry = this.#values[parent];
      if (parentEntry.cost < entry.cost
        || (parentEntry.cost === entry.cost && parentEntry.index <= entry.index)) break;
      this.#values[index] = parentEntry;
      index = parent;
    }
    this.#values[index] = entry;
  }

  pop(): HeapEntry | undefined {
    const first = this.#values[0];
    const last = this.#values.pop();
    if (!first || !last || this.#values.length === 0) return first;
    let index = 0;
    while (true) {
      const left = index * 2 + 1;
      const right = left + 1;
      if (left >= this.#values.length) break;
      let child = left;
      if (right < this.#values.length) {
        const leftEntry = this.#values[left];
        const rightEntry = this.#values[right];
        if (rightEntry.cost < leftEntry.cost
          || (rightEntry.cost === leftEntry.cost && rightEntry.index < leftEntry.index)) child = right;
      }
      const childEntry = this.#values[child];
      if (childEntry.cost > last.cost
        || (childEntry.cost === last.cost && childEntry.index >= last.index)) break;
      this.#values[index] = childEntry;
      index = child;
    }
    this.#values[index] = last;
    return first;
  }
}

interface PathResult {
  cost: number;
  path: number[];
  reached: Uint8Array;
}

function validateProfile(profile: BalancedTraversalProfile): void {
  const finite = Object.entries(profile).filter(([, value]) => !Number.isFinite(value));
  if (finite.length) throw new Error(`${finite[0][0]} must be finite.`);
  if (profile.maxSlopeDegrees < 0 || profile.maxSlopeDegrees > 90) {
    throw new Error('maxSlopeDegrees must be from 0 through 90.');
  }
  if (profile.minimumTraversableFraction < 0 || profile.minimumTraversableFraction > 1
    || profile.targetTraversableFraction < 0 || profile.targetTraversableFraction > 1) {
    throw new Error('Traversable fractions must be from 0 through 1.');
  }
  if (profile.targetTraversableFraction < profile.minimumTraversableFraction) {
    throw new Error('Target traversable fraction cannot be lower than the minimum.');
  }
  if (!Number.isInteger(profile.minimumRouteCount) || profile.minimumRouteCount < 1
    || !Number.isInteger(profile.routeSeparationVertices) || profile.routeSeparationVertices < 0
    || !Number.isInteger(profile.minimumRouteClearanceVertices) || profile.minimumRouteClearanceVertices < 0
    || !Number.isInteger(profile.maximumAnchorSnapVertices) || profile.maximumAnchorSnapVertices < 0
    || !Number.isInteger(profile.objectiveRadiusVertices) || profile.objectiveRadiusVertices < 0) {
    throw new Error('Route counts, separation, clearance, anchor snap, and objective radius must be non-negative integers.');
  }
  if (profile.minimumReachableFraction < 0 || profile.minimumReachableFraction > 1
    || profile.minimumReachableHighGroundFraction < 0 || profile.minimumReachableHighGroundFraction > 1) {
    throw new Error('Reachable fractions must be from 0 through 1.');
  }
  if (profile.pairedCostTolerance < 0) throw new Error('pairedCostTolerance cannot be negative.');
}

function quantile(values: number[], probability: number): number | null {
  if (!values.length) return null;
  const sorted = [...values].sort((left, right) => left - right);
  const position = (sorted.length - 1) * probability;
  const lower = Math.floor(position);
  const upper = Math.ceil(position);
  if (lower === upper) return sorted[lower];
  return sorted[lower] + (sorted[upper] - sorted[lower]) * (position - lower);
}

function strategicHighGroundThreshold(values: number[]): number | null {
  if (!values.length) return null;
  let lower = Number.POSITIVE_INFINITY;
  let upper = Number.NEGATIVE_INFINITY;
  for (const value of values) {
    lower = Math.min(lower, value);
    upper = Math.max(upper, value);
  }
  const upperQuartile = quantile(values, 0.75)!;
  return upper > lower ? Math.max(upperQuartile, lower + (upper - lower) * 0.1) : upper;
}

function nearestPassableVertex(
  terrain: TerrainData,
  passable: Uint8Array,
  anchor: [number, number],
  maximumSnapVertices: number,
): number | undefined {
  if (!passable.length
    || !Number.isFinite(anchor?.[0]) || !Number.isFinite(anchor?.[1])
    || anchor[0] < 0 || anchor[0] > terrain.worldWidth
    || anchor[1] < 0 || anchor[1] > terrain.worldHeight) return undefined;
  const stepX = terrain.worldWidth / (terrain.width - 1);
  const stepY = terrain.worldHeight / (terrain.height - 1);
  const centerX = Math.round(anchor[0] / stepX);
  const centerY = Math.round(anchor[1] / stepY);
  let bestIndex: number | undefined;
  let bestDistance = Number.POSITIVE_INFINITY;
  for (let offsetY = -maximumSnapVertices; offsetY <= maximumSnapVertices; offsetY += 1) {
    for (let offsetX = -maximumSnapVertices; offsetX <= maximumSnapVertices; offsetX += 1) {
      if (Math.hypot(offsetX, offsetY) > maximumSnapVertices + 1e-9) continue;
      const x = centerX + offsetX;
      const y = centerY + offsetY;
      if (x < 0 || x >= terrain.width || y < 0 || y >= terrain.height) continue;
      const index = y * terrain.width + x;
      if (!passable[index]) continue;
      const distance = Math.hypot(x * stepX - anchor[0], y * stepY - anchor[1]);
      if (distance < bestDistance || (distance === bestDistance && index < (bestIndex ?? Number.POSITIVE_INFINITY))) {
        bestDistance = distance;
        bestIndex = index;
      }
    }
  }
  return bestIndex;
}

function clearancePassableMask(
  passable: Uint8Array,
  width: number,
  height: number,
  clearanceVertices: number,
): Uint8Array {
  if (clearanceVertices === 0) return passable.slice();
  const cleared = new Uint8Array(passable.length);
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const index = y * width + x;
      if (!passable[index]) continue;
      let hasClearance = true;
      for (let offsetY = -clearanceVertices; offsetY <= clearanceVertices && hasClearance; offsetY += 1) {
        for (let offsetX = -clearanceVertices; offsetX <= clearanceVertices; offsetX += 1) {
          if (Math.hypot(offsetX, offsetY) > clearanceVertices + 1e-9) continue;
          const candidateX = x + offsetX;
          const candidateY = y + offsetY;
          if (candidateX < 0 || candidateX >= width || candidateY < 0 || candidateY >= height
            || !passable[candidateY * width + candidateX]) {
            hasClearance = false;
            break;
          }
        }
      }
      if (hasClearance) cleared[index] = 1;
    }
  }
  return cleared;
}

function validWorldAnchor(terrain: TerrainData, anchor: [number, number] | undefined): boolean {
  return Boolean(anchor
    && Number.isFinite(anchor[0]) && Number.isFinite(anchor[1])
    && anchor[0] >= 0 && anchor[0] <= terrain.worldWidth
    && anchor[1] >= 0 && anchor[1] <= terrain.worldHeight);
}

function rotationalAnchorsClose(
  terrain: TerrainData,
  anchors: Array<[number, number]>,
  tolerance = 1e-6,
): boolean {
  return anchors.length > 0 && anchors.every((anchor) => validWorldAnchor(terrain, anchor)
    && anchors.some((candidate) => (
      Math.hypot(
        candidate[0] - (terrain.worldWidth - anchor[0]),
        candidate[1] - (terrain.worldHeight - anchor[1]),
      ) <= tolerance
    )));
}

function targetVertices(
  terrain: TerrainData,
  passable: Uint8Array,
  anchors: Array<[number, number]>,
  radiusVertices: number,
): Set<number> {
  const stepX = terrain.worldWidth / (terrain.width - 1);
  const stepY = terrain.worldHeight / (terrain.height - 1);
  const targets = new Set<number>();
  for (const [worldX, worldY] of anchors) {
    const centerX = Math.round(worldX / stepX);
    const centerY = Math.round(worldY / stepY);
    for (let offsetY = -radiusVertices; offsetY <= radiusVertices; offsetY += 1) {
      for (let offsetX = -radiusVertices; offsetX <= radiusVertices; offsetX += 1) {
        if (Math.hypot(offsetX, offsetY) > radiusVertices + 1e-9) continue;
        const x = centerX + offsetX;
        const y = centerY + offsetY;
        if (x < 0 || x >= terrain.width || y < 0 || y >= terrain.height) continue;
        const index = y * terrain.width + x;
        if (passable[index]) targets.add(index);
      }
    }
  }
  return targets;
}

const NEIGHBORS = [
  [-1, -1], [0, -1], [1, -1],
  [-1, 0], [1, 0],
  [-1, 1], [0, 1], [1, 1],
] as const;

function shortestPath(
  terrain: TerrainData,
  passable: Uint8Array,
  source: number,
  targets: Set<number>,
  blocked?: Uint8Array,
): PathResult | undefined {
  if (!passable[source] || blocked?.[source] || !targets.size) return undefined;
  const distances = new Float64Array(passable.length);
  distances.fill(Number.POSITIVE_INFINITY);
  const previous = new Int32Array(passable.length);
  previous.fill(-1);
  const reached = new Uint8Array(passable.length);
  const queue = new MinimumHeap();
  distances[source] = 0;
  queue.push({ cost: 0, index: source });
  let target: number | undefined;
  const stepX = terrain.worldWidth / (terrain.width - 1);
  const stepY = terrain.worldHeight / (terrain.height - 1);
  while (queue.length) {
    const current = queue.pop()!;
    if (current.cost !== distances[current.index] || reached[current.index]) continue;
    reached[current.index] = 1;
    if (targets.has(current.index)) {
      target = current.index;
      break;
    }
    const x = current.index % terrain.width;
    const y = Math.floor(current.index / terrain.width);
    for (const [offsetX, offsetY] of NEIGHBORS) {
      const neighborX = x + offsetX;
      const neighborY = y + offsetY;
      if (neighborX < 0 || neighborX >= terrain.width || neighborY < 0 || neighborY >= terrain.height) continue;
      const neighbor = neighborY * terrain.width + neighborX;
      if (!passable[neighbor] || blocked?.[neighbor] || reached[neighbor]) continue;
      const horizontal = Math.hypot(offsetX * stepX, offsetY * stepY);
      const heightDelta = terrain.heights[neighbor] - terrain.heights[current.index];
      const cost = current.cost + Math.hypot(horizontal, heightDelta);
      if (cost < distances[neighbor] - 1e-9
        || (Math.abs(cost - distances[neighbor]) <= 1e-9 && current.index < previous[neighbor])) {
        distances[neighbor] = cost;
        previous[neighbor] = current.index;
        queue.push({ cost, index: neighbor });
      }
    }
  }
  if (target === undefined) return { cost: Number.POSITIVE_INFINITY, path: [], reached };
  const path: number[] = [];
  for (let index = target; index >= 0; index = previous[index]) {
    path.push(index);
    if (index === source) break;
  }
  path.reverse();
  return { cost: distances[target], path, reached };
}

function reachableMask(passable: Uint8Array, source: number, width: number, height: number): Uint8Array {
  const reached = new Uint8Array(passable.length);
  if (!passable[source]) return reached;
  const queue = new Int32Array(passable.length);
  let head = 0;
  let tail = 0;
  queue[tail++] = source;
  reached[source] = 1;
  while (head < tail) {
    const index = queue[head++];
    const x = index % width;
    const y = Math.floor(index / width);
    for (const [offsetX, offsetY] of NEIGHBORS) {
      const neighborX = x + offsetX;
      const neighborY = y + offsetY;
      if (neighborX < 0 || neighborX >= width || neighborY < 0 || neighborY >= height) continue;
      const neighbor = neighborY * width + neighborX;
      if (!passable[neighbor] || reached[neighbor]) continue;
      reached[neighbor] = 1;
      queue[tail++] = neighbor;
    }
  }
  return reached;
}

function separatedRouteBlock(
  width: number,
  height: number,
  path: number[],
  separation: number,
  targets: Set<number>,
): Uint8Array {
  const blocked = new Uint8Array(width * height);
  const protectedSteps = Math.max(2, separation + 1);
  for (let pathIndex = protectedSteps; pathIndex < path.length - protectedSteps; pathIndex += 1) {
    const index = path[pathIndex];
    const centerX = index % width;
    const centerY = Math.floor(index / width);
    for (let offsetY = -separation; offsetY <= separation; offsetY += 1) {
      for (let offsetX = -separation; offsetX <= separation; offsetX += 1) {
        const x = centerX + offsetX;
        const y = centerY + offsetY;
        if (x < 0 || x >= width || y < 0 || y >= height) continue;
        const candidate = y * width + x;
        if (!targets.has(candidate)) blocked[candidate] = 1;
      }
    }
  }
  return blocked;
}

function vertexCoordinates(terrain: TerrainData, index: number | undefined): [number, number] | null {
  return index === undefined ? null : [index % terrain.width, Math.floor(index / terrain.width)];
}

function analyzeTeam(
  terrain: TerrainData,
  passable: Uint8Array,
  traversableVertices: number,
  anchor: [number, number],
  objectives: Set<number>,
  highGroundThreshold: number | null,
  profile: BalancedTraversalProfile,
): TeamTraversalMetrics {
  const source = nearestPassableVertex(terrain, passable, anchor, profile.maximumAnchorSnapVertices);
  if (source === undefined) {
    return {
      anchor,
      anchorVertex: null,
      reachableFractionOfTraversable: 0,
      objectiveCost: null,
      routeCount: 0,
      alternateObjectiveCost: null,
      reachableHighGroundFraction: 0,
    };
  }
  const first = shortestPath(terrain, passable, source, objectives);
  const reached = reachableMask(passable, source, terrain.width, terrain.height);
  const reachableCount = reached.reduce((total, value) => total + value, 0);
  const highGround = highGroundThreshold === null
    ? []
    : terrain.heights.map((height, index) => ({ height, index }))
      .filter(({ height, index }) => passable[index] && height >= highGroundThreshold);
  const reachableHighGround = highGround.filter(({ index }) => reached[index]).length;
  let alternate: PathResult | undefined;
  if (first && Number.isFinite(first.cost) && first.path.length > 1 && profile.minimumRouteCount > 1) {
    const blocked = separatedRouteBlock(
      terrain.width,
      terrain.height,
      first.path,
      profile.routeSeparationVertices,
      objectives,
    );
    alternate = shortestPath(terrain, passable, source, objectives, blocked);
  }
  const firstExists = Boolean(first && Number.isFinite(first.cost));
  const alternateExists = Boolean(alternate && Number.isFinite(alternate.cost));
  return {
    anchor,
    anchorVertex: vertexCoordinates(terrain, source),
    reachableFractionOfTraversable: reachableCount / Math.max(1, traversableVertices),
    objectiveCost: firstExists ? first!.cost : null,
    routeCount: Number(firstExists) + Number(alternateExists),
    alternateObjectiveCost: alternateExists ? alternate!.cost : null,
    reachableHighGroundFraction: reachableHighGround / Math.max(1, highGround.length),
  };
}

export function analyzeBalancedTerrain(
  terrain: TerrainData,
  baseAnchors: [[number, number], [number, number]],
  objectiveAnchors: Array<[number, number]>,
  overrides: Partial<BalancedTraversalProfile> = {},
): BalancedTerrainAnalysis {
  const profile = { ...DEFAULT_BALANCED_TRAVERSAL_PROFILE, ...overrides };
  validateProfile(profile);
  const dimensionsValid = Number.isInteger(terrain.width)
    && Number.isInteger(terrain.height)
    && terrain.width >= 2
    && terrain.height >= 2
    && terrain.width <= MAX_ANALYSIS_DIMENSION
    && terrain.height <= MAX_ANALYSIS_DIMENSION;
  const expectedVertices = dimensionsValid ? terrain.width * terrain.height : 0;
  const shapeValid = dimensionsValid
    && Number.isFinite(terrain.worldWidth)
    && Number.isFinite(terrain.worldHeight)
    && terrain.worldWidth > 0
    && terrain.worldHeight > 0
    && Array.isArray(terrain.heights)
    && Array.isArray(terrain.textureIds)
    && terrain.heights.length === expectedVertices
    && terrain.textureIds.length === expectedVertices;
  const finiteVertices = shapeValid ? terrain.heights.filter(Number.isFinite).length : 0;
  const rotationalMismatches = shapeValid ? rotationalTerrainMismatches(terrain, 1e-9) : Math.max(1, expectedVertices);
  const passable = new Uint8Array(expectedVertices);
  if (shapeValid) {
    const stepX = terrain.worldWidth / (terrain.width - 1);
    const stepY = terrain.worldHeight / (terrain.height - 1);
    for (let y = 0; y < terrain.height; y += 1) {
      for (let x = 0; x < terrain.width; x += 1) {
        const index = y * terrain.width + x;
        if (Number.isFinite(terrain.heights[index])
          && sampleSlopeDegrees(terrain, x * stepX, y * stepY) <= profile.maxSlopeDegrees) passable[index] = 1;
      }
    }
  }
  const traversableVertices = passable.reduce((total, value) => total + value, 0);
  const traversableFraction = traversableVertices / Math.max(1, expectedVertices);
  const clearancePassable = shapeValid
    ? clearancePassableMask(
        passable,
        terrain.width,
        terrain.height,
        profile.minimumRouteClearanceVertices,
      )
    : passable;
  const clearanceTraversableVertices = clearancePassable.reduce((total, value) => total + value, 0);
  const clearanceTraversableFraction = clearanceTraversableVertices / Math.max(1, expectedVertices);
  const highGroundThreshold = shapeValid ? strategicHighGroundThreshold(
    terrain.heights.filter((height, index) => Number.isFinite(height) && clearancePassable[index]),
  ) : null;
  const baseAnchorsValid = shapeValid
    && baseAnchors.length === 2
    && baseAnchors.every((anchor) => validWorldAnchor(terrain, anchor))
    && Math.hypot(
      baseAnchors[1][0] - (terrain.worldWidth - baseAnchors[0][0]),
      baseAnchors[1][1] - (terrain.worldHeight - baseAnchors[0][1]),
    ) <= 1e-6
    && Math.hypot(
      baseAnchors[1][0] - baseAnchors[0][0],
      baseAnchors[1][1] - baseAnchors[0][1],
    ) > 1e-6;
  const objectiveAnchorsValid = shapeValid && rotationalAnchorsClose(terrain, objectiveAnchors);
  const objectives = objectiveAnchorsValid
    ? targetVertices(terrain, clearancePassable, objectiveAnchors, profile.objectiveRadiusVertices)
    : new Set<number>();
  const teams: [TeamTraversalMetrics, TeamTraversalMetrics] = [
    analyzeTeam(
      terrain,
      clearancePassable,
      clearanceTraversableVertices,
      baseAnchors[0],
      objectives,
      highGroundThreshold,
      profile,
    ),
    analyzeTeam(
      terrain,
      clearancePassable,
      clearanceTraversableVertices,
      baseAnchors[1],
      objectives,
      highGroundThreshold,
      profile,
    ),
  ];
  const costs = teams.map((team) => team.objectiveCost);
  const pairedObjectiveCostDelta = costs.every((cost) => cost !== null)
    ? Math.abs(costs[0]! - costs[1]!)
    : null;
  const pairedObjectiveCostDeltaRatio = pairedObjectiveCostDelta === null
    ? null
    : pairedObjectiveCostDelta / Math.max(1, costs[0]!, costs[1]!);
  const gates: BalanceGate[] = [
    {
      code: 'terrain-shape',
      passed: shapeValid && finiteVertices === expectedVertices,
      message: shapeValid && finiteVertices === expectedVertices
        ? `${expectedVertices.toLocaleString('en-US')} finite terrain vertices.`
        : `Expected ${expectedVertices.toLocaleString('en-US')} finite height and texture vertices.`,
    },
    {
      code: 'rotational-symmetry',
      passed: shapeValid && rotationalMismatches === 0,
      message: rotationalMismatches === 0
        ? 'Every terrain height and texture has an exact 180-degree partner.'
        : `${rotationalMismatches.toLocaleString('en-US')} terrain entries break rotational pairing.`,
    },
    {
      code: 'traversable-coverage',
      passed: traversableFraction >= profile.minimumTraversableFraction,
      message: `${(traversableFraction * 100).toFixed(1)}% of vertices meet the ${profile.maxSlopeDegrees}° offline slope proxy; minimum ${(profile.minimumTraversableFraction * 100).toFixed(1)}%.`,
    },
    {
      code: 'base-anchors',
      passed: baseAnchorsValid && teams.every((team) => team.anchorVertex !== null),
      message: baseAnchorsValid && teams.every((team) => team.anchorVertex !== null)
        ? 'Both rotationally paired base anchors resolve within the configured traversable snap radius.'
        : 'Base anchors must be finite, in bounds, rotationally paired, and close to traversable terrain.',
    },
    {
      code: 'objectives',
      passed: objectiveAnchorsValid && objectives.size > 0 && teams.every((team) => team.objectiveCost !== null),
      message: objectiveAnchorsValid && objectives.size > 0 && teams.every((team) => team.objectiveCost !== null)
        ? 'Both teams can reach the rotationally paired objective region.'
        : 'Objective anchors must be finite, in bounds, rotationally paired, and reachable for both teams.',
    },
    {
      code: 'route-count',
      passed: teams.every((team) => team.routeCount >= profile.minimumRouteCount),
      message: `Detected ${teams[0].routeCount}/${teams[1].routeCount} separated team routes after a ${profile.minimumRouteClearanceVertices}-vertex clearance proxy; minimum ${profile.minimumRouteCount} each.`,
    },
    {
      code: 'connected-playable-area',
      passed: teams.every((team) => team.reachableFractionOfTraversable >= profile.minimumReachableFraction),
      message: `Reachable cleared terrain is ${(teams[0].reachableFractionOfTraversable * 100).toFixed(1)}%/${(teams[1].reachableFractionOfTraversable * 100).toFixed(1)}%; minimum ${(profile.minimumReachableFraction * 100).toFixed(1)}% each.`,
    },
    {
      code: 'high-ground-access',
      passed: highGroundThreshold !== null
        && teams.every((team) => (
          team.reachableHighGroundFraction >= profile.minimumReachableHighGroundFraction
        )),
      message: `Reachable cleared high ground is ${(teams[0].reachableHighGroundFraction * 100).toFixed(1)}%/${(teams[1].reachableHighGroundFraction * 100).toFixed(1)}%; minimum ${(profile.minimumReachableHighGroundFraction * 100).toFixed(1)}% each.`,
    },
    {
      code: 'paired-objective-cost',
      passed: pairedObjectiveCostDeltaRatio !== null
        && pairedObjectiveCostDeltaRatio <= profile.pairedCostTolerance,
      message: pairedObjectiveCostDeltaRatio === null
        ? 'Paired objective cost cannot be compared.'
        : `Paired objective-cost delta is ${(pairedObjectiveCostDeltaRatio * 100).toFixed(9)}%.`,
    },
  ];
  return {
    passed: gates.every((gate) => gate.passed),
    profile,
    gates,
    metrics: {
      terrainVertices: expectedVertices,
      finiteVertices,
      rotationalMismatches,
      traversableVertices,
      traversableFraction,
      clearanceTraversableVertices,
      clearanceTraversableFraction,
      highGroundThreshold,
      pairedObjectiveCostDelta,
      pairedObjectiveCostDeltaRatio,
      teams,
    },
  };
}

export function analyzeBalancedProject(
  project: WulframProject,
  baseAnchors: [[number, number], [number, number]],
  objectiveAnchors: Array<[number, number]>,
  overrides: Partial<BalancedTraversalProfile> = {},
): BalancedProjectAnalysis {
  const terrain = analyzeBalancedTerrain(project.terrain, baseAnchors, objectiveAnchors, overrides);
  const entityPairing = analyzeRotationalEntityPairs(project);
  const projectIssues = validateProject(project);
  const projectErrorCount = projectIssues.filter((issue) => issue.severity === 'error').length;
  const projectWarningCount = projectIssues.filter((issue) => issue.severity === 'warning').length;
  return {
    passed: terrain.passed && entityPairing.passed && projectErrorCount === 0,
    terrain,
    entityPairing,
    projectIssues,
    projectErrorCount,
    projectWarningCount,
  };
}
