import { createHash } from "node:crypto";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  type FfmpegManifest,
  parseFfmpegEncoders,
  preflightFfmpeg,
  validateFfmpegManifest
} from "./ffmpegPreflight.js";

const ffmpegBytes = Buffer.from("trusted ffmpeg bytes");
const trustedSha = createHash("sha256").update(ffmpegBytes).digest("hex");

describe("validateFfmpegManifest", () => {
  it("requires relative trusted path, pinned hash, LGPL notice, source offer, h264_mf, and AAC", () => {
    expect(validateFfmpegManifest(manifest())).toMatchObject({ ok: true });
    expect(validateFfmpegManifest(manifest({ executableRelativePath: "..\\ffmpeg.exe" }))).toMatchObject({
      ok: false,
      code: "invalid_manifest"
    });
    expect(validateFfmpegManifest(manifest({ sha256: "bad" }))).toMatchObject({
      ok: false,
      code: "invalid_manifest"
    });
    expect(validateFfmpegManifest(manifest({ requiredEncoders: ["aac"] }))).toMatchObject({
      ok: false,
      code: "invalid_manifest"
    });
    expect(validateFfmpegManifest(manifest({ licenseNotice: "uses --enable-libx264" }))).toMatchObject({
      ok: false,
      code: "invalid_manifest"
    });
    expect(validateFfmpegManifest(manifest({ probeRelativePath: "..\\ffprobe.exe", probeSha256: trustedSha }))).toMatchObject({
      ok: false,
      code: "invalid_manifest"
    });
  });
});

describe("preflightFfmpeg", () => {
  it("checks hash/version/buildconf/encoders using argv arrays only", async () => {
    const calls: readonly string[][] = [];
    const mutableCalls: string[][] = [];
    const result = await preflightFfmpeg({
      trustedResourcesRoot: "C:\\app\\resources",
      manifest: manifest(),
      probe: {
        readFile: async () => ffmpegBytes,
        run: async (_filePath, args) => {
          mutableCalls.push([...args]);
          if (args.includes("-version")) {
            return { stdout: "ffmpeg version 7.1-lgpl", stderr: "" };
          }
          if (args.includes("-buildconf")) {
            return { stdout: "--enable-shared --disable-gpl", stderr: "" };
          }
          return { stdout: " V..... h264_mf\n A..... aac", stderr: "" };
        }
      }
    });

    calls.concat(mutableCalls);
    expect(result).toMatchObject({ ok: true, encoders: ["aac", "h264_mf"] });
    expect(mutableCalls).toEqual([
      ["-hide_banner", "-version"],
      ["-hide_banner", "-buildconf"],
      ["-hide_banner", "-encoders"]
    ]);
  });

  it("rejects GPL, nonfree, libx264, missing Media Foundation, and AAC gaps", async () => {
    await expect(preflightWith({ buildconf: "--enable-gpl" })).resolves.toMatchObject({
      ok: false,
      code: "forbidden_build"
    });
    await expect(preflightWith({ buildconf: "--enable-nonfree" })).resolves.toMatchObject({
      ok: false,
      code: "forbidden_build"
    });
    await expect(preflightWith({ buildconf: "--enable-libx264" })).resolves.toMatchObject({
      ok: false,
      code: "forbidden_build"
    });
    await expect(preflightWith({ encoders: " A..... aac" })).resolves.toMatchObject({
      ok: false,
      code: "missing_h264_mf",
      message: expect.stringContaining("Windows N")
    });
    await expect(preflightWith({ encoders: " V..... h264_mf" })).resolves.toMatchObject({
      ok: false,
      code: "missing_aac"
    });
  });
});

describe("parseFfmpegEncoders", () => {
  it("extracts encoder names from ffmpeg -encoders output", () => {
    expect(parseFfmpegEncoders(" V..... h264_mf\n A..... aac\n ------ not_encoder")).toEqual([
      "aac",
      "h264_mf"
    ]);
  });
});

function manifest(overrides: Partial<FfmpegManifest> = {}): FfmpegManifest {
  return {
    executableRelativePath: "ffmpeg\\ffmpeg.exe",
    sha256: trustedSha,
    versionPattern: "^ffmpeg version 7\\.1-lgpl",
    requiredEncoders: ["h264_mf", "aac"],
    forbiddenBuildConfigurationTokens: ["--enable-gpl", "--enable-nonfree", "--enable-libx264"],
    licenseNotice: "LGPL FFmpeg build with dynamic libraries.",
    sourceOfferUrl: "https://ffmpeg.org/releases/",
    ...overrides
  };
}

async function preflightWith(options: { readonly buildconf?: string; readonly encoders?: string }) {
  return preflightFfmpeg({
    trustedResourcesRoot: "C:\\app\\resources",
    manifest: manifest(),
    pathApi: path.win32,
    probe: {
      readFile: async () => ffmpegBytes,
      run: async (_filePath, args) => {
        if (args.includes("-version")) {
          return { stdout: "ffmpeg version 7.1-lgpl", stderr: "" };
        }
        if (args.includes("-buildconf")) {
          return { stdout: options.buildconf ?? "--enable-shared --disable-gpl", stderr: "" };
        }
        return { stdout: options.encoders ?? " V..... h264_mf\n A..... aac", stderr: "" };
      }
    }
  });
}
