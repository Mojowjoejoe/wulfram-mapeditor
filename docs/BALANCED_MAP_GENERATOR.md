# Balanced map generator contract

Status: implementation contract for `editor/balanced-map-generator`.

## Claim boundary

Forge may label a generated candidate **strict-symmetry validated** only when every
hard gate in this document passes. That label means the canonical terrain and team
layout are rotationally paired and satisfy the configured offline traversability
model. It does not claim a statistically proven live win rate.

A map may be labeled **playtest reviewed** only when its exact generator version,
seed, source revision, package checksum, and side-swapped playtest record are linked.

## Current editor workflow

The feature branch currently exposes a **Balanced** action in the Forge header:

1. Enter a map name and reproducible text seed.
2. Choose a base template, original terrain texture theme, and relief.
3. Select **Generate three** to build the open-field, three-route, and ring-center
   candidates from the same seed.
4. Compare slope-proxy coverage, separated route counts, map errors, and the full
   gate list. Failed candidates remain visible but cannot be applied.
5. Select a passing candidate and choose **Apply passing candidate**. The prior map
   becomes one undoable history entry; canceling the dialog changes nothing.

The curated Base in a Box is the default. If a selected template does not contain an
uplink, project generation adds one terrain-conformed uplink per team at exact
rotationally paired positions. The completed project must still pass normal Forge
validation; infrastructure errors cannot be hidden by the balance score.

Current implementation limits are deliberate: the dialog does not yet render three
independent 3D thumbnails, the center objective is an analysis region rather than a
placed gameplay entity, route
clearance still uses grid separation rather than verified vehicle footprints, and
no generated map has yet passed live side-swapped playtesting.

## Versioned first-release profile

Profile ID: `strict-rotational-v1`

| Setting | Initial value | Basis |
| --- | ---: | --- |
| Terrain vertices | 129 × 129 | All 47 canonical maps |
| World size | 5,600 × 5,600 | All 47 canonical maps |
| Symmetry | 180-degree rotation | Exact two-team parity without reflection handedness |
| Standard relief reference | 524 world units | Corpus median elevation range |
| Target slope-passable fraction | 0.70 | Corpus median at the provisional 22-degree proxy |
| Provisional minimum slope-passable fraction | 0.58 | Corpus P25; must not replace route gates |
| Base separation reference | 0.46 of world diagonal | Corpus median team-centroid separation |
| Minimum standard routes | 2 | First-release design requirement |

Slope/passability values are explicitly configurable and provisional until the game
team verifies the ground-movement contract. Forge’s current 22-degree value is an
object-placement validation setting, not confirmed live vehicle navigation law.

## Deterministic input

The complete generation identity is:

```text
generator version + profile ID + seed + dimensions + world size
+ topology + relief + texture family + base template + objective mode
```

The same complete identity must produce byte-identical canonical terrain and paired
entity data. Timestamps and user-facing project names must be excluded from the
deterministic content comparison.

Seeds are normalized as UTF-8 text and hashed by a documented stable algorithm.
Changing generator behavior requires a new generator version and retained regression
fixtures for older versions.

## Rotational invariants

For a terrain vertex at `(x, y)`, its pair is:

```text
(width - 1 - x, height - 1 - y)
```

Paired vertices must have exactly equal height and texture ID after every generation,
smoothing, carving, and serialization step. Edge pinning is reapplied before the
final invariant check.

For each Team 1 entity at `(x, y, z)` with yaw `r`, there must be a Team 2 entity with
the same token, subtype, active state, and non-team metadata at:

```text
(worldWidth - x, worldHeight - y, paired terrain-conformed z)
yaw = normalize(r + pi)
```

Pitch and roll must be recalculated from the paired terrain using the existing model
clearance/snap behavior and then compared under the rotational transform. Supply
starships retain their authored locked altitude/orientation rules.

Center-neutral entities may be self-paired. Every other neutral strategic entity must
have a rotational partner.

## Terrain construction

The generator builds terrain from named masks rather than unconstrained pixels:

