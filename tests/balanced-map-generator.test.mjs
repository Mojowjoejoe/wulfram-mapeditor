import assert from 'node:assert/strict';
import test from 'node:test';

import {
  BALANCED_DEFAULT_SIZE,
  BALANCED_DEFAULT_WORLD_SIZE,
  BALANCED_GENERATOR_VERSION,
  BALANCED_STANDARD_RELIEF,
  balancedSeedHash,
  generateBalancedProject,
  generateBalancedTerrain,
  rotationalTerrainMismatches,
} from '../lib/balanced-map-generator.ts';
import {
  analyzeBalancedProject,
  analyzeBalancedTerrain,
} from '../lib/balanced-map-analysis.ts';
import { createMapSourceFiles, parseMapSourceFiles } from '../lib/map-source.ts';
import { createBlankProject, validateProject } from '../lib/wulfram.ts';

const TEST_BASE_TEMPLATE = {
  id: 'balanced-test-base',
  name: 'Balanced test base',
  sourceMap: 'test',
  sourceState: 'state',
  sourceTeam: 1,
  sourceWorldSize: [5600, 5600],
  sourceAnchor: [0, 0],
  unitCount: 4,
  footprint: { width: 200, height: 200 },
  units: [
    { token: 'e', offset: [0, 0], groundOffset: 3, rotation: [0, 0, 0], active: 1 },
    { token: 'r', offset: [100, 0], groundOffset: 4, rotation: [0, 0, 0], active: 1 },
    { token: 'u', offset: [0, 100], groundOffset: 3, rotation: [0, 0, 0], active: 1 },
    { token: 'g', offset: [-100, 0], groundOffset: 16, rotation: [0, 0, 0], active: 1 },
  ],
};

void test('seed hashing is normalized, UTF-8 stable, and sensitive to content', () => {
  assert.equal(balancedSeedHash(' Canyon '), balancedSeedHash('Canyon'));
  assert.equal(balancedSeedHash('Cafe\u0301'), balancedSeedHash('Café'));
  assert.notEqual(balancedSeedHash('Canyon A'), balancedSeedHash('Canyon B'));
});

void test('default generation uses the calibrated canonical dimensions and relief', () => {
  const result = generateBalancedTerrain({ seed: 'defaults', topology: 'open-field' });
  assert.equal(result.identity.generatorVersion, BALANCED_GENERATOR_VERSION);
  assert.equal(result.terrain.width, BALANCED_DEFAULT_SIZE);
  assert.equal(result.terrain.height, BALANCED_DEFAULT_SIZE);
  assert.equal(result.terrain.worldWidth, BALANCED_DEFAULT_WORLD_SIZE);
  assert.equal(result.terrain.worldHeight, BALANCED_DEFAULT_WORLD_SIZE);
  assert.equal(result.identity.relief, BALANCED_STANDARD_RELIEF);
  assert.equal(result.identity.textureName, 'canyon003');
  assert.deepEqual(result.terrain.tagmap, ['0:canyon003']);
  assert.deepEqual(result.terrain.tagmap2, ['canyon003']);
  assert.deepEqual(result.baseAnchors, [[1512, 1512], [4088, 4088]]);
  assert.deepEqual(result.objectiveAnchors, [[2800, 2800]]);
});

void test('strict terrain is exactly rotationally paired with a zero-height edge', () => {
  for (const topology of ['open-field', 'three-route', 'ring-center']) {
    const { terrain } = generateBalancedTerrain({ seed: `symmetry-${topology}`, topology, size: 33 });
    assert.equal(rotationalTerrainMismatches(terrain), 0);
    for (let index = 0; index < terrain.width; index += 1) {
      assert.equal(terrain.heights[index], 0);
      assert.equal(terrain.heights[(terrain.height - 1) * terrain.width + index], 0);
    }
    for (let y = 0; y < terrain.height; y += 1) {
      assert.equal(terrain.heights[y * terrain.width], 0);
      assert.equal(terrain.heights[y * terrain.width + terrain.width - 1], 0);
    }
  }
});

void test('same complete identity is deterministic while seeds and topologies differ', () => {
  const options = { seed: 'repeatable', topology: 'three-route', size: 33, relief: 400 };
  const first = generateBalancedTerrain(options);
  const second = generateBalancedTerrain(options);
  assert.deepEqual(first, second);
  assert.notDeepEqual(
    first.terrain.heights,
    generateBalancedTerrain({ ...options, seed: 'different' }).terrain.heights,
  );
  assert.notDeepEqual(
    first.terrain.heights,
    generateBalancedTerrain({ ...options, topology: 'ring-center' }).terrain.heights,
  );
  assert.notDeepEqual(
    first.terrain.tagmap2,
    generateBalancedTerrain({ ...options, textureName: '1snow001' }).terrain.tagmap2,
  );
});

