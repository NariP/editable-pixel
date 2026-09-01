import { Type, type Static } from "@sinclair/typebox";

const Identifier = Type.String({ minLength: 1, maxLength: 128 });
const PositiveDimension = Type.Integer({ minimum: 1, maximum: 4096 });
const Coordinate = Type.Integer({ minimum: 0, maximum: 4095 });
const RgbaColor = Type.String({ pattern: "^#[0-9a-fA-F]{8}$" });
const PackedNormal = Type.Integer({ minimum: 0, maximum: 0xffffff });

export const RectSchema = Type.Object(
  {
    x: Coordinate,
    y: Coordinate,
    width: PositiveDimension,
    height: PositiveDimension
  },
  { additionalProperties: false }
);

const SelectionBounds = {
  x: Coordinate,
  y: Coordinate,
  width: PositiveDimension,
  height: PositiveDimension,
  layerId: Identifier,
  frameId: Identifier
};

export const SelectionSchema = Type.Union([
  Type.Object(
    {
      type: Type.Literal("rect"),
      ...SelectionBounds
    },
    { additionalProperties: false }
  ),
  Type.Object(
    {
      type: Type.Literal("mask"),
      ...SelectionBounds,
      indices: Type.Array(Type.Integer({ minimum: 0 }), { minItems: 1 })
    },
    { additionalProperties: false }
  )
]);

export const ConversionOptionsSchema = Type.Object(
  {
    canvasWidth: PositiveDimension,
    canvasHeight: PositiveDimension,
    colorCount: Type.Integer({ minimum: 1, maximum: 256 }),
    alignment: Type.Union([Type.Literal("center"), Type.Literal("bottom-center")]),
    contentScale: Type.Number({ exclusiveMinimum: 0, maximum: 1 }),
    dithering: Type.Union([Type.Literal("none"), Type.Literal("floyd-steinberg")]),
    background: Type.Union([
      Type.Literal("alpha"),
      Type.Literal("solid"),
      Type.Literal("local-removal")
    ])
  },
  { additionalProperties: false }
);

export const FrameLightingSchema = Type.Object(
  {
    x: Type.Number({ minimum: -1, maximum: 2 }),
    y: Type.Number({ minimum: -1, maximum: 2 }),
    height: Type.Number({ minimum: 0.05, maximum: 10 }),
    intensity: Type.Number({ minimum: 0, maximum: 10 }),
    ambient: Type.Number({ minimum: 0, maximum: 1 }),
    shading: Type.Optional(Type.Union([
      Type.Literal("smooth"),
      Type.Literal("toon-palette")
    ])),
    toonSteps: Type.Optional(Type.Integer({ minimum: 3, maximum: 6 }))
  },
  { additionalProperties: false }
);

export const FrameLightingInterpolationSchema = Type.Union([
  Type.Literal("hold"),
  Type.Literal("linear"),
  Type.Literal("ease-in"),
  Type.Literal("ease-out"),
  Type.Literal("ease-in-out")
]);

export const FrameSchema = Type.Object(
  {
    id: Identifier,
    name: Type.String({ minLength: 1, maxLength: 128 }),
    durationMs: Type.Integer({ minimum: 1, maximum: 60_000 }),
    lighting: Type.Optional(FrameLightingSchema),
    lightingInterpolation: Type.Optional(FrameLightingInterpolationSchema)
  },
  { additionalProperties: false }
);

export const LayerSchema = Type.Object(
  {
    id: Identifier,
    name: Type.String({ minLength: 1, maxLength: 128 }),
    visible: Type.Boolean(),
    opacity: Type.Number({ minimum: 0, maximum: 1 }),
    blendMode: Type.Literal("normal"),
    frames: Type.Record(Identifier, Type.Array(Type.Integer({ minimum: 0, maximum: 255 }))),
    normalFrames: Type.Optional(Type.Record(Identifier, Type.Array(PackedNormal)))
  },
  { additionalProperties: false }
);

export const RegionSchema = Type.Object(
  {
    id: Identifier,
    name: Type.String({ minLength: 1, maxLength: 128 }),
    layerId: Identifier,
    frameId: Identifier,
    bounds: RectSchema
  },
  { additionalProperties: false }
);

export const PixelDocumentSchema = Type.Object(
  {
    format: Type.Literal("pixel-document"),
    version: Type.Literal(1),
    id: Identifier,
    revision: Type.Integer({ minimum: 0 }),
    metadata: Type.Object(
      {
        createdBy: Type.String({ minLength: 1, maxLength: 128 }),
        modifiedBy: Type.String({ minLength: 1, maxLength: 128 }),
        source: Type.Optional(
          Type.Object(
            {
              name: Type.String({ minLength: 1, maxLength: 512 }),
              mimeType: Type.String({ minLength: 1, maxLength: 128 }),
              digest: Type.String({ pattern: "^[0-9a-f]{64}$" })
            },
            { additionalProperties: false }
          )
        ),
        conversion: Type.Optional(ConversionOptionsSchema)
      },
      { additionalProperties: false }
    ),
    canvas: Type.Object(
      {
        width: PositiveDimension,
        height: PositiveDimension
      },
      { additionalProperties: false }
    ),
    palette: Type.Array(RgbaColor, { minItems: 1, maxItems: 256 }),
    transparentColorIndex: Type.Integer({ minimum: 0, maximum: 255 }),
    frames: Type.Array(FrameSchema, { minItems: 1 }),
    layers: Type.Array(LayerSchema, { minItems: 1 }),
    contentBox: RectSchema,
    contentBounds: RectSchema,
    alignment: Type.Union([Type.Literal("center"), Type.Literal("bottom-center")]),
    pivot: Type.Object(
      {
        x: Coordinate,
        y: Coordinate
      },
      { additionalProperties: false }
    ),
    regions: Type.Array(RegionSchema),
    selection: Type.Optional(SelectionSchema)
  },
  { additionalProperties: false }
);

export type Rect = Static<typeof RectSchema>;
export type Selection = Static<typeof SelectionSchema>;
export type ConversionOptions = Static<typeof ConversionOptionsSchema>;
export type FrameLighting = Static<typeof FrameLightingSchema>;
export type FrameLightingInterpolation = Static<typeof FrameLightingInterpolationSchema>;
export type Frame = Static<typeof FrameSchema>;
export type Layer = Static<typeof LayerSchema>;
export type Region = Static<typeof RegionSchema>;
export type PixelDocument = Static<typeof PixelDocumentSchema>;
