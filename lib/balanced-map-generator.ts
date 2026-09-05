import { pinTerrainEdgeHeights } from './terrain-edge.ts';
import {
  DEFAULT_BASE_LAYOUT_ID,
  createBlankProject,
  instantiateBaseTemplate,
  type AssetManifest,
  type BaseTemplate,
  type StateEntity,
  type TerrainData,
  type WulframProject,
} from './wulfram.ts';

export const BALANCED_GENERATOR_VERSION = 'strict-rotational-v1';
export const BALANCED_DEFAULT_SIZE = 129;
export const BALANCED_DEFAULT_WORLD_SIZE = 5600;
export const BALANCED_STANDARD_RELIEF = 524;

export type BalancedMapTopology = 'open-field' | 'three-route' | 'ring-center';

export interface BalancedTerrainOptions {
  seed: string;
  topology: BalancedMapTopology;
  size?: number;
  worldWidth?: number;
  worldHeight?: number;
  relief?: number;
  baseHeight?: number;
  textureName?: string;
}

export interface BalancedGenerationIdentity {
  generatorVersion: typeof BALANCED_GENERATOR_VERSION;
  seed: string;
  topology: BalancedMapTopology;
  size: number;
  worldWidth: number;
  worldHeight: number;
  relief: number;
  baseHeight: number;
  textureName: string;
}

export interface BalancedTerrainResult {
  identity: BalancedGenerationIdentity;
  terrain: TerrainData;
  baseAnchors: [[number, number], [number, number]];
  objectiveAnchors: Array<[number, number]>;
}

export interface BalancedProjectOptions extends BalancedTerrainOptions {
  name?: string;
  updatedAt?: string;
}

export interface BalancedProjectResult extends BalancedTerrainResult {
  project: WulframProject;
}

interface NoiseWave {
  amplitude: number;
  frequencyX: number;
  frequencyY: number;
  phase: number;
}

function finiteOption(value: number | undefined, fallback: number, label: string): number {
  const resolved = value ?? fallback;
  if (!Number.isFinite(resolved)) throw new Error(`${label} must be a finite number.`);
  return resolved;
}

function normalizeSeed(seed: string): string {
  if (typeof seed !== 'string') throw new Error('Seed must be text.');
  const normalized = seed.normalize('NFC').trim();
  if (!normalized) throw new Error('Seed cannot be empty.');
  if (normalized.length > 200) throw new Error('Seed must contain at most 200 characters.');
  return normalized;
}

function normalizeTextureName(textureName: string | undefined): string {
  const normalized = (textureName ?? 'canyon003').trim();
  if (!normalized || normalized.length > 100 || /\s/.test(normalized)) {
    throw new Error('Texture name must be one non-empty archive token with at most 100 characters.');
  }
  return normalized;
}

/** Stable FNV-1a over normalized UTF-8 seed bytes. */
export function balancedSeedHash(seed: string): number {
  let hash = 0x811c9dc5;
  for (const byte of new TextEncoder().encode(normalizeSeed(seed))) {
    hash ^= byte;
    hash = Math.imul(hash, 0x01000193);
  }
  return hash >>> 0;
}

function seededRandom(seed: string): () => number {
  let state = balancedSeedHash(seed);
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let value = state;
    value = Math.imul(value ^ (value >>> 15), value | 1);
    value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
    return ((value ^ (value >>> 14)) >>> 0) / 4294967296;
  };
}

function smoothstep(lower: number, upper: number, value: number): number {
  if (lower === upper) return value < lower ? 0 : 1;
  const normalized = Math.max(0, Math.min(1, (value - lower) / (upper - lower)));
  return normalized * normalized * (3 - 2 * normalized);
}

function gaussian(value: number, center: number, width: number): number {
  const normalized = (value - center) / Math.max(1e-6, width);
  return Math.exp(-0.5 * normalized * normalized);
}

function topologyValue(topology: BalancedMapTopology, x: number, y: number): number {
  const radius = Math.hypot(x, y);
  const crossAxis = (y - x) / Math.SQRT2;
  if (topology === 'open-field') {
    return 0.16 * Math.cos(radius * Math.PI * 2.2)
      - 0.12 * gaussian(crossAxis, 0, 0.2)
      + 0.08 * gaussian(radius, 0.52, 0.14);
  }
  if (topology === 'three-route') {
    const separatingRidges = gaussian(Math.abs(crossAxis), 0.24, 0.055)
      + 0.75 * gaussian(Math.abs(crossAxis), 0.72, 0.07);
    const routes = gaussian(crossAxis, 0, 0.11)
      + 0.75 * gaussian(Math.abs(crossAxis), 0.49, 0.1);
    return 0.35 * separatingRidges - 0.3 * routes;
  }
  const centerPlateau = gaussian(radius, 0, 0.2);
  const ringRidge = gaussian(radius, 0.34, 0.065);
  const ringRoute = gaussian(radius, 0.55, 0.1);
  const diagonalEntrances = gaussian(crossAxis, 0, 0.1);
  return 0.45 * centerPlateau + 0.65 * ringRidge - 0.34 * ringRoute - 0.2 * diagonalEntrances;
}

