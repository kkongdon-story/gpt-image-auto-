import { createHash } from "node:crypto";
import { EventEmitter } from "node:events";
import path from "node:path";
import { describe, expect, it, vi } from "vitest";
import { createVideoMediaProbe, parseFfprobeJson } from "./videoMediaProbe.js";

describe("parseFfprobeJson", () => {
  it("reads real duration, dimensions, and audio presence from ffprobe JSON", () => {
    const metadata = parseFfprobeJson(
      JSON.stringify({
        streams: [
          {
            codec_type: "video",
            codec_name: "h264",
            pix_fmt: "yuv420p",
            width: 1080,
            height: 1920,
            duration: "3.042000",
            avg_frame_rate: "30/1"
          },
          {
            codec_type: "audio",
            codec_name: "aac",
            duration: "3.000000"
          }
        ],
        format: {
          duration: "3.042000"
        }
      })
    );

    expect(metadata).toEqual({
      width: 1080,
      height: 1920,
      durationMs: 3042,
      hasAudio: true,
      videoCodec: "h264",
      audioCodec: "aac",
      frameRate: 30,
      pixelFormat: "yuv420p"
    });
  });

  it("rejects unsupported or corrupt ffprobe payloads without positive video metadata", () => {
    expect(parseFfprobeJson("not json")).toBeUndefined();
    expect(parseFfprobeJson(JSON.stringify({ streams: [{ codec_type: "audio" }] }))).toBeUndefined();
    expect(
      parseFfprobeJson(JSON.stringify({ streams: [{ codec_type: "video", width: 0, height: 1920 }] }))
    ).toBeUndefined();
  });
});

describe("createVideoMediaProbe", () => {
  it("validates the trusted packaged binary hashes before spawning", async () => {
    const spawn = vi.fn();
    const probe = createVideoMediaProbe({
      trustedResourcesRoot: "C:\\app\\resources",
      ffmpegProbe: {
        readFile: async (filePath) => {
          expect(filePath).toBe("C:\\app\\resources\\ffmpeg\\ffprobe.exe");
          return Buffer.from("not the pinned ffprobe binary");
        },
        run: async () => {
          throw new Error("unused");
        }
      },
      spawn,
      pathApi: path.win32
    });

    await expect(
      probe({
        sourcePath: "C:\\media\\clip.mp4",
        bytes: Buffer.from("video"),
        mimeType: "video/mp4"
      })
    ).rejects.toThrow("Bundled FFprobe hash does not match the trusted manifest");
    expect(spawn).not.toHaveBeenCalled();
  });

  it("returns trusted metadata and a generated JPEG poster frame", async () => {
    const ffprobeBytes = Buffer.from("trusted ffprobe");
    const ffmpegBytes = Buffer.from("trusted ffmpeg");
    const jpeg = Buffer.from([0xff, 0xd8, 0x01, 0x02, 0xff, 0xd9]);
    const spawn = vi.fn((filePath: string) => {
      const child = new EventEmitter() as EventEmitter & {
        stdout: EventEmitter;
        stderr: EventEmitter;
        kill: () => boolean;
      };
      child.stdout = new EventEmitter();
      child.stderr = new EventEmitter();
      child.kill = () => true;
      queueMicrotask(() => {
        if (filePath.endsWith("ffprobe.exe")) {
          child.stdout.emit(
            "data",
            JSON.stringify({
              streams: [
                {
                  codec_type: "video",
                  codec_name: "h264",
                  pix_fmt: "yuv420p",
                  width: 1080,
                  height: 1920,
                  avg_frame_rate: "30000/1000"
                },
                { codec_type: "audio", codec_name: "aac" }
              ],
              format: { duration: "4.2" }
            })
          );
        } else {
          child.stdout.emit("data", jpeg);
        }
        child.emit("exit", 0);
      });
      return child;
    });
    const probe = createVideoMediaProbe({
      trustedResourcesRoot: "C:\\app\\resources",
      ffmpegProbe: {
        readFile: async (filePath) => (filePath.endsWith("ffprobe.exe") ? ffprobeBytes : ffmpegBytes),
        run: async () => {
          throw new Error("unused");
        }
      },
      manifest: {
        executableRelativePath: "ffmpeg/ffmpeg.exe",
        sha256: sha256(ffmpegBytes),
        probeRelativePath: "ffmpeg/ffprobe.exe",
        probeSha256: sha256(ffprobeBytes)
      },
      spawn,
      pathApi: path.win32
    });

    await expect(
      probe({ sourcePath: "C:\\media\\clip.mp4", bytes: Buffer.from("video"), mimeType: "video/mp4" })
    ).resolves.toEqual({
      width: 1080,
      height: 1920,
      durationMs: 4200,
      hasAudio: true,
      videoCodec: "h264",
      audioCodec: "aac",
      frameRate: 30,
      pixelFormat: "yuv420p",
      posterBytes: jpeg,
      posterExtension: "jpg"
    });
    expect(spawn).toHaveBeenCalledTimes(2);
    expect(spawn.mock.calls[1]?.[1]).toContain("image2pipe");
  });
});

function sha256(bytes: Buffer): string {
  return createHash("sha256").update(bytes).digest("hex");
}