- Reserved flat team base pads
- Intended strategic lanes
- Ridges and walls
- Valleys and bowls
- Plateaus/high ground
- Neutral objective zones
- Low-frequency seeded variation
- Zero-height outer boundary

Only the independent rotational domain receives random decisions. Its paired domain
is copied exactly. Any global filtering must operate on paired samples or be followed
by an exact symmetry repair.

The first release provides:

- `open-field`: broad connected maneuver area with gentle cover/high-ground features
- `three-route`: center and two flank approaches separated by deliberate ridges
- `ring-center`: connected outer route plus contested center approaches

## Offline traversal model

Traversal is evaluated on the terrain grid with horizontal/vertical and diagonal
neighbor edges. An edge is traversable when:

- Both endpoint heights are finite.
- Its grade does not exceed the configured movement slope.
- Its surrounding clearance meets the configured footprint requirement.
- It is not excluded by a reserved impassable mask.

Edge cost is its three-dimensional segment length. Additional texture or combat costs
must remain disabled unless an authoritative rule supports them.

Base anchors are mapped to their nearest traversable grid vertices. Center/objective
targets are regions, not a single fragile vertex. Paths use deterministic shortest
path search with stable tie-breaking.

A second route counts as meaningfully distinct only when it clears the profile’s
separation corridor from the first route for the required portion of its length.
Merely stepping around one grid vertex does not count as a strategic alternative.

## Hard gates

A candidate is rejected when any of these are true:

1. Terrain dimensions or arrays are inconsistent.
2. A height/entity value is non-finite or out of bounds.
3. Exact rotational terrain or team pairing fails.
4. Existing Forge validation reports an error.
5. Either base anchor or a required objective has no traversable representative.
6. Either team cannot reach a required objective or the paired base conflict region.
7. A paired route exists for only one team.
8. A standard topology has fewer than two meaningfully distinct strategic routes.
9. Traversable connected coverage is below the configured hard floor.
10. Neutral strategic placement is not centered or rotationally paired.
11. Canonical source or original-package round trip changes the candidate semantically.
12. Repeating the complete generation identity changes deterministic content.

Hard gates are evaluated before candidate ranking. No aggregate score can compensate
for a failed hard gate.

## Reported metrics

The structured report contains:

- Generator identity and source revision
- Each hard gate and evidence
- Terrain elevation, roughness, and slope distributions
- Traversable and largest-connected-area fractions
- Base-to-center, base-to-objective, and base-to-base costs
- Route count, separation, and minimum clearance
- Reachable high-ground area by team
- Entity/type counts and power coverage by team
- Neutral objective parity
- Exact paired deltas
- Candidate novelty descriptors
- Explicit limitations of the offline model

Ranking uses hard-gate-first lexicographic or Pareto/quality-diversity selection. The
UI may show a concise summary but must retain the complete report for inspection and
publication evidence.

## Persistence

Generator metadata is optional and backward-compatible. It must not alter legacy map
semantics. The canonical representation should retain stable fields for generator
version, profile, seed, topology, and parameter JSON or their normalized equivalents.

Schema changes require coordinated parser, serializer, fixture, editor, maps schema,
and round-trip coverage. Do not place terrain-wide provenance only in an active base
layout.

## Required verification

- Unit tests for seed normalization, PRNG stability, masks, transforms, and gates
- Hand-verifiable traversal fixtures
- Adversarial seed corpus
- Repeated-generation byte comparison
- 47-map compatibility round trips
- Base-template placement regression coverage
- Browser build and interaction tests
- Headed WebView2 generation/apply/undo/save/reload probe
- Repository write-scope and branch-publication tests
- Side-swapped playtesting for the first published generated map
- Public artifact checksum verification and clean-install smoke test

## Use of AI-generated imagery

AI imagery may be imported as an optional aesthetic mask only after the deterministic
generator has established base pads, routes, objectives, bounds, and symmetry. The
result must still pass every hard gate. An AI image, screenshot, or visual impression
is never balance evidence.
