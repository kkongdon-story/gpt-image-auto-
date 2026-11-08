import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("electron", () => ({
  protocol: {
    registerSchemesAsPrivileged: vi.fn(),
    handle: vi.fn()
  }
}));

import {
  CARDNEWS_MEDIA_SCHEME,
  createMediaAssetUrl,
  createMediaProtocolHandler,
  registerMediaProtocolScheme
} from "./mediaProtocol.js";
import { protocol } from "electron";

const tempRoots: string[] = [];

afterEach(async () => {
  await Promise.all(
    tempRoots.splice(0).map((root) => fs.rm(root, { recursive: true, force: true }))
  );
});

describe("cardnews-media protocol", () => {
  it("registers the scheme as secure and stream-capable", () => {
    registerMediaProtocolScheme();

    expect(protocol.registerSchemesAsPrivileged).toHaveBeenCalledWith([
      {
        scheme: CARDNEWS_MEDIA_SCHEME,
        privileges: {
          standard: true,
          secure: true,
          supportFetchAPI: true,
          stream: true
        }
      }
    ]);
  });

  it("creates an opaque asset URL without exposing a filesystem path", () => {
    const id = "video-0123456789abcdefabcd-1234abcd";
    const url = createMediaAssetUrl(id);

    expect(url).toBe(`${CARDNEWS_MEDIA_SCHEME}://asset/${id}`);
    expect(url).not.toContain("C:");
    expect(url).not.toContain("media/");
  });

  it("rejects paths, query strings, and unknown ids", async () => {
    const root = await createMediaFixture();
    const handler = createMediaProtocolHandler(() => root);

    expect((await handler(new Request("cardnews-media://asset/../../secret"))).status).toBe(400);
    expect(
      (await handler(new Request("cardnews-media://asset/video-0123456789abcdefabcd-1234abcd?path=C:%5Csecret"))).status
    ).toBe(400);
    expect(
      (await handler(new Request("cardnews-media://asset/video-ffffffffffffffffffff-deadbeef"))).status
    ).toBe(404);
  });

  it("streams a managed video with range support for seeking", async () => {
    const root = await createMediaFixture();
    const handler = createMediaProtocolHandler(() => root);
    const response = await handler(
      new Request(
        "cardnews-media://asset/video-0123456789abcdefabcd-1234abcd",
        { headers: { Range: "bytes=2-5" } }
      )
    );

    expect(response.status).toBe(206);
    expect(response.headers.get("Accept-Ranges")).toBe("bytes");
    expect(response.headers.get("Content-Range")).toBe("bytes 2-5/10");
    expect(response.headers.get("Content-Type")).toBe("video/mp4");
    expect(new Uint8Array(await response.arrayBuffer())).toEqual(
      new Uint8Array([2, 3, 4, 5])
    );
  });
});

async function createMediaFixture(): Promise<string> {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "cardnews-media-protocol-"));
  tempRoots.push(root);
  const mediaRoot = path.join(root, "media");
  await fs.mkdir(mediaRoot, { recursive: true });
  await fs.writeFile(
    path.join(mediaRoot, "video.bin"),
    new Uint8Array([0, 1, 2, 3, 4, 5, 6, 7, 8, 9])
  );
  await fs.writeFile(
    path.join(mediaRoot, "media-index.json"),
    JSON.stringify({
      version: 1,
      assets: [
        {
          id: "video-0123456789abcdefabcd-1234abcd",
          kind: "video",
          displayName: "fixture.mp4",
          relativePath: "video.bin",
          mimeType: "video/mp4",
          bytes: 10,
          sha256: "0".repeat(64),
          width: 1080,
          height: 1920,
          durationMs: 1000,
          hasAudio: false,
          importedAt: "2026-07-17T00:00:00.000Z"
        }
      ]
    }),
    "utf8"
  );
  return root;
}
