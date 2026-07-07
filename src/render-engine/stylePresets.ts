import type { StylePresetRecord } from "../domain/types.js";

export type StylePresetId =
  | "newsprint"
  | "cinematic"
  | "magazine"
  | "whiteblue"
  | "minimal"
  | "darkinfo";

export type StylePreset = StylePresetRecord;

const gothicStack = `"Pretendard", "Noto Sans KR", "Malgun Gothic", "Segoe UI", sans-serif`;
const serifStack = `"Noto Serif KR", "Batang", "Nanum Myeongjo", serif`;

export const stylePresets: readonly StylePreset[] = [
  {
    id: "newsprint",
    name: "신문 오버레이 (사진)",
    usesPhoto: true,
    pageBackground: "linear-gradient(135deg, #f8f1e3 0%, #eef4f0 100%)",
    textBackdrop: "#fffcf4",
    chromeBackdrop: "#f8f1e3",
    ink: "#1d1d1b",
    inkSub: "#123c3a",
    inkMuted: "#53645f",
    accentDefault: "#a53d2d",
    badgeBackground: "#1d1d1b",
    badgeInk: "#fffcf4",
    fontTitle: gothicStack,
    fontBody: gothicStack,
    usesSurface: true,
    defaultDim: 0.85,
    surfaceLadder: ["#fffcf4", "#f8f1e3", "#eef4f0"],
    inkScale: { ink: "#1d1d1b", body: "#123c3a", mute: "#53645f", faint: "#8a9892" },
    hairline: "#1d1d1b",
    eyebrowStyle: "pill",
    titleTracking: -0.01,
    badgeRadius: "999px",
    bulletShape: "square",
    scrimStops: ["rgba(248,244,232,0.85)", "rgba(248,244,232,0.85)"]
  },
  {
    id: "cinematic",
    name: "시네마틱 (사진)",
    usesPhoto: true,
    pageBackground: "linear-gradient(160deg, #2b2b33 0%, #101014 100%)",
    textBackdrop: "#17171c",
    chromeBackdrop: "#17171c",
    ink: "#ffffff",
    inkSub: "#e8e6e1",
    inkMuted: "#b9b5ac",
    accentDefault: "#ffc648",
    badgeBackground: "rgba(255, 255, 255, 0.16)",
    badgeInk: "#ffffff",
    fontTitle: serifStack,
    fontBody: gothicStack,
    usesSurface: false,
    defaultDim: 0.62,
    surfaceLadder: ["#17171c", "#2b2b33", "#101014"],
    inkScale: { ink: "#ffffff", body: "#e8e6e1", mute: "#b9b5ac", faint: "#777269" },
    hairline: "rgba(255,255,255,0.18)",
    eyebrowStyle: "pill",
    titleTracking: 0,
    badgeRadius: "999px",
    bulletShape: "dot",
    scrimStops: ["rgba(10,10,14,0.34)", "rgba(10,10,14,0.47)", "rgba(10,10,14,0.87)"]
  },
  {
    id: "magazine",
    name: "매거진 형광 (사진)",
    usesPhoto: true,
    pageBackground: "linear-gradient(180deg, #3a3f4a 0%, #14161c 100%)",
    textBackdrop: "#1a1d24",
    chromeBackdrop: "#1a1d24",
    ink: "#ffffff",
    inkSub: "#dfe3ea",
    inkMuted: "#aab1bd",
    accentDefault: "#4f7cff",
    badgeBackground: "#ffffff",
    badgeInk: "#14161c",
    fontTitle: gothicStack,
    fontBody: gothicStack,
    usesSurface: false,
    defaultDim: 0.58,
    surfaceLadder: ["#1a1d24", "#3a3f4a", "#14161c"],
    inkScale: { ink: "#ffffff", body: "#dfe3ea", mute: "#aab1bd", faint: "#737c8c" },
    hairline: "rgba(255,255,255,0.16)",
    eyebrowStyle: "pill",
    titleTracking: 0,
    badgeRadius: "999px",
    bulletShape: "dot",
    scrimStops: ["rgba(20,22,28,0.32)", "rgba(20,22,28,0.44)", "rgba(20,22,28,0.83)"]
  },
  {
    id: "whiteblue",
    name: "화이트 & 블루",
    usesPhoto: false,
    pageBackground: "linear-gradient(170deg, __ACCENT__ 0%, #17255f 130%)",
    textBackdrop: "#2c4bd8",
    chromeBackdrop: "#2c4bd8",
    ink: "#ffffff",
    inkSub: "#eef2ff",
    inkMuted: "#c9d4f6",
    accentDefault: "#3557e8",
    badgeBackground: "rgba(255, 255, 255, 0.18)",
    badgeInk: "#ffffff",
    fontTitle: gothicStack,
    fontBody: gothicStack,
    usesSurface: false,
    defaultDim: 0,
    numberInk: "rgba(255, 255, 255, 0.92)",
    surfaceLadder: ["#2c4bd8", "#3557e8", "#17255f"],
    inkScale: { ink: "#ffffff", body: "#eef2ff", mute: "#c9d4f6", faint: "#8fa0e7" },
    hairline: "rgba(255,255,255,0.2)",
    eyebrowStyle: "pill",
    titleTracking: 0,
    badgeRadius: "999px",
    bulletShape: "dot"
  },
  {
    id: "minimal",
    name: "미니멀 화이트",
    usesPhoto: false,
    pageBackground: "#ffffff",
    textBackdrop: "#ffffff",
    chromeBackdrop: "#ffffff",
    ink: "#141414",
    inkSub: "#2c2c2c",
    inkMuted: "#6d6d6d",
    accentDefault: "#3557e8",
    badgeBackground: "#141414",
    badgeInk: "#ffffff",
    fontTitle: gothicStack,
    fontBody: gothicStack,
    usesSurface: false,
    defaultDim: 0,
    surfaceLadder: ["#ffffff", "#f4f6fb", "#e8ecf6"],
    inkScale: { ink: "#141414", body: "#2c2c2c", mute: "#6d6d6d", faint: "#a3a3a3" },
    hairline: "rgba(0,0,0,0.1)",
    eyebrowStyle: "pill",
    titleTracking: 0,
    badgeRadius: "999px",
    bulletShape: "dot"
  },
  {
    id: "darkinfo",
    name: "다크 인포",
    usesPhoto: false,
    pageBackground: "linear-gradient(180deg, #15161c 0%, #0b0c10 100%)",
    textBackdrop: "#12131a",
    chromeBackdrop: "#12131a",
    ink: "#f4f5f8",
    inkSub: "#d5d8e0",
    inkMuted: "#8f94a3",
    accentDefault: "#37e2c4",
    badgeBackground: "rgba(255, 255, 255, 0.12)",
    badgeInk: "#f4f5f8",
    fontTitle: gothicStack,
    fontBody: gothicStack,
    usesSurface: false,
    defaultDim: 0,
    surfaceLadder: ["#12131a", "#15161c", "#0b0c10"],
    inkScale: { ink: "#f4f5f8", body: "#d5d8e0", mute: "#8f94a3", faint: "#606777" },
    hairline: "rgba(255,255,255,0.14)",
    eyebrowStyle: "pill",
    titleTracking: 0,
    badgeRadius: "999px",
    bulletShape: "dot"
  }
];

export const defaultStyleId: StylePresetId = "newsprint";

export function findStylePreset(styleId: string | undefined): StylePreset {
  const preset = stylePresets.find((candidate) => candidate.id === styleId);
  return preset ?? stylePresets[0]!;
}

/** 내장 프리셋 + 커스텀 스타일 목록에서 해석한다. 커스텀 우선. */
export function resolveStylePreset(
  styleId: string | undefined,
  customStyles: readonly StylePreset[]
): StylePreset {
  const custom = customStyles.find((candidate) => candidate.id === styleId);
  return custom ?? findStylePreset(styleId);
}

export const accentSwatches: readonly string[] = [
  "#3557e8",
  "#7c5cff",
  "#e8447c",
  "#e0342c",
  "#f07c22",
  "#f2b705",
  "#1faa59",
  "#0fb5c9",
  "#123c3a",
  "#a53d2d"
];
