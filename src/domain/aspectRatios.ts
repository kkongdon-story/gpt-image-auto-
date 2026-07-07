export type AspectRatioId = "4:5" | "1:1" | "16:9" | "4:3";

export type AspectRatio = {
  readonly id: AspectRatioId;
  readonly name: string;
  readonly width: number;
  readonly height: number;
};

export const aspectRatios: readonly AspectRatio[] = [
  { id: "4:5", name: "세로형 4:5 (인스타)", width: 1080, height: 1350 },
  { id: "1:1", name: "정방형 1:1", width: 1080, height: 1080 },
  { id: "16:9", name: "가로형 16:9", width: 1920, height: 1080 },
  { id: "4:3", name: "가로형 4:3", width: 1440, height: 1080 }
];

export const defaultAspectRatioId: AspectRatioId = "4:5";

export function findAspectRatio(aspectRatioId: string | undefined): AspectRatio {
  const ratio = aspectRatios.find((candidate) => candidate.id === aspectRatioId);
  return ratio ?? aspectRatios[0]!;
}
