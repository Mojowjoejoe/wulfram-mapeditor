# Canonical map corpus calibration

Generated from commit `4e24f1696258d90c12c2bcd3f7fe660b6b528fe8` of
`blackwatergaming/wulfram-maps` on 2026-09-05 with:

```powershell
npm run maps:analyze -- ..\wulfram-maps
```

The analyzer read all 47 canonical source directories through Forge’s production
map-source parser. It measured 782,127 terrain vertices and 47 active base layouts.
The current editor checkout exposes 74 base templates: 73 extracted powered
formations plus the curated Base in a Box template.

## Fixed corpus dimensions

Every canonical map uses:

- 129 × 129 terrain vertices
- 5,600 × 5,600 world units

The first generator version therefore uses those dimensions as its compatibility
default. Supporting other valid dimensions remains a product feature, but generated
defaults should not pretend that other sizes were calibrated from this corpus.

## Terrain distributions

| Measurement across maps | Minimum | P10 | P25 | Median | P75 | P90 | Maximum |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| Elevation range | 54.228 | 278.453 | 407.262 | 524.394 | 700.415 | 869.386 | 1,242.535 |
| Height standard deviation | 7.044 | 41.471 | 56.948 | 89.958 | 134.823 | 163.169 | 225.957 |
| Median adjacent height step | 0 | 0 | 2.318 | 4.531 | 6.375 | 9.527 | 10.574 |
| P90 adjacent height step | 0 | 11.256 | 17.371 | 23.894 | 37.372 | 49.820 | 63.828 |
| Median sampled slope, degrees | 0 | 0 | 6.254 | 12.507 | 16.616 | 22.698 | 28.802 |
| P90 sampled slope, degrees | 0 | 23.635 | 30.957 | 38.453 | 52.247 | 67.088 | 74.339 |
| Maximum sampled slope, degrees | 20.058 | 59.733 | 67.525 | 72.902 | 77.841 | 82.069 | 85.343 |
| Fraction at or below 22 degrees | 0.36388 | 0.49062 | 0.58680 | 0.69651 | 0.81112 | 0.87310 | 1.00000 |

The 22-degree calculation is an offline terrain-slope proxy using Forge’s existing
sampler. It is not proof of the live vehicle movement rules. The distribution shows
that original maps intentionally include steep terrain; requiring every vertex to be
under 22 degrees would erase authentic terrain structure. The generator should
instead require connected safe routes and a calibrated traversable-area floor.

## Layout distributions

| Measurement across active layouts | Minimum | P10 | P25 | Median | P75 | P90 | Maximum |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| Total editable entities | 0 | 30 | 30 | 30 | 36 | 50 | 70 |
| Team 1 entities | 0 | 15 | 15 | 15 | 15 | 15 | 29 |
| Team 2 entities | 0 | 15 | 15 | 15 | 15 | 15 | 29 |
| Absolute team-count difference | 0 | 0 | 0 | 0 | 0 | 0 | 1 |
| Team centroid separation, world units | 584.674 | 1,912.322 | 2,904.468 | 3,655.882 | 4,356.308 | 5,074.557 | 6,784.375 |
| Separation / world diagonal | 0.07383 | 0.24147 | 0.36674 | 0.46162 | 0.55007 | 0.64076 | 0.85666 |

Some arena/training sources have zero or one editable entity and are not competitive
two-team reference layouts. Generator calibration must identify competitive fixtures
rather than treating every original map as equally representative.

## Initial profile decisions supported by the corpus

- Compatibility default: 129 × 129 vertices and 5,600 × 5,600 world units.
- Standard relief reference: approximately the 524-unit median elevation range.
- Gentle and rugged references should be derived from approximately the P10/P75
  ranges (278/700), then validated rather than used as automatic pass criteria.
- A 0.58 terrain fraction at or below the offline 22-degree proxy corresponds roughly
  to the corpus P25. The strict generator should target at least the median 0.70 while
  using the P25 value only as a provisional hard floor until movement rules and route
  clearance are verified.
- Competitive originals usually use 15 entities per team, but exact paired equality
  is more important than forcing every generated template to contain 15.
- A default normalized base-centroid separation near 0.46 matches the corpus median;
  strict generator anchors should stay inside the central P25–P75 band unless a
  topology profile explicitly says otherwise.

These are calibration references, not live-balance proof. Route redundancy,
clearance, objective timing, side-swapped playtests, and authoritative mechanics still
own the release decision.

