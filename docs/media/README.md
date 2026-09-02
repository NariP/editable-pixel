# README demo media

The comparisons use actual Editable Pixel exports from the robot fixture in [robot-hop-8](../test-assets/robot-hop-8/). The working demo has eight 128×128 frames. Remotion 4.0.520 composes the labels and comparisons; sprites are displayed at matching integer scales without resampling their logical pixel grids.

## What each example demonstrates

| Image | Change | Preserved |
| --- | --- | --- |
| [Palette](./before-after-palette.png) | 35 warm shell colors, from dark red shadows through orange midtones to cream highlights, mapped to 35 distinct blues across all eight frames. | Every pixel not using those palette entries; alpha, pose, position, frame timing, and normal-map pixels. |
| [Ground](./before-after-ground.png) | An intentionally offset Frame 8 moved down 13 px, from bottommost opaque Y108 to Y121, matching Frame 1. | Frame 8's pose and color pixels. The reference and final pose are not identical. |
| [Lighting](./before-after-lighting.png) | Prepared per-frame normal maps rendered with Toon Palette lighting: 6 steps, intensity 0.38, ambient 0.58. | The editable Color layer and alpha. Lighting is baked only into the Lit export. |

[Editor screenshot](./editor-palette-ai.png) shows the real browser after the blue-palette edit. It is not a recreated editor mockup or an AI-host chat transcript.

## Palette verification

The [exact correspondence](./robot-palette-map.json) includes all 35 source and target colors. Each shade was added and applied through the MCP `use_editable_pixel` palette actions; frame images came from `export_frame`. Near-identical orange entries remain distinct blue entries rather than being flattened into one color.

All eight output frames were checked pixel by pixel against that map. Non-target pixels and alpha must be byte-identical; Normal exports must also be byte-identical before and after recoloring.

| Frame | Recolored pixels |
| --- | ---: |
| 1 | 1,490 |
| 2 | 1,391 |
| 3 | 1,185 |
| 4 | 1,561 |
| 5 | 1,505 |
| 6 | 1,541 |
| 7 | 1,586 |
| 8 | 1,288 |
| Total | 11,547 |

Frames 3 and 5 use 34 of the warm shades; the other frames use all 35. The original cyan accent colors and dark navy visor colors are outside the remap.

## Scope of the examples

- These are separate editing demonstrations, not successive promises of automatic quality improvement.
- The normal maps were prepared for the demo; image import alone does not infer them.
- The grounding example was staged in a separate demo copy, then repaired through the real move-selection action.
- The accompanying promotional video's palette edit uses a real MCP screen recording at 3× speed. Its request text is an editorial caption.
- The earlier 64×64 motion GIF and editor screenshot are retained for history, but the current before/after comparisons use the 128×128 demo.

Verified on 2026-09-03.
