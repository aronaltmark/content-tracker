---
description: Build the app for this computer and open it
---
Build the app for this computer and open it, to try it as someone would use it.

1. **Build it**: `npm run dist`, in a shell without `ELECTRON_RUN_AS_NODE` (editors set it, and it stops Electron being Electron). On a Mac with no signing identity set `CSC_IDENTITY_AUTO_DISCOVERY=false`.
2. **Open it**: from `release/` (`release/mac-arm64/Content Tracker.app`, or `release/win-unpacked/Content Tracker.exe`). It uses the real settings of the app on this computer, so anything run in it goes to the real tracker.
3. **Say what's in it** that isn't committed, if anything.