function waveNoise(waves: NoiseWave[], x: number, y: number): number {
  const raw = (sampleX: number, sampleY: number) => waves.reduce(
    (total, wave) => total + wave.amplitude * Math.sin(
      Math.PI * (sampleX * wave.frequencyX + sampleY * wave.frequencyY) + wave.phase,
    ),
    0,
  );
  // Averaging opposite samples makes the smooth field rotationally symmetric before
  // the final exact-pair repair.
  return (raw(x, y) + raw(-x, -y)) * 0.5;
}

function basePadBlend(x: number, y: number): number {
  const anchors: Array<[number, number]> = [[-0.46, -0.46], [0.46, 0.46]];
  const distance = Math.min(...anchors.map(([anchorX, anchorY]) => Math.hypot(x - anchorX, y - anchorY)));
  return smoothstep(0.09, 0.15, distance);
}

function edgeBlend(x: number, y: number): number {
  const edgeDistance = Math.min(1 - Math.abs(x), 1 - Math.abs(y));
  return smoothstep(0, 0.12, edgeDistance);
}

function routeBlend(topology: BalancedMapTopology, x: number, y: number): number {
  const alongAxis = (x + y) / Math.SQRT2;
  const crossAxis = (y - x) / Math.SQRT2;
  const baseAxis = 0.46 * Math.SQRT2;
  if (Math.abs(alongAxis) > baseAxis + 0.12) return 1;
  const phase = Math.min(1, Math.abs(alongAxis) / baseAxis);
  const flankAmplitude = topology === 'three-route' ? 0.49 : 0.38;
  const flankCenter = flankAmplitude * Math.sin(Math.PI * phase);
  const distance = Math.min(Math.abs(crossAxis), Math.abs(Math.abs(crossAxis) - flankCenter));
  return smoothstep(0.055, topology === 'three-route' ? 0.4 : 0.29, distance);
}

function smoothGrid(source: number[], size: number): number[] {
  const output = Array.from({ length: source.length }, () => 0);
  const weights = [1, 2, 1];
  for (let y = 0; y < size; y += 1) {
    for (let x = 0; x < size; x += 1) {
      let total = 0;
      for (let offsetY = -1; offsetY <= 1; offsetY += 1) {
        const sampleY = Math.max(0, Math.min(size - 1, y + offsetY));
        for (let offsetX = -1; offsetX <= 1; offsetX += 1) {
          const sampleX = Math.max(0, Math.min(size - 1, x + offsetX));
          total += source[sampleY * size + sampleX] * weights[offsetX + 1] * weights[offsetY + 1];
        }
      }
      output[y * size + x] = total / 16;
    }
  }
  return output;
}

function numericRange(values: number[]): [number, number] {
  let minimum = Number.POSITIVE_INFINITY;
  let maximum = Number.NEGATIVE_INFINITY;
  for (const value of values) {
    minimum = Math.min(minimum, value);
    maximum = Math.max(maximum, value);
  }
  return [minimum, maximum];
}

function assertTopology(value: string): asserts value is BalancedMapTopology {
  if (value !== 'open-field' && value !== 'three-route' && value !== 'ring-center') {
    throw new Error(`Unknown balanced-map topology: ${value}`);
  }
}

