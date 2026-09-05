import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  MAP_REQUIRED_SOURCE_FILES,
  parseMapSourceFiles,
} from '../lib/map-source.ts';
import { sampleSlopeDegrees } from '../lib/wulfram.ts';

const TOOL_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const repository = path.resolve(process.argv[2] || path.join(TOOL_ROOT, '..', 'wulfram-maps'));
const mapsRoot = path.join(repository, 'maps');

if (!fs.existsSync(mapsRoot)) {
  throw new Error(`No canonical maps directory was found at ${mapsRoot}.`);
}

function quantile(values, probability) {
  if (!values.length) return Number.NaN;
  const sorted = [...values].sort((left, right) => left - right);
  const position = (sorted.length - 1) * probability;
  const lower = Math.floor(position);
  const upper = Math.ceil(position);
  if (lower === upper) return sorted[lower];
  return sorted[lower] + (sorted[upper] - sorted[lower]) * (position - lower);
}

function summary(values, digits = 3) {
  const finite = values.filter(Number.isFinite);
  const fixed = (value) => Number(value.toFixed(digits));
  return {
    minimum: fixed(Math.min(...finite)),
    p10: fixed(quantile(finite, 0.1)),
    p25: fixed(quantile(finite, 0.25)),
    median: fixed(quantile(finite, 0.5)),
    p75: fixed(quantile(finite, 0.75)),
    p90: fixed(quantile(finite, 0.9)),
    maximum: fixed(Math.max(...finite)),
  };
}

function standardDeviation(values, mean) {
  if (!values.length) return 0;
  const variance = values.reduce((total, value) => total + (value - mean) ** 2, 0) / values.length;
  return Math.sqrt(variance);
}

function readProject(directory) {
  const files = Object.fromEntries(MAP_REQUIRED_SOURCE_FILES.map((fileName) => [
    fileName,
    fs.readFileSync(path.join(directory, fileName), 'utf8'),
  ]));
  const layouts = path.join(directory, 'base-layouts.json');
  if (fs.existsSync(layouts)) files['base-layouts.json'] = fs.readFileSync(layouts, 'utf8');
  return parseMapSourceFiles(files);
}

function terrainMetrics(terrain) {
  const heights = terrain.heights;
  const meanHeight = heights.reduce((total, value) => total + value, 0) / heights.length;
  const slopes = [];
  const adjacentSteps = [];
  const stepX = terrain.worldWidth / Math.max(1, terrain.width - 1);
  const stepY = terrain.worldHeight / Math.max(1, terrain.height - 1);
  for (let y = 0; y < terrain.height; y += 1) {
    for (let x = 0; x < terrain.width; x += 1) {
      const index = y * terrain.width + x;
      if (x + 1 < terrain.width) adjacentSteps.push(Math.abs(heights[index + 1] - heights[index]));
      if (y + 1 < terrain.height) adjacentSteps.push(Math.abs(heights[index + terrain.width] - heights[index]));
      if (x > 0 && x + 1 < terrain.width && y > 0 && y + 1 < terrain.height) {
        slopes.push(sampleSlopeDegrees(terrain, x * stepX, y * stepY));
      }
    }
  }
  const maximumSlope = Math.max(...slopes);
  const passableAtConfiguredSlope = slopes.filter((slope) => slope <= 22).length / Math.max(1, slopes.length);
  return {
    minimumHeight: Math.min(...heights),
    maximumHeight: Math.max(...heights),
    elevationRange: Math.max(...heights) - Math.min(...heights),
    meanHeight,
    heightDeviation: standardDeviation(heights, meanHeight),
    medianAdjacentStep: quantile(adjacentSteps, 0.5),
    p90AdjacentStep: quantile(adjacentSteps, 0.9),
    medianSlope: quantile(slopes, 0.5),
    p90Slope: quantile(slopes, 0.9),
    maximumSlope,
    passableAtConfiguredSlope,
  };
}

