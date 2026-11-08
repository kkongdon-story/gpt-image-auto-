export type PaintFrameSource<TImage> = {
  readonly invalidate: () => void;
  readonly subscribe: (listener: (image: TImage) => void) => () => void;
};

export type PaintFrame<TImage> = {
  readonly image: TImage;
  readonly sequence: number;
};

type PendingFrame<TImage> = {
  afterSequence: number;
  framesRemaining: number;
  readonly reject: (error: Error) => void;
  readonly resolve: (frame: PaintFrame<TImage>) => void;
  timeout: ReturnType<typeof setTimeout> | undefined;
};

export class PaintFrameCollector<TImage> {
  private readonly pending = new Set<PendingFrame<TImage>>();
  private readonly source: PaintFrameSource<TImage>;
  private readonly unsubscribe: () => void;
  private disposed = false;
  private sequence = 0;

  constructor(source: PaintFrameSource<TImage>) {
    this.source = source;
    this.unsubscribe = source.subscribe((image) => {
      this.sequence += 1;
      const frame = { image, sequence: this.sequence };
      for (const waiter of [...this.pending]) {
        if (frame.sequence <= waiter.afterSequence) {
          continue;
        }
        waiter.afterSequence = frame.sequence;
        waiter.framesRemaining -= 1;
        if (waiter.framesRemaining > 0) {
          try {
            this.source.invalidate();
          } catch (error) {
            this.finish(waiter);
            waiter.reject(
              error instanceof Error
                ? error
                : new Error("Failed to invalidate the offscreen frame.")
            );
          }
          continue;
        }
        this.finish(waiter);
        waiter.resolve(frame);
      }
    });
  }

  captureInvalidatedFrame(timeoutMs: number): Promise<PaintFrame<TImage>> {
    if (this.disposed) {
      return Promise.reject(new Error("Paint frame collector is disposed."));
    }

    const afterSequence = this.sequence;
    return new Promise((resolve, reject) => {
      const waiter: PendingFrame<TImage> = {
        afterSequence,
        framesRemaining: 2,
        reject,
        resolve,
        timeout: undefined
      };
      waiter.timeout = setTimeout(() => {
        this.finish(waiter);
        reject(new Error("Timed out waiting for a post-readiness paint frame."));
      }, timeoutMs);
      this.pending.add(waiter);

      try {
        this.source.invalidate();
      } catch (error) {
        this.finish(waiter);
        reject(error instanceof Error ? error : new Error("Failed to invalidate the offscreen frame."));
      }
    });
  }

  dispose(): void {
    if (this.disposed) {
      return;
    }
    this.disposed = true;
    this.unsubscribe();
    for (const waiter of [...this.pending]) {
      this.finish(waiter);
      waiter.reject(new Error("Paint frame collector was disposed before capture completed."));
    }
  }

  private finish(waiter: PendingFrame<TImage>): void {
    if (waiter.timeout) {
      clearTimeout(waiter.timeout);
    }
    this.pending.delete(waiter);
  }
}
