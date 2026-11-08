# Third Party Notices

This application bundles third-party open source software and font assets.

## Runtime Dependencies

- Electron
- React
- React DOM

## Development and Build Dependencies

- TypeScript
- Vite
- Vitest
- Electron Builder
- Vite React plugin
- Node.js type packages
- React type packages

## Fonts

- Pretendard Variable (`fonts/PretendardVariable.woff2`)
  - Project: https://github.com/orioncactus/pretendard
  - License: SIL Open Font License, Version 1.1
  - Bundling note: the font is redistributed with this app as an application
    asset for deterministic Korean card rendering. Do not sell the font file by
    itself or relicense it separately from the OFL terms.

See `fonts/NOTICE.md` for the font-specific notice and license reference.

## M22 FFmpeg and FFprobe

The Windows packages bundle the static `ffmpeg.exe` and `ffprobe.exe` from the
BtbN `ffmpeg-master-latest-win64-lgpl` build dated 2026-07-15. Their SHA-256
checksums and provenance are pinned in `resources/ffmpeg/ffmpeg.manifest.json`.

The reviewed build reports no `--enable-gpl`, `--enable-nonfree`, or
`--enable-libx264` configuration and exposes the required Windows `h264_mf`
video encoder plus the native `aac` audio encoder. The upstream LGPL license is
bundled as `resources/ffmpeg/LICENSE.txt`.

- Binary releases: https://github.com/BtbN/FFmpeg-Builds/releases
- Build scripts and corresponding source instructions: https://github.com/BtbN/FFmpeg-Builds
- FFmpeg source: https://ffmpeg.org/releases/
