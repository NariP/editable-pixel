# Project model

Editable Pixel is organized around one local Project and one editable pixel canvas. This document defines which data belongs to that Project and how import, autosave, animation, and export behave.

## Hierarchy

```text
Project
├── Sources[]                 optional inputs for comparison or reconversion
├── Pixel Document            one editable canvas
│   ├── Canvas + Palette
│   ├── Layers[]
│   │   └── per-frame Color / Normal data
│   └── Frames[]
│       ├── Duration
│       └── Lighting
└── Clips[]                   ordered groups of Frame IDs
```

### Project

A Project is the top-level unit that users open, edit, autosave, and duplicate with **Save As**. The Project name is also the name of the canvas workspace. Editable Pixel does not add a separate Asset or Variant hierarchy.

### Source

A Source is an optional original image, frame image, or sprite sheet retained for comparison and reconversion. A Project remains valid without a Source. Multiple Sources are references for the same canvas; they do not create additional canvases.

### Pixel Document

Each Project owns exactly one editable Pixel Document. It contains the canvas, palette, layers, frames, normal maps, and selection state and can be exchanged as `.pixel.json`.

### Layer

Each Layer owns Color pixels and optional Normal pixels for every Frame. Layer order, name, visibility, and opacity are stored in the Project.

### Frame

A Frame is one animation pose. It owns a duration and optional lighting keyframe, while every Layer supplies the Color and Normal data for the same Frame ID.

### Clip

A Clip is a named playback group such as `Idle`, `Walk`, `Jump`, or `Attack`. It references an ordered list of Frame IDs. In the current model, one Frame belongs to one Clip.

## Autosave and Save As

Editable Pixel does not require a manual Save action. A meaningful edit is recorded as one transaction and autosaved after it finishes, including:

- drawing, erasing, filling, pasting, and moving a selection;
- adding, deleting, or reordering Layers, Frames, and Clips;
- committing text or numeric inputs;
- applying conversion settings;
- finishing a lighting drag; and
- Undo or Redo.

**Save As** copies the complete Project to a new ID and name and switches the workspace to the copy. It creates a separate Project, not a new `V2` or Variant.

## Import behavior

Import intent is explicit rather than inferred only from the number of files:

- **Replace Canvas** replaces the current canvas with the converted input.
- **Add as Frames** appends ordered Frames to the current Clip.
- **Import Sprite Sheet** splits one image into Frames by rows and columns.
- **Add Source** retains an additional input for comparison or reconversion.
- **Replace Source** replaces only the selected Source.

Use a new Project or Save As when multiple independent canvases are required.

## Frames, normal maps, and lighting

- Duplicating a Frame copies every Layer's Color and Normal data, duration, and lighting keyframe.
- Deleting a Frame removes its pixels, normal data, lighting, and Clip references together.
- Clip playback uses Frame order and each Frame's duration.
- Lighting belongs to Frames, not Layers.
- Preview, playback, and Lit export use the same lighting evaluation.
- Lighting interpolation uses elapsed duration between keyframes rather than only Frame indexes.

## Export scopes

Exports can target:

- **Current Frame**
- **Current Clip**
- **Entire Project**

Available outputs include Color PNG, Normal PNG, Lit PNG, GIF, Sprite Sheet, Pixel JSON, and Pixel Project. `.pixel.json` is the editable canvas exchange format; `.pixel-project.json` contains the complete Project, including Sources and Clips.

## Invariants

- A source-less Project can be created, edited, and autosaved.
- One Project owns one editable canvas.
- Importing several images never silently creates an Asset hierarchy.
- Save As creates an independent Project ID.
- Frames, Layers, Normal Maps, Lighting, Undo/Redo, CLI, and MCP operate on the same Project revision model.

## Related documentation

- [Getting started](./getting-started.md)
- [Pixel Document v1](./pixel-document.md)
- [CLI reference](./cli.md)
- [MCP and host integration](./mcp.md)
