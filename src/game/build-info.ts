export interface BuildInfo {
  schemaVersion: 1;
  appVersion: string;
  buildId: string;
  sourceRevision: string | null;
  sourceRepository: string | null;
  sourceDirty: boolean;
  sourceFingerprint: string;
}

declare const __AEROFLOW_BUILD_INFO__: BuildInfo;

/** The same immutable identity is embedded in the app and emitted as version.json. */
export const BUILD_INFO: Readonly<BuildInfo> = Object.freeze(__AEROFLOW_BUILD_INFO__);
