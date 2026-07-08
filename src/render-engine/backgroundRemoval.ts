type Rgb = {
  readonly blue: number;
  readonly green: number;
  readonly red: number;
};

export function removeBackground(
  bitmap: Uint8Array,
  width: number,
  height: number,
  tolerance = 28
): Uint8Array {
  if (width < 1 || height < 1 || bitmap.length !== width * height * 4) {
    throw new Error("Invalid bitmap dimensions.");
  }

  const output = new Uint8Array(bitmap);
  const background = estimateCornerColor(bitmap, width, height);
  const marked = floodFillBackground(bitmap, width, height, background, Math.max(0, tolerance));

  for (let index = 0; index < marked.length; index += 1) {
    if (marked[index]) {
      output[index * 4 + 3] = 0;
    }
  }

  return output;
}

function estimateCornerColor(bitmap: Uint8Array, width: number, height: number): Rgb {
  const sampleRadius = Math.min(5, Math.max(1, Math.floor(Math.min(width, height) / 4)));
  let blue = 0;
  let green = 0;
  let red = 0;
  let count = 0;
  const origins = [
    { x: 0, y: 0 },
    { x: width - sampleRadius, y: 0 },
    { x: 0, y: height - sampleRadius },
    { x: width - sampleRadius, y: height - sampleRadius }
  ];

  for (const origin of origins) {
    for (let y = origin.y; y < origin.y + sampleRadius; y += 1) {
      for (let x = origin.x; x < origin.x + sampleRadius; x += 1) {
        const offset = pixelOffset(width, x, y);
        blue += bitmap[offset] ?? 0;
        green += bitmap[offset + 1] ?? 0;
        red += bitmap[offset + 2] ?? 0;
        count += 1;
      }
    }
  }

  return {
    blue: Math.round(blue / count),
    green: Math.round(green / count),
    red: Math.round(red / count)
  };
}

function floodFillBackground(
  bitmap: Uint8Array,
  width: number,
  height: number,
  background: Rgb,
  tolerance: number
): Uint8Array {
  const marked = new Uint8Array(width * height);
  const queue: number[] = [];

  function enqueue(x: number, y: number): void {
    if (x < 0 || y < 0 || x >= width || y >= height) {
      return;
    }
    const index = y * width + x;
    if (marked[index]) {
      return;
    }
    if (!isWithinTolerance(bitmap, width, x, y, background, tolerance)) {
      return;
    }
    marked[index] = 1;
    queue.push(index);
  }

  for (let x = 0; x < width; x += 1) {
    enqueue(x, 0);
    enqueue(x, height - 1);
  }
  for (let y = 1; y < height - 1; y += 1) {
    enqueue(0, y);
    enqueue(width - 1, y);
  }

  for (let cursor = 0; cursor < queue.length; cursor += 1) {
    const index = queue[cursor]!;
    const x = index % width;
    const y = Math.floor(index / width);
    enqueue(x + 1, y);
    enqueue(x - 1, y);
    enqueue(x, y + 1);
    enqueue(x, y - 1);
  }

  return marked;
}

function isWithinTolerance(
  bitmap: Uint8Array,
  width: number,
  x: number,
  y: number,
  background: Rgb,
  tolerance: number
): boolean {
  const offset = pixelOffset(width, x, y);
  const blueDelta = (bitmap[offset] ?? 0) - background.blue;
  const greenDelta = (bitmap[offset + 1] ?? 0) - background.green;
  const redDelta = (bitmap[offset + 2] ?? 0) - background.red;
  return Math.hypot(redDelta, greenDelta, blueDelta) <= tolerance;
}

function pixelOffset(width: number, x: number, y: number): number {
  return (y * width + x) * 4;
}