void test('reserved base cores are flat and rotationally paired', () => {
  const result = generateBalancedTerrain({
    seed: 'flat-bases',
    topology: 'ring-center',
    size: 129,
    baseHeight: 37,
  });
  const { terrain } = result;
  const stepX = terrain.worldWidth / (terrain.width - 1);
  const stepY = terrain.worldHeight / (terrain.height - 1);
  for (const [anchorX, anchorY] of result.baseAnchors) {
    const gridX = Math.round(anchorX / stepX);
    const gridY = Math.round(anchorY / stepY);
    const values = [];
    for (let y = gridY - 2; y <= gridY + 2; y += 1) {
      for (let x = gridX - 2; x <= gridX + 2; x += 1) values.push(terrain.heights[y * terrain.width + x]);
    }
    assert.ok(values.every((height) => height === 37));
  }
});

void test('generated terrain round-trips through canonical source without change', () => {
  const generated = generateBalancedTerrain({ seed: 'source-roundtrip', topology: 'open-field', size: 33 });
  const project = createBlankProject('Balanced fixture', 33);
  project.terrain = generated.terrain;
  const reopened = parseMapSourceFiles(createMapSourceFiles(project));
  assert.deepEqual(reopened.terrain, project.terrain);
  assert.equal(rotationalTerrainMismatches(reopened.terrain), 0);
});

void test('invalid generation inputs fail closed', () => {
  assert.throws(
    () => generateBalancedTerrain({ seed: ' ', topology: 'open-field' }),
    /Seed cannot be empty/,
  );
  assert.throws(
    () => generateBalancedTerrain({ seed: 'even', topology: 'open-field', size: 32 }),
    /odd integer/,
  );
  assert.throws(
    () => generateBalancedTerrain({ seed: 'bad-world', topology: 'open-field', worldWidth: 0 }),
    /World dimensions must be positive/,
  );
  assert.throws(
    () => generateBalancedTerrain({ seed: 'bad-relief', topology: 'open-field', relief: Number.NaN }),
    /Relief must be a finite number/,
  );
  assert.throws(
    () => generateBalancedTerrain({ seed: 'bad-topology', topology: 'maze' }),
    /Unknown balanced-map topology/,
  );
  assert.throws(
    () => generateBalancedTerrain({ seed: 'bad-texture', topology: 'open-field', textureName: 'bad texture' }),
    /Texture name must be one non-empty archive token/,
  );
});

void test('generated topology presets pass the first-release terrain balance gates', () => {
  for (const topology of ['open-field', 'three-route', 'ring-center']) {
    const generated = generateBalancedTerrain({ seed: `analyze-${topology}`, topology });
    const report = analyzeBalancedTerrain(
      generated.terrain,
      generated.baseAnchors,
      generated.objectiveAnchors,
    );
    assert.equal(
      report.passed,
      true,
      `${topology}: ${report.gates.filter((gate) => !gate.passed).map((gate) => gate.message).join(' | ')}`,
    );
    assert.equal(report.metrics.rotationalMismatches, 0);
    assert.ok(report.metrics.traversableFraction >= 0.58);
    assert.ok(report.metrics.pairedObjectiveCostDeltaRatio <= 1e-9);
    assert.ok(report.metrics.teams.every((team) => team.routeCount >= 2));
    assert.ok(
      Math.abs(
        report.metrics.teams[0].reachableFractionOfTraversable
        - report.metrics.teams[1].reachableFractionOfTraversable,
      ) <= 1e-12,
    );
    assert.ok(
      Math.abs(
        report.metrics.teams[0].reachableHighGroundFraction
        - report.metrics.teams[1].reachableHighGroundFraction,
      ) <= 1e-12,
    );
  }
});

void test('calibrated presets pass a deterministic seed sweep', () => {
  for (const topology of ['open-field', 'three-route', 'ring-center']) {
    for (let index = 0; index < 16; index += 1) {
      const generated = generateBalancedTerrain({ seed: `sweep-${index}`, topology });
      const report = analyzeBalancedTerrain(
        generated.terrain,
        generated.baseAnchors,
        generated.objectiveAnchors,
      );
      assert.equal(
        report.passed,
        true,
        `${topology}/sweep-${index}: ${report.gates.filter((gate) => !gate.passed).map((gate) => gate.message).join(' | ')}`,
      );
    }
  }
});

void test('analysis rejects a symmetric but disconnected objective', () => {
  const generated = generateBalancedTerrain({ seed: 'blocked-center', topology: 'open-field', size: 33 });
  const terrain = structuredClone(generated.terrain);
  const center = Math.floor(terrain.width / 2);
  for (let y = center - 1; y <= center + 1; y += 1) {
    for (let x = 0; x < terrain.width; x += 1) {
      terrain.heights[y * terrain.width + x] = 2000;
    }
  }
  const report = analyzeBalancedTerrain(terrain, generated.baseAnchors, generated.objectiveAnchors);
  assert.equal(report.passed, false);
  assert.equal(report.gates.find((gate) => gate.code === 'objectives')?.passed, false);
});

