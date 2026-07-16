/**
 * Minimal pngjs typings for the API surface the toolkit uses; pngjs ships no
 * types and @types/pngjs is not an installed dependency. This is the single
 * shared declaration — do not add per-module `declare module 'pngjs'` blocks.
 */
declare module 'pngjs' {
  export interface PNGOptions {
    width?: number;
    height?: number;
    fill?: boolean;
  }

  export class PNG {
    constructor(options?: PNGOptions);
    width: number;
    height: number;
    data: Buffer;
    static bitblt(
      src: PNG,
      dst: PNG,
      srcX: number,
      srcY: number,
      width: number,
      height: number,
      deltaX: number,
      deltaY: number,
    ): void;
    static sync: {
      read(buffer: Buffer): PNG;
      write(png: PNG): Buffer;
    };
  }
}