export function generateBalancedTerrain(options: BalancedTerrainOptions): BalancedTerrainResult {
  const seed = normalizeSeed(options.seed);
  assertTopology(options.topology);
  const size = finiteOption(options.size, BALANCED_DEFAULT_SIZE, 'Terrain size');
  if (!Number.isInteger(size) || size < 17 || size > 513 || size % 2 === 0) {
    throw new Error('Strict rotational terrain size must be an odd integer from 17 through 513.');
  }
  const worldWidth = finiteOption(options.worldWidth, BALANCED_DEFAULT_WORLD_SIZE, 'World width');
  const worldHeight = finiteOption(options.worldHeight, BALANCED_DEFAULT_WORLD_SIZE, 'World height');
  if (worldWidth <= 0 || worldHeight <= 0) throw new Error('World dimensions must be positive.');
  const relief = finiteOption(options.relief, BALANCED_STANDARD_RELIEF, 'Relief');
  if (relief <= 0 || relief > 5000) throw new Error('Relief must be greater than zero and at most 5000.');
  const baseHeight = finiteOption(options.baseHeight, 0, 'Base height');
  const textureName = normalizeTextureName(options.textureName);

  const random = seededRandom(`${BALANCED_GENERATOR_VERSION}\0${seed}\0${options.topology}`);
  const waves: NoiseWave[] = Array.from({ length: 7 }, (_, index) => ({
    amplitude: 0.15 / (1 + index * 0.45),
    frequencyX: 1 + Math.floor(random() * 5),
    frequencyY: 1 + Math.floor(random() * 5),
    phase: random() * Math.PI * 2,
  }));
  const rawHeights = Array.from({ length: size * size }, () => 0);
  let rawMinimum = Number.POSITIVE_INFINITY;
  let rawMaximum = Number.NEGATIVE_INFINITY;
  for (let y = 0; y < size; y += 1) {
    const normalizedY = y / (size - 1) * 2 - 1;
    for (let x = 0; x < size; x += 1) {
      const normalizedX = x / (size - 1) * 2 - 1;
      const value = topologyValue(options.topology, normalizedX, normalizedY)
        + waveNoise(waves, normalizedX, normalizedY);
      rawHeights[y * size + x] = value;
      rawMinimum = Math.min(rawMinimum, value);
      rawMaximum = Math.max(rawMaximum, value);
    }
  }

  const rawRange = Math.max(1e-9, rawMaximum - rawMinimum);
  let shapedHeights = rawHeights.map((raw) => {
    const centered = (raw - rawMinimum) / rawRange - 0.5;
    return baseHeight + centered * relief;
  });
  for (let pass = 0; pass < 5; pass += 1) shapedHeights = smoothGrid(shapedHeights, size);
  const [smoothedMinimum, smoothedMaximum] = numericRange(shapedHeights);
  const smoothedRange = Math.max(1e-9, smoothedMaximum - smoothedMinimum);
  shapedHeights = shapedHeights.map((height) => (
    baseHeight + ((height - smoothedMinimum) / smoothedRange - 0.5) * relief
  ));
  const heights = shapedHeights.map((terrainHeight, index) => {
    const x = index % size;
    const y = Math.floor(index / size);
    const normalizedX = x / (size - 1) * 2 - 1;
    const normalizedY = y / (size - 1) * 2 - 1;
    const routed = baseHeight + (terrainHeight - baseHeight) * routeBlend(
      options.topology,
      normalizedX,
      normalizedY,
    );
    const flattened = baseHeight + (routed - baseHeight) * basePadBlend(normalizedX, normalizedY);
    const objectiveBlend = smoothstep(0.055, 0.105, Math.hypot(normalizedX, normalizedY));
    const objectiveFlattened = baseHeight + (flattened - baseHeight) * objectiveBlend;
    return objectiveFlattened * edgeBlend(normalizedX, normalizedY);
  });
  pinTerrainEdgeHeights(heights, size, size);

  // Repair each pair from one averaged value after every height-changing operation.
  // Rounding here makes source serialization stable and gives exact equality in memory.
  for (let index = 0; index < heights.length; index += 1) {
    const pair = heights.length - 1 - index;
    if (index > pair) break;
    const pairedHeight = Number(((heights[index] + heights[pair]) * 0.5).toFixed(6));
    heights[index] = pairedHeight;
    heights[pair] = pairedHeight;
  }

  const terrain: TerrainData = {
    width: size,
    height: size,
    worldWidth,
    worldHeight,
    textureIds: Array.from({ length: size * size }, () => 0),
    heights,
    tagmap: [`0:${textureName}`],
    tagmap2: [textureName],
  };
  return {
    identity: {
      generatorVersion: BALANCED_GENERATOR_VERSION,
      seed,
      topology: options.topology,
      size,
      worldWidth,
      worldHeight,
      relief,
      baseHeight,
      textureName,
    },
    terrain,
    baseAnchors: [
      [worldWidth * 0.27, worldHeight * 0.27],
      [worldWidth * 0.73, worldHeight * 0.73],
    ],
    objectiveAnchors: [[worldWidth * 0.5, worldHeight * 0.5]],
  };
}

export function rotationalTerrainMismatches(terrain: TerrainData, tolerance = 0): number {
  const expected = terrain.width * terrain.height;
  if (terrain.heights.length !== expected || terrain.textureIds.length !== expected) return expected;
  let mismatches = 0;
  for (let index = 0; index < expected; index += 1) {
    const pair = expected - 1 - index;
    if (Math.abs(terrain.heights[index] - terrain.heights[pair]) > tolerance
      || terrain.textureIds[index] !== terrain.textureIds[pair]) mismatches += 1;
  }
  return mismatches;
}

function clonedEntities(entities: StateEntity[]): StateEntity[] {
  return entities.map((entity) => ({
    ...entity,
    position: [...entity.position],
    rotation: [...entity.rotation],
  }));
}

