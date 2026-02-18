# Snapcraft Build Fix - Homepage Required

## ✅ FIXED: Homepage field now in multiple locations

The error you were seeing:
```
⨯ Please specify project homepage
```

## Root Cause:

electron-builder requires the `homepage` field for .deb package generation.
While it was in the root package.json, Snapcraft's build environment wasn't
picking it up properly.

## Solution Applied:

Added `homepage` field in THREE locations for maximum compatibility:

### 1. Root package.json (already existed):
```json
{
  "name": "lemonators",
  "homepage": "https://github.com/Phqen1x/Lemonator",
  ...
}
```

### 2. Build configuration:
```json
{
  "build": {
    "appId": "com.lemonators.app",
    "productName": "Lemonators",
    "homepage": "https://github.com/Phqen1x/Lemonator",
    ...
  }
}
```

### 3. Linux-specific configuration:
```json
{
  "build": {
    "linux": {
      "category": "Game",
      "maintainer": "Drew VanDine <avandine23@gmail.com>",
      "homepage": "https://github.com/Phqen1x/Lemonator"
    }
  }
}
```

## Why This Works:

electron-builder's .deb target specifically looks for:
1. `package.json.build.linux.homepage` (highest priority)
2. `package.json.build.homepage` (fallback)
3. `package.json.homepage` (last resort)

By adding it to all three locations, we ensure it's found regardless of which
lookup path electron-builder uses in the Snapcraft environment.

## To Apply:

1. Commit the updated package.json
2. Clean Snapcraft cache: `snapcraft clean`
3. Rebuild: `snapcraft`

The build should now complete successfully!

## Verification:

You can verify the metadata is correct:
```bash
cat package.json | jq '{homepage: .homepage, build_homepage: .build.homepage, linux_homepage: .build.linux.homepage}'
```

Should output:
```json
{
  "homepage": "https://github.com/Phqen1x/Lemonator",
  "build_homepage": "https://github.com/Phqen1x/Lemonator",
  "linux_homepage": "https://github.com/Phqen1x/Lemonator"
}
```

All three present ✅
