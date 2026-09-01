import { PixelDocumentSchema } from "@editable-pixel/document";
import { Type, type Static } from "@sinclair/typebox";

const Identifier = Type.String({
  minLength: 1,
  maxLength: 128,
  pattern: "^[A-Za-z0-9][A-Za-z0-9._-]*$"
});
const DisplayName = Type.String({ minLength: 1, maxLength: 256 });

export const ProjectSourceSchema = Type.Object(
  {
    id: Identifier,
    name: Type.String({ minLength: 1, maxLength: 512 }),
    kind: Type.Union([
      Type.Literal("image"),
      Type.Literal("sprite-sheet"),
      Type.Literal("pixel-json")
    ]),
    mimeType: Type.String({ minLength: 1, maxLength: 128 }),
    digest: Type.Optional(Type.String({ pattern: "^[0-9a-f]{64}$" })),
    dataBase64: Type.Optional(Type.String({ minLength: 1 })),
    frameIds: Type.Optional(Type.Array(Identifier, { minItems: 1 })),
    frames: Type.Optional(Type.Array(Type.Object({
      frameId: Identifier,
      name: Type.String({ minLength: 1, maxLength: 512 }),
      mimeType: Type.String({ minLength: 1, maxLength: 128 }),
      digest: Type.String({ pattern: "^[0-9a-f]{64}$" }),
      dataBase64: Type.String({ minLength: 1 })
    }, { additionalProperties: false }), { minItems: 1 })),
    createdAt: Type.String({ minLength: 1, maxLength: 64 })
  },
  { additionalProperties: false }
);

export const ProjectClipSchema = Type.Object(
  {
    id: Identifier,
    name: DisplayName,
    frameIds: Type.Array(Identifier, { minItems: 1 })
  },
  { additionalProperties: false }
);

export const ProjectActiveContextSchema = Type.Object(
  {
    clipId: Type.Optional(Identifier),
    frameId: Type.Optional(Identifier),
    layerId: Type.Optional(Identifier)
  },
  { additionalProperties: false }
);

export const PixelProjectSchema = Type.Object(
  {
    format: Type.Literal("pixel-project"),
    version: Type.Literal(1),
    id: Identifier,
    name: DisplayName,
    revision: Type.Integer({ minimum: 0 }),
    createdAt: Type.String({ minLength: 1, maxLength: 64 }),
    updatedAt: Type.String({ minLength: 1, maxLength: 64 }),
    sources: Type.Array(ProjectSourceSchema),
    document: PixelDocumentSchema,
    clips: Type.Array(ProjectClipSchema, { minItems: 1 }),
    active: Type.Optional(ProjectActiveContextSchema)
  },
  { additionalProperties: false }
);

export type ProjectSource = Static<typeof ProjectSourceSchema>;
export type ProjectClip = Static<typeof ProjectClipSchema>;
export type ProjectActiveContext = Static<typeof ProjectActiveContextSchema>;
export type PixelProject = Static<typeof PixelProjectSchema>;
