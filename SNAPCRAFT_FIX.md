# Snapcraft Build Fix - Missing Homepage

## Error You're Seeing:
```
⨯ Please specify project homepage
```

## ✅ Solution:

Your `package.json` already has the homepage field, but Snapcraft might be using a cached or stale build.

### **Quick Fix:**

1. **Clean Snapcraft build cache:**
```bash
snapcraft clean
```

2. **Verify package.json has all required fields:**
```json
{
  "name": "lemonators",
  "version": "1.0.0",
  "description": "Lemonator — AI guesses your character while drawing them",
  "homepage": "https://github.com/Phqen1x/Lemonator",
  "license": "MIT",
  "bugs": {
    "url": "https://github.com/Phqen1x/Lemonator/issues"
  },
  "author": {
    "name": "Drew VanDine",
    "email": "avandine23@gmail.com"
  }
}
```

3. **Rebuild:**
```bash
snapcraft
```

---

## Alternative: Add to snapcraft.yaml

If the issue persists, you can override in `snapcraft.yaml`:

```yaml
name: lemonators
version: '1.0.0'
summary: AI guesses your character
description: |
  Lemonators is an AI-powered character guessing game
  that uses machine learning to guess who you're thinking of.
website: https://github.com/Phqen1x/Lemonator
issues: https://github.com/Phqen1x/Lemonator/issues
source-code: https://github.com/Phqen1x/Lemonator

parts:
  lemonator:
    plugin: npm
    npm-node-version: "20.19.4"
    source: .
    build-packages:
      - node-gyp
    override-build: |
      npm install
      npm run build
      npm run electron:build:linux --linux deb
```

---

## Snapcraft Environment Variables

You can also set environment variables:

```yaml
parts:
  lemonator:
    plugin: npm
    source: .
    build-environment:
      - npm_config_package_homepage: "https://github.com/Phqen1x/Lemonator"
```

---

## Verify Before Build:

```bash
# Check package.json has homepage
grep homepage package.json

# Should output:
# "homepage": "https://github.com/Phqen1x/Lemonator",
```

---

## If Still Failing:

The error path shows:
```
/root/parts/lemonator/build
```

This means Snapcraft is copying files to its build directory. Make sure:

1. ✅ `package.json` is committed to git
2. ✅ No `.gitignore` is excluding it
3. ✅ Snapcraft is copying the correct files

Check your `snapcraft.yaml` source configuration:

```yaml
source: .  # Current directory
# OR
source: https://github.com/Phqen1x/Lemonator.git
source-type: git
```

---

## Final Solution:

Since your local `package.json` already has all required fields, the issue is likely:

**Snapcraft is using an old cached version.**

**Fix:**
```bash
# Clean everything
snapcraft clean

# Delete build artifacts
rm -rf parts/ stage/ prime/

# Rebuild from scratch
snapcraft
```

This should pick up your updated `package.json` with the homepage field.
