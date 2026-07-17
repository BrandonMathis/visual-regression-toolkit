import type {
  BaselineManifest,
  ScreenshotDescriptor,
} from "../contracts/types.js";
const brand = Symbol("VerifiedBaseline");
export type VerifiedBaseline = {
  readonly manifest: BaselineManifest;
  readonly index: ReadonlyMap<string, ScreenshotDescriptor>;
  readonly root: string;
  readonly [brand]: true;
};
export function makeVerifiedBaseline(
  manifest: BaselineManifest,
  index: Map<string, ScreenshotDescriptor>,
  root: string,
): VerifiedBaseline {
  return { manifest, index, root, [brand]: true };
}
export const pairKey = (route: string, project: string): string =>
  `${project}\0${route}`;
