import type { CardLineLayer } from "./types.js";

export type CardPixelSize = {
  readonly width: number;
  readonly height: number;
};

export type LegacyLineLayer = {
  readonly id: string;
  readonly kind: "line";
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
  readonly color: string;
  readonly strokeWidth?: number;
  readonly rotation?: number;
  readonly zIndex?: number;
  readonly opacity?: number;
};

export type LineLayerRenderGeometry = {
  readonly leftPx: number;
  readonly topPx: number;
  readonly widthPx: number;
  readonly heightPx: number;
  readonly angleDeg: number;
};

const defaultCardSize: CardPixelSize = { width: 1080, height: 1350 };
const defaultLineColor = "#111111";

export function migrateLineLayer(
  layer: LegacyLineLayer,
  cardSize: CardPixelSize = defaultCardSize
): CardLineLayer {
  const x = clampPercent(layer.x);
  const y = clampPercent(layer.y);
  const width = clampRange(layer.width, 1, 100);
  const height = clampRange(layer.height, 0, 100);
  const centerXPercent = x + width / 2;
  const centerYPercent = y + height / 2;
  const centerXPx = (centerXPercent / 100) * cardSize.width;
  const centerYPx = (centerYPercent / 100) * cardSize.height;
  const lengthPx = (width / 100) * cardSize.width;
  const angleRad = (normalizeAngle(layer.rotation ?? 0) * Math.PI) / 180;
  const deltaXPx = (lengthPx / 2) * Math.cos(angleRad);
  const deltaYPx = (lengthPx / 2) * Math.sin(angleRad);
  const thickness =
    layer.strokeWidth !== undefined
      ? layer.strokeWidth
      : Math.max(1, Math.round((height / 100) * cardSize.height));

  return normalizeLineLayer({
    id: layer.id,
    kind: "line",
    x1: ((centerXPx - deltaXPx) / cardSize.width) * 100,
    y1: ((centerYPx - deltaYPx) / cardSize.height) * 100,
    x2: ((centerXPx + deltaXPx) / cardSize.width) * 100,
    y2: ((centerYPx + deltaYPx) / cardSize.height) * 100,
    thickness,
    color: layer.color,
    ...(layer.zIndex !== undefined ? { zIndex: layer.zIndex } : {}),
    ...(layer.opacity !== undefined ? { opacity: layer.opacity } : {})
  });
}

export function normalizeLineLayer(layer: CardLineLayer): CardLineLayer {
  return {
    id: layer.id.trim() || "line",
    kind: "line",
    x1: roundLayerValue(clampPercent(layer.x1)),
    y1: roundLayerValue(clampPercent(layer.y1)),
    x2: roundLayerValue(clampPercent(layer.x2)),
    y2: roundLayerValue(clampPercent(layer.y2)),
    thickness: Math.round(clampRange(layer.thickness, 1, 40)),
    color: isHexColor(layer.color) ? layer.color : defaultLineColor,
    ...(layer.zIndex !== undefined ? { zIndex: Math.round(clampRange(layer.zIndex, 0, 20)) } : {}),
    ...(layer.opacity !== undefined ? { opacity: clamp01(layer.opacity) } : {})
  };
}

export function getLineLayerRenderGeometry(
  layer: CardLineLayer,
  cardSize: CardPixelSize = defaultCardSize
): LineLayerRenderGeometry {
  const x1Px = (layer.x1 / 100) * cardSize.width;
  const y1Px = (layer.y1 / 100) * cardSize.height;
  const x2Px = (layer.x2 / 100) * cardSize.width;
  const y2Px = (layer.y2 / 100) * cardSize.height;
  return {
    leftPx: x1Px,
    topPx: y1Px,
    widthPx: Math.hypot(x2Px - x1Px, y2Px - y1Px),
    heightPx: layer.thickness,
    angleDeg: normalizeAngle((Math.atan2(y2Px - y1Px, x2Px - x1Px) * 180) / Math.PI)
  };
}

