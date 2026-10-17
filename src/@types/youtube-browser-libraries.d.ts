// These packages expose ESM subpaths without typesVersions. Keep the Web app's
// existing TypeScript 4.9/node resolution and use the packages' real declarations.
declare module 'googlevideo/sabr-stream' {
  export { SabrStream } from 'googlevideo/dist/src/core/SabrStream';
}

declare module 'googlevideo/protos' {
  export { VideoPlaybackAbrRequest } from 'googlevideo/dist/protos/generated/video_streaming/video_playback_abr_request';
}

declare module 'googlevideo/utils' {
  export { buildSabrFormat, EnabledTrackTypes, u8ToBase64 } from 'googlevideo/dist/src/utils/shared';
  export { Logger, LogLevel } from 'googlevideo/dist/src/utils/Logger';
}
