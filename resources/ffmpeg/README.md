# FFmpeg Resource Contract

M22 packages a reviewed BtbN Windows LGPL build of FFmpeg. The release is
fully pinned by SHA-256 in `ffmpeg.manifest.json`; the app never falls back to
an executable found on the system `PATH`.

## Required Binary Placement

The reviewed binaries are placed at:

```text
resources/ffmpeg/ffmpeg.exe
resources/ffmpeg/ffprobe.exe
```

`ffmpeg.manifest.json` contains both exact hashes, the upstream version, and
download provenance. Do not replace either binary without reviewing the build
configuration and updating both hashes.

## Required Preflight

The release preflight must run the supplied executable without a shell and check:

```text
ffmpeg.exe -hide_banner -version
ffmpeg.exe -hide_banner -buildconf
ffmpeg.exe -hide_banner -encoders
```

The approved Windows video path requires:

- `h264_mf` video encoder
- `aac` audio encoder
- no forbidden build configuration or linked codec token:
  - `--enable-gpl`
  - `--enable-nonfree`
  - `--enable-libx264`

If the executable is absent, the smoke script must fail before export and tell
the operator to supply a reviewed binary and manifest. It must not silently use a
system FFmpeg from `PATH`.

## Source and Build References

- Reviewed binary releases: https://github.com/BtbN/FFmpeg-Builds/releases
- Build repository and scripts: https://github.com/BtbN/FFmpeg-Builds
- FFmpeg source: https://ffmpeg.org/releases/

Release documentation must retain enough source/build information for LGPL
compliance and security review. The final binary manifest is the trust boundary;
the app must reject unpinned or drifted executables.
