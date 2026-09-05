import { generateBalancedProject } from '../lib/balanced-map-generator.ts';
import { createMapSourceFiles } from '../lib/map-source.ts';

const template = {
  id: 'critic-base', name: 'Critic base', sourceMap: 'test', sourceState: 'state',
  sourceTeam: 1, sourceWorldSize: [5600, 5600], sourceAnchor: [0, 0],
  unitCount: 4, footprint: { width: 200, height: 200 },
  units: [
    { token: 'e', offset: [0, 0], groundOffset: 3, rotation: [0, 0, 0], active: 1 },
    { token: 'r', offset: [100, 0], groundOffset: 4, rotation: [0, 0, 0], active: 1 },
    { token: 'u', offset: [0, 100], groundOffset: 3, rotation: [0, 0, 0], active: 1 },
    { token: 'g', offset: [-100, 0], groundOffset: 16, rotation: [0, 0, 0], active: 1 },
  ],
};
const options = { seed: 'critic-default-time', topology: 'open-field' };
const first = generateBalancedProject(options, template);
const second = generateBalancedProject(options, template);
const a = createMapSourceFiles(first.project);
const b = createMapSourceFiles(second.project);
console.log(JSON.stringify({
  sameIdentity: JSON.stringify(first.identity) === JSON.stringify(second.identity),
  firstUpdatedAt: first.project.updatedAt,
  secondUpdatedAt: second.project.updatedAt,
  differingSourceFiles: Object.keys(a).filter((key) => a[key] !== b[key]),
}, null, 2));