function layoutMetrics(layout, worldWidth, worldHeight) {
  const editable = layout.entities.filter((entity) => entity.token !== '*');
  const team1 = editable.filter((entity) => entity.team === 1);
  const team2 = editable.filter((entity) => entity.team === 2);
  const centroid = (entities) => entities.length
    ? [
        entities.reduce((total, entity) => total + entity.position[0], 0) / entities.length,
        entities.reduce((total, entity) => total + entity.position[1], 0) / entities.length,
      ]
    : undefined;
  const team1Centroid = centroid(team1);
  const team2Centroid = centroid(team2);
  const centroidDistance = team1Centroid && team2Centroid
    ? Math.hypot(team1Centroid[0] - team2Centroid[0], team1Centroid[1] - team2Centroid[1])
    : undefined;
  return {
    entityCount: editable.length,
    team1Count: team1.length,
    team2Count: team2.length,
    teamCountDelta: Math.abs(team1.length - team2.length),
    centroidDistance,
    normalizedCentroidDistance: centroidDistance === undefined
      ? undefined
      : centroidDistance / Math.hypot(worldWidth, worldHeight),
  };
}

const directories = fs.readdirSync(mapsRoot, { withFileTypes: true })
  .filter((entry) => entry.isDirectory())
  .map((entry) => path.join(mapsRoot, entry.name))
  .sort((left, right) => left.localeCompare(right));

const maps = directories.map((directory) => {
  const project = readProject(directory);
  const terrain = terrainMetrics(project.terrain);
  const layouts = project.baseLayouts.map((layout) => layoutMetrics(
    layout,
    project.terrain.worldWidth,
    project.terrain.worldHeight,
  ));
  return {
    slug: path.basename(directory),
    vertices: project.terrain.width * project.terrain.height,
    width: project.terrain.width,
    height: project.terrain.height,
    worldWidth: project.terrain.worldWidth,
    worldHeight: project.terrain.worldHeight,
    layoutCount: project.baseLayouts.length,
    ...terrain,
    layouts,
  };
});

const layouts = maps.flatMap((map) => map.layouts);
const layoutNumbers = (key) => layouts.map((layout) => layout[key]).filter(Number.isFinite);
const mapNumbers = (key) => maps.map((map) => map[key]).filter(Number.isFinite);
const report = {
  generatedAt: new Date().toISOString(),
  repository,
  mapCount: maps.length,
  layoutCount: layouts.length,
  totalVertices: maps.reduce((total, map) => total + map.vertices, 0),
  terrain: {
    width: summary(mapNumbers('width'), 0),
    height: summary(mapNumbers('height'), 0),
    worldWidth: summary(mapNumbers('worldWidth'), 3),
    worldHeight: summary(mapNumbers('worldHeight'), 3),
    elevationRange: summary(mapNumbers('elevationRange'), 3),
    heightDeviation: summary(mapNumbers('heightDeviation'), 3),
    medianAdjacentStep: summary(mapNumbers('medianAdjacentStep'), 3),
    p90AdjacentStep: summary(mapNumbers('p90AdjacentStep'), 3),
    medianSlopeDegrees: summary(mapNumbers('medianSlope'), 3),
    p90SlopeDegrees: summary(mapNumbers('p90Slope'), 3),
    maximumSlopeDegrees: summary(mapNumbers('maximumSlope'), 3),
    passableAt22Degrees: summary(mapNumbers('passableAtConfiguredSlope'), 5),
  },
  layouts: {
    perMap: summary(mapNumbers('layoutCount'), 0),
    entityCount: summary(layoutNumbers('entityCount'), 0),
    team1Count: summary(layoutNumbers('team1Count'), 0),
    team2Count: summary(layoutNumbers('team2Count'), 0),
    teamCountDelta: summary(layoutNumbers('teamCountDelta'), 0),
    teamCentroidDistance: summary(layoutNumbers('centroidDistance'), 3),
    normalizedTeamCentroidDistance: summary(layoutNumbers('normalizedCentroidDistance'), 5),
  },
  maps,
};

if (process.argv.includes('--json')) {
  console.log(JSON.stringify(report, null, 2));
} else {
  const rows = [
    '# Wulfram canonical map corpus analysis',
    '',
    `Generated: ${report.generatedAt}`,
    `Repository: ${report.repository}`,
    '',
    `Maps: ${report.mapCount}`,
    `Base layouts: ${report.layoutCount}`,
    `Terrain vertices: ${report.totalVertices.toLocaleString('en-US')}`,
    '',
    '```json',
    JSON.stringify({ terrain: report.terrain, layouts: report.layouts }, null, 2),
    '```',
  ];
  console.log(rows.join('\n'));
}