export function rotateLineLayer(
  layer: CardLineLayer,
  angleDeg: number,
  cardSize: CardPixelSize = defaultCardSize
): CardLineLayer {
  const x1Px = (layer.x1 / 100) * cardSize.width;
  const y1Px = (layer.y1 / 100) * cardSize.height;
  const x2Px = (layer.x2 / 100) * cardSize.width;
  const y2Px = (layer.y2 / 100) * cardSize.height;
  const centerXPx = (x1Px + x2Px) / 2;
  const centerYPx = (y1Px + y2Px) / 2;
  const lengthPx = Math.hypot(x2Px - x1Px, y2Px - y1Px);
  const angleRad = (normalizeAngle(angleDeg) * Math.PI) / 180;
  const deltaXPx = (lengthPx / 2) * Math.cos(angleRad);
  const deltaYPx = (lengthPx / 2) * Math.sin(angleRad);

  return normalizeLineLayer({
    ...layer,
    x1: ((centerXPx - deltaXPx) / cardSize.width) * 100,
    y1: ((centerYPx - deltaYPx) / cardSize.height) * 100,
    x2: ((centerXPx + deltaXPx) / cardSize.width) * 100,
    y2: ((centerYPx + deltaYPx) / cardSize.height) * 100
  });
}

export function translateLineLayer(
  layer: CardLineLayer,
  deltaXPercent: number,
  deltaYPercent: number
): CardLineLayer {
  return normalizeLineLayer({
    ...layer,
    x1: layer.x1 + deltaXPercent,
    y1: layer.y1 + deltaYPercent,
    x2: layer.x2 + deltaXPercent,
    y2: layer.y2 + deltaYPercent
  });
}

export function setLineLayerEndpoint(
  layer: CardLineLayer,
  endpoint: "start" | "end",
  x: number,
  y: number,
  snap: boolean,
  cardSize: CardPixelSize = defaultCardSize
): CardLineLayer {
  const fixedX = endpoint === "start" ? layer.x2 : layer.x1;
  const fixedY = endpoint === "start" ? layer.y2 : layer.y1;
  const nextPoint = snap ? snapEndpoint(fixedX, fixedY, x, y, cardSize) : { x, y };
  return normalizeLineLayer(
    endpoint === "start"
      ? { ...layer, x1: nextPoint.x, y1: nextPoint.y }
      : { ...layer, x2: nextPoint.x, y2: nextPoint.y }
  );
}

export function getLineLayerAngle(layer: CardLineLayer, cardSize: CardPixelSize = defaultCardSize): number {
  return getLineLayerRenderGeometry(layer, cardSize).angleDeg;
}

function snapEndpoint(
  fixedX: number,
  fixedY: number,
  x: number,
  y: number,
  cardSize: CardPixelSize
): { readonly x: number; readonly y: number } {
  const fixedXPx = (fixedX / 100) * cardSize.width;
  const fixedYPx = (fixedY / 100) * cardSize.height;
  const xPx = (x / 100) * cardSize.width;
  const yPx = (y / 100) * cardSize.height;
  const lengthPx = Math.hypot(xPx - fixedXPx, yPx - fixedYPx);
  const angle = Math.atan2(yPx - fixedYPx, xPx - fixedXPx);
  const snappedAngle = (Math.round((angle * 180) / Math.PI / 15) * 15 * Math.PI) / 180;
  return {
    x: ((fixedXPx + lengthPx * Math.cos(snappedAngle)) / cardSize.width) * 100,
    y: ((fixedYPx + lengthPx * Math.sin(snappedAngle)) / cardSize.height) * 100
  };
}

function normalizeAngle(value: number): number {
  const finite = Number.isFinite(value) ? value : 0;
  const normalized = ((finite % 360) + 360) % 360;
  const rounded = Math.round(normalized * 1000) / 1000;
  return Object.is(rounded, -0) ? 0 : rounded;
}

function isHexColor(value: string): boolean {
  return /^#[0-9a-f]{6}$/i.test(value);
}

function roundLayerValue(value: number): number {
  return Math.round(value * 1000) / 1000;
}

function clampPercent(value: number): number {
  return clampRange(value, 0, 100);
}

function clampRange(value: number, min: number, max: number): number {
  const finite = Number.isFinite(value) ? value : min;
  return Math.min(max, Math.max(min, finite));
}

function clamp01(value: number): number {
  return clampRange(value, 0, 1);
}