function deterministicIdFactory(seed: string, team: number): (prefix: string) => string {
  const hash = balancedSeedHash(`${BALANCED_GENERATOR_VERSION}\0${seed}`).toString(16).padStart(8, '0');
  let sequence = 0;
  return () => `generated-${hash}-team-${team}-${++sequence}`;
}

export function generateBalancedProject(
  options: BalancedProjectOptions,
  template: BaseTemplate,
  manifest?: AssetManifest,
): BalancedProjectResult {
  const generated = generateBalancedTerrain(options);
  if (manifest && !manifest.terrainTextures[generated.identity.textureName]) {
    throw new Error(`Terrain texture “${generated.identity.textureName}” is unavailable in the asset manifest.`);
  }
  const project = createBlankProject(options.name?.trim() || 'Generated balanced map', generated.identity.size);
  project.terrain = generated.terrain;
  const team1Ids = deterministicIdFactory(generated.identity.seed, 1);
  const team2Ids = deterministicIdFactory(generated.identity.seed, 2);
  const team1 = instantiateBaseTemplate(
    template,
    project.terrain,
    generated.baseAnchors[0],
    1,
    1,
    0,
    manifest,
    undefined,
    team1Ids,
  );
  const team2 = instantiateBaseTemplate(
    template,
    project.terrain,
    generated.baseAnchors[1],
    2,
    1,
    Math.PI,
    manifest,
    undefined,
    team2Ids,
  );
  if (team1.entities.length !== team2.entities.length || team1.entities.length === 0) {
    throw new Error('The selected base template does not produce a complete paired layout.');
  }
  const supplementedUplink = !template.units.some((unit) => unit.token === 'u');
  if (supplementedUplink) {
    const uplinkTemplate: BaseTemplate = {
      id: 'balanced-required-uplink',
      name: 'Required uplink',
      sourceMap: 'balanced-generator',
      sourceState: 'generated',
      sourceTeam: 1,
      sourceWorldSize: [generated.identity.worldWidth, generated.identity.worldHeight],
      sourceAnchor: [0, 0],
      unitCount: 1,
      footprint: { width: 10, height: 10 },
      units: [{ token: 'u', offset: [0, 0], groundOffset: 3, rotation: [0, 0, 0], active: 1 }],
    };
    const distance = Math.min(500, Math.max(template.footprint.width, template.footprint.height) * 0.5 + 60);
    const offset = distance / Math.SQRT2;
    const firstAnchor: [number, number] = [
      generated.baseAnchors[0][0] + offset,
      generated.baseAnchors[0][1] - offset,
    ];
    const secondAnchor: [number, number] = [
      generated.identity.worldWidth - firstAnchor[0],
      generated.identity.worldHeight - firstAnchor[1],
    ];
    const firstUplink = instantiateBaseTemplate(
      uplinkTemplate,
      project.terrain,
      firstAnchor,
      1,
      1,
      0,
      manifest,
      undefined,
      team1Ids,
    );
    const secondUplink = instantiateBaseTemplate(
      uplinkTemplate,
      project.terrain,
      secondAnchor,
      2,
      1,
      Math.PI,
      manifest,
      undefined,
      team2Ids,
    );
    if (firstUplink.entities.length !== 1 || secondUplink.entities.length !== 1) {
      throw new Error('The required paired uplinks are unavailable in the asset manifest.');
    }
    team1.entities.push(...firstUplink.entities);
    team2.entities.push(...secondUplink.entities);
  }
  const updatedAt = options.updatedAt ?? new Date().toISOString();
  if (Number.isNaN(Date.parse(updatedAt))) throw new Error('updatedAt must be an ISO-compatible date string.');
  project.updatedAt = updatedAt;
  project.entities = [...team1.entities, ...team2.entities];
  project.activeBaseLayoutId = DEFAULT_BASE_LAYOUT_ID;
  const generatorMetadata = {
    'generator.version': generated.identity.generatorVersion,
    'generator.profile': BALANCED_GENERATOR_VERSION,
    'generator.seed': generated.identity.seed,
    'generator.topology': generated.identity.topology,
    'generator.parameters': JSON.stringify({
      size: generated.identity.size,
      worldWidth: generated.identity.worldWidth,
      worldHeight: generated.identity.worldHeight,
      relief: generated.identity.relief,
      baseHeight: generated.identity.baseHeight,
      textureName: generated.identity.textureName,
      baseTemplate: template.id,
      supplementedUplink,
    }),
  };
  project.metadata = { ...generatorMetadata };
  project.baseLayouts = [{
    id: DEFAULT_BASE_LAYOUT_ID,
    name: 'Generated balanced layout',
    metadata: { ...generatorMetadata },
    entities: clonedEntities(project.entities),
    validation: { ...project.validation },
    updatedAt,
  }];
  return { ...generated, project };
}
