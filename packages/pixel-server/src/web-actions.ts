export interface WebImportFile {
  name: string;
  mimeType: string;
  dataBase64: string;
}

export interface WebConvertSettings {
  canvasWidth: number;
  canvasHeight: number;
  colorCount: number;
  contentScale: number;
  alignment: "center" | "bottom-center";
  dithering: "none" | "floyd-steinberg";
  background: "alpha" | "solid" | "local-removal";
  palette?: string[];
}

export type WebControlCommand =
  | { type: "get_context" }
  | {
    type: "set_view";
    inspectorTab?: "convert" | "edit" | "frames";
    inspectorOpen?: boolean;
    projectScopeOpen?: boolean;
    tool?: "pen" | "eraser" | "fill" | "select";
    editMap?: "color" | "normal";
    normalPreview?: "map" | "lit";
    normalValue?: number;
    colorIndex?: number;
    showGrid?: boolean;
    showLightMarker?: boolean;
    compareMode?: boolean;
    canvasBackground?: string;
    zoom?: number;
    fit?: "canvas" | "selection";
  }
  | {
    type: "set_active";
    sourceId?: string;
    clipId?: string;
    frameId?: string;
    layerId?: string;
  }
  | { type: "set_playback"; playing: boolean }
  | { type: "set_onion_skin"; previous?: boolean; next?: boolean; opacity?: number }
  | { type: "set_conversion"; settings: Partial<WebConvertSettings> }
  | { type: "save_conversion_preset" }
  | { type: "load_conversion_preset"; index: number }
  | { type: "new_project"; name?: string }
  | { type: "save_project_as"; name: string }
  | { type: "open_recent_project"; projectId: string }
  | { type: "delete_recent_project"; projectId: string; confirm: true }
  | { type: "remove_source"; sourceId: string; confirm: true }
  | {
    type: "import_files";
    purpose: "replace-canvas" | "add-frames" | "add-source" | "replace-source" | "sprite-sheet" | "open-project";
    files: WebImportFile[];
    columns?: number;
    rows?: number;
  }
  | {
    type: "export";
    format: "png" | "normal" | "lit" | "gif" | "json";
    scope: "frame" | "clip" | "project";
    scale?: 1 | 2 | 4 | 8;
  };

export interface WebCommandEnvelope {
  id: string;
  command: WebControlCommand;
}

export interface SessionProjectState {
  id: string;
  name: string;
  revision: number;
  clips: Array<{ id: string; name: string; frameIds: string[] }>;
  active?: { clipId?: string; frameId?: string; layerId?: string };
  sourceCount: number;
}