void test('analysis rejects one changed rotational terrain vertex', () => {
  const generated = generateBalancedTerrain({ seed: 'broken-pair', topology: 'open-field', size: 33 });
  const terrain = structuredClone(generated.terrain);
  terrain.heights[100] += 1;
  const report = analyzeBalancedTerrain(terrain, generated.baseAnchors, generated.objectiveAnchors);
  assert.equal(report.passed, false);
  assert.equal(report.gates.find((gate) => gate.code === 'rotational-symmetry')?.passed, false);
});

void test('analysis is read-only and rejects invalid profiles', () => {
  const generated = generateBalancedTerrain({ seed: 'read-only', topology: 'open-field', size: 33 });
  const before = structuredClone(generated.terrain);
  analyzeBalancedTerrain(generated.terrain, generated.baseAnchors, generated.objectiveAnchors);
  assert.deepEqual(generated.terrain, before);
  assert.throws(
    () => analyzeBalancedTerrain(
      generated.terrain,
      generated.baseAnchors,
      generated.objectiveAnchors,
      { minimumTraversableFraction: 0.8, targetTraversableFraction: 0.7 },
    ),
    /Target traversable fraction cannot be lower/,
  );
});

void test('complete project generation places a deterministic valid paired base', () => {
  const options = {
    seed: 'paired-project',
    topology: 'open-field',
    name: 'Paired Project',
    updatedAt: '2000-01-01T00:00:00.000Z',
  };
  const first = generateBalancedProject(options, TEST_BASE_TEMPLATE);
  const second = generateBalancedProject(options, TEST_BASE_TEMPLATE);
  assert.deepEqual(createMapSourceFiles(first.project), createMapSourceFiles(second.project));
  assert.deepEqual(validateProject(first.project), []);
  assert.equal(
    analyzeBalancedProject(first.project, first.baseAnchors, first.objectiveAnchors).passed,
    true,
  );
  assert.equal(first.project.entities.length, 8);
  for (let index = 0; index < 4; index += 1) {
    const team1 = first.project.entities[index];
    const team2 = first.project.entities[index + 4];
    assert.equal(team1.token, team2.token);
    assert.equal(team1.subtype, team2.subtype);
    assert.equal(team1.team, 1);
    assert.equal(team2.team, 2);
    assert.ok(Math.abs(team2.position[0] - (first.terrain.worldWidth - team1.position[0])) <= 1e-9);
    assert.ok(Math.abs(team2.position[1] - (first.terrain.worldHeight - team1.position[1])) <= 1e-9);
  }
  const metadata = first.project.baseLayouts[0].metadata;
  assert.equal(metadata['generator.version'], BALANCED_GENERATOR_VERSION);
  assert.equal(metadata['generator.seed'], options.seed);
  assert.equal(metadata['generator.topology'], options.topology);
});

void test('project generation supplements a missing uplink as an exact pair', () => {
  const withoutUplink = {
    ...TEST_BASE_TEMPLATE,
    id: 'balanced-test-base-without-uplink',
    unitCount: 3,
    units: TEST_BASE_TEMPLATE.units.filter((unit) => unit.token !== 'u'),
  };
  const generated = generateBalancedProject({
    seed: 'supplement-uplink',
    topology: 'open-field',
    updatedAt: '2000-01-01T00:00:00.000Z',
  }, withoutUplink);
  const uplinks = generated.project.entities.filter((entity) => entity.token === 'u');
  assert.equal(uplinks.length, 2);
  assert.equal(uplinks[0].team, 1);
  assert.equal(uplinks[1].team, 2);
  assert.equal(uplinks[1].position[0], generated.terrain.worldWidth - uplinks[0].position[0]);
  assert.equal(uplinks[1].position[1], generated.terrain.worldHeight - uplinks[0].position[1]);
  assert.deepEqual(validateProject(generated.project), []);
  const parameters = JSON.parse(generated.project.baseLayouts[0].metadata['generator.parameters']);
  assert.equal(parameters.supplementedUplink, true);
});

void test('complete-project analysis rejects a broken team entity pair', () => {
  const generated = generateBalancedProject({
    seed: 'broken-entity-pair',
    topology: 'open-field',
    updatedAt: '2000-01-01T00:00:00.000Z',
  }, TEST_BASE_TEMPLATE);
  generated.project.entities.find((entity) => entity.team === 2).position[0] += 4;
  const report = analyzeBalancedProject(
    generated.project,
    generated.baseAnchors,
    generated.objectiveAnchors,
  );
  assert.equal(report.passed, false);
  assert.equal(report.entityPairing.passed, false);
  assert.equal(report.entityPairing.mismatchCount, 1);
});
