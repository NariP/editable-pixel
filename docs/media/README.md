# README demo media

The palette and grounding comparisons use actual Editable Pixel exports from the robot fixture in [robot-hop-8](../test-assets/robot-hop-8/), with eight 128×128 frames. The lighting showcase uses the separately supplied [evaluation-fixture-lit.png](./evaluation-fixture-lit.png), a 128×128 RGBA image. Remotion 4.0.520 composes the labels; sprite images use integer display scales without filtering.

## Promo video

- [Watch the current promo](https://github.com/user-attachments/assets/cd54beff-7445-4f5a-83be-fcb16d0de2c9): 40 seconds, 1920×1080, 30 fps, H.264 video with AAC audio. Korean captions and instrumental music.
- This is the approved Remotion render with the selected Lit PNG showcase, copied without re-encoding. SHA-256: `be1636f9068a9a7e78fc48633aa92c5491884f769a1fa44133c4c5253b4e86b1`.
- [README thumbnail](./promo-preview.jpg): extracted from the video at 3 seconds.
- Music: **Pixel Sprinter** by **Zane Little Music**, [source on OpenGameArt](https://opengameart.org/content/pixel-sprinter), [CC0 1.0](https://creativecommons.org/publicdomain/zero/1.0/). The video uses the first 40 seconds with reduced volume and fades.
- The archived MP4 remains in `.github/media/` so it does not add to the npm installation size. Both READMEs embed a GitHub video attachment as a standalone URL, rather than linking to the repository's binary file page. Attachment access follows repository visibility.

## What each example demonstrates

| Image | Change | Preserved |
| --- | --- | --- |
| [Palette](./before-after-palette.png) | 35 warm shell colors, from dark red shadows through orange midtones to cream highlights, mapped to 35 distinct blues across all eight frames. | Every pixel not using those palette entries; alpha, pose, position, frame timing, and normal-map pixels. |
| [Ground](./before-after-ground.png) | An intentionally offset Frame 8 moved down 13 px, from bottommost opaque Y108 to Y121, matching Frame 1. | Frame 8's pose and color pixels. The reference and final pose are not identical. |
| [Lighting](./before-after-lighting.png) | Displays the user-selected Lit PNG on a white presentation backdrop, at 4×. The workflow caption introduces Smooth lighting instead of Toon Palette steps. | The supplied PNG's complete RGBA data. It is not recolored, relit, or regenerated for the showcase. |

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
- Normal-map editing and Smooth lighting are product features; image import alone does not infer a normal map. The selected lighting PNG does not embed its original normal map or lighting settings. No claim is made that the previous demo's normal map or numeric light settings produced this file.
- The grounding example was staged in a separate demo copy, then repaired through the real move-selection action.
- The accompanying promotional video's palette edit uses a real MCP screen recording at 3× speed. Its request text is an editorial caption.
- The earlier 64×64 motion GIF and editor screenshot are retained for history. Palette and grounding use the 128×128 animation demo; the lighting showcase is a separate static 128×128 export, not eight animated frames.

## Lighting source

- Supplied file: `evaluation-fixture-lit.png`, selected by the user from Downloads on 2026-09-03.
- The tracked PNG is byte-identical to that file; only the surrounding presentation is composed in Remotion.
- Source SHA-256: `ed49929c714d078f421fc814afbcd63fa16125c43013abce155d59f8858692f7`.
- The README shows it at 4×, and the video's lighting scene at 6×. Both use nearest-neighbor display.
- The earlier Color/Normal/Lit triptych and six-step/38% captions were replaced, because their source maps did not match the selected PNG.

Verified on 2026-09-03.
