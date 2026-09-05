'use client';

import { useMemo } from 'react';

import { sampleHeight, type TerrainData } from '@/lib/wulfram';
import type { BalancedProjectResult } from '@/lib/balanced-map-generator';

interface PreviewPoint {
  x: number;
  y: number;
}

interface PreviewCell {
  fill: string;
  points: string;
}

const VIEW_WIDTH = 240;
const VIEW_HEIGHT = 116;
const GRID_SAMPLES = 15;

function terrainRange(terrain: TerrainData): [number, number] {
  let minimum = Number.POSITIVE_INFINITY;
  let maximum = Number.NEGATIVE_INFINITY;
  for (const height of terrain.heights) {
    if (height < minimum) minimum = height;
    if (height > maximum) maximum = height;
  }
  return [minimum, maximum];
}

function terrainPoint(
  terrain: TerrainData,
  vertexX: number,
  vertexY: number,
  minimum: number,
  maximum: number,
): PreviewPoint {
  const x = vertexX / Math.max(1, terrain.width - 1) - 0.5;
  const y = vertexY / Math.max(1, terrain.height - 1) - 0.5;
  const height = terrain.heights[vertexY * terrain.width + vertexX] ?? 0;
  const normalizedHeight = (height - minimum) / Math.max(1, maximum - minimum);
  return {
    x: VIEW_WIDTH / 2 + (x - y) * 102,
    y: 71 + (x + y) * 34 - normalizedHeight * 38,
  };
}

function worldPoint(
  terrain: TerrainData,
  worldX: number,
  worldY: number,
  minimum: number,
  maximum: number,
): PreviewPoint {
  const vertexX = Math.max(0, Math.min(
    terrain.width - 1,
    Math.round(worldX / terrain.worldWidth * (terrain.width - 1)),
  ));
  const vertexY = Math.max(0, Math.min(
    terrain.height - 1,
    Math.round(worldY / terrain.worldHeight * (terrain.height - 1)),
  ));
  const point = terrainPoint(terrain, vertexX, vertexY, minimum, maximum);
  const sampledHeight = sampleHeight(terrain, worldX, worldY);
  const normalizedHeight = (sampledHeight - minimum) / Math.max(1, maximum - minimum);
  return { ...point, y: point.y - normalizedHeight * 2 - 2 };
}

function previewGeometry(result: BalancedProjectResult): {
  bases: PreviewPoint[];
  cells: PreviewCell[];
  objectives: PreviewPoint[];
} {
  const { terrain } = result;
  const [minimum, maximum] = terrainRange(terrain);
  const xs = Array.from({ length: GRID_SAMPLES }, (_, index) => (
    Math.round(index / (GRID_SAMPLES - 1) * (terrain.width - 1))
  ));
  const ys = Array.from({ length: GRID_SAMPLES }, (_, index) => (
    Math.round(index / (GRID_SAMPLES - 1) * (terrain.height - 1))
  ));
  const cells: PreviewCell[] = [];
  for (let diagonal = 0; diagonal < (GRID_SAMPLES - 1) * 2 - 1; diagonal += 1) {
    for (let yIndex = 0; yIndex < GRID_SAMPLES - 1; yIndex += 1) {
      const xIndex = diagonal - yIndex;
      if (xIndex < 0 || xIndex >= GRID_SAMPLES - 1) continue;
      const vertices = [
        [xs[xIndex], ys[yIndex]],
        [xs[xIndex + 1], ys[yIndex]],
        [xs[xIndex + 1], ys[yIndex + 1]],
        [xs[xIndex], ys[yIndex + 1]],
      ] as const;
      const heights = vertices.map(([x, y]) => terrain.heights[y * terrain.width + x] ?? 0);
      const normalized = (heights.reduce((sum, value) => sum + value, 0) / 4 - minimum)
        / Math.max(1, maximum - minimum);
      const eastWest = heights[1] + heights[2] - heights[0] - heights[3];
      const northSouth = heights[2] + heights[3] - heights[0] - heights[1];
      const shade = Math.max(-9, Math.min(9, (eastWest - northSouth) / Math.max(1, maximum - minimum) * 18));
      const lightness = 22 + normalized * 27 + shade;
      cells.push({
        fill: `hsl(${28 + normalized * 7} 48% ${lightness}%)`,
        points: vertices
          .map(([x, y]) => terrainPoint(terrain, x, y, minimum, maximum))
          .map((point) => `${point.x.toFixed(2)},${point.y.toFixed(2)}`)
          .join(' '),
      });
    }
  }
  return {
    cells,
    bases: result.baseAnchors.map(([x, y]) => worldPoint(terrain, x, y, minimum, maximum)),
    objectives: result.objectiveAnchors.map(([x, y]) => worldPoint(terrain, x, y, minimum, maximum)),
  };
}

export function BalancedCandidatePreview({
  label,
  result,
}: {
  label: string;
  result: BalancedProjectResult;
}) {
  const geometry = useMemo(() => previewGeometry(result), [result]);
  return (
    <svg
      aria-label={`${label} three-dimensional terrain relief preview`}
      className="balanced-candidate-preview"
      viewBox={`0 0 ${VIEW_WIDTH} ${VIEW_HEIGHT}`}
    >
      <title>{label} terrain relief</title>
      <desc>Isometric preview with red and blue base anchors and gold objective anchors.</desc>
      <rect fill="#090b0c" height={VIEW_HEIGHT} width={VIEW_WIDTH} />
      <g stroke="#080909" strokeOpacity="0.22" strokeWidth="0.35">
        {geometry.cells.map((cell, index) => (
          <polygon fill={cell.fill} key={index} points={cell.points} />
        ))}
      </g>
      {geometry.objectives.map((point, index) => (
        <g key={`objective-${index}`} transform={`translate(${point.x} ${point.y})`}>
          <circle fill="#f0b34e" r="3.4" stroke="#1a1207" strokeWidth="1.2" />
          <circle fill="#fff2bd" r="1" />
        </g>
      ))}
      {geometry.bases.map((point, index) => (
        <g key={`base-${index}`} transform={`translate(${point.x} ${point.y})`}>
          <path
            d="M 0 -4 L 4 3 L -4 3 Z"
            fill={index === 0 ? '#df625b' : '#5d91dc'}
            stroke="#f5f2e9"
            strokeWidth="0.8"
          />
        </g>
      ))}
    </svg>
  );
}
