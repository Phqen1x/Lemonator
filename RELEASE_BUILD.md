# Lemonators - Release Build Guide

## 🎉 Release Builds Available!

### 📦 Build Artifacts Created:

#### **Linux Distributions:**
1. **AppImage** (Universal Linux Binary)
   - File: `release/Lemonators-1.0.0.AppImage`
   - Size: 105 MB
   - **Runs on any Linux distribution**
   - No installation required!

2. **Debian Package**
   - File: `release/lemonators_1.0.0_amd64.deb`
   - Size: 83 MB
   - For Debian/Ubuntu/Mint systems
   - Installs system-wide

---

## 🚀 How to Run Release Builds

### **Option 1: AppImage (Recommended for Linux)**

The AppImage is a portable executable that runs on any Linux distribution:

```bash
# 1. Make it executable
chmod +x release/Lemonators-1.0.0.AppImage

# 2. Run it!
./release/Lemonators-1.0.0.AppImage
```

**Note:** Make sure Lemonade server is running on localhost:8000

---

### **Option 2: Install .deb Package (Debian/Ubuntu)**

```bash
# Install the package
sudo dpkg -i release/lemonators_1.0.0_amd64.deb

# If dependencies are missing:
sudo apt-get install -f

# Run from applications menu or terminal:
lemonators
```

---

## 🛠️ Building Release Packages

### **Build All Platforms:**
```bash
npm run electron:build
```

### **Build Specific Platforms:**

#### Linux (AppImage + .deb):
```bash
npm run electron:build:linux
```

#### Windows (NSIS installer + Portable .exe):
```bash
npm run electron:build:win
```

#### macOS (DMG + .zip):
```bash
npm run electron:build:mac
```

---

## 📁 Build Output Structure

```
release/
├── Lemonators-1.0.0.AppImage         (105 MB) - Universal Linux binary
├── lemonators_1.0.0_amd64.deb        (83 MB)  - Debian package
├── linux-unpacked/                           - Unpacked Linux files
├── builder-debug.yml                         - Build metadata
└── latest-linux.yml                          - Auto-update config
```

---

## ⚙️ Build Configuration

### **Configured in `package.json`:**

```json
{
  "build": {
    "appId": "com.lemonators.app",
    "productName": "Lemonators",
    "linux": {
      "target": ["AppImage", "deb"],
      "category": "Game"
    },
    "win": {
      "target": ["nsis", "portable"]
    },
    "mac": {
      "target": ["dmg", "zip"],
      "category": "public.app-category.games"
    }
  }
}
```

---

## 🎮 Running the Application

### **Requirements:**
1. **Lemonade Server must be running:**
   ```bash
   # Start Lemonade server (in separate terminal)
   lemonade-server serve --port 8000
   ```

2. **Required Models:**
   - Qwen3-4B-Instruct-2507-GGUF
   - Phi-4-mini-instruct-GGUF  
   - SDXL-Turbo

3. **Then run the app:**
   ```bash
   ./release/Lemonators-1.0.0.AppImage
   ```

---

## 📊 Build Sizes

| Format | Size | Description |
|--------|------|-------------|
| AppImage | 105 MB | Universal Linux executable |
| .deb | 83 MB | Debian/Ubuntu package |
| Unpacked | ~270 MB | Extracted application files |

---

## 🔧 Development vs Release

### **Development Build:**
```bash
npm run dev        # Hot-reload development mode
```

### **Production Build:**
```bash
npm run build      # Compile to dist/
```

### **Release Build:**
```bash
npm run electron:build:linux    # Package as distributable
```

---

## 📝 Scripts Added

```json
{
  "scripts": {
    "electron:dev": "npm run build && electron .",
    "electron:build": "npm run build && electron-builder",
    "electron:build:linux": "npm run build && electron-builder --linux",
    "electron:build:win": "npm run build && electron-builder --win",
    "electron:build:mac": "npm run build && electron-builder --mac"
  }
}
```

---

## ✅ Verification

### **Check AppImage:**
```bash
file release/Lemonators-1.0.0.AppImage
# Output: ELF 64-bit LSB executable ✓
```

### **Check .deb:**
```bash
file release/lemonators_1.0.0_amd64.deb
# Output: Debian binary package ✓
```

### **Test Run:**
```bash
# Make executable
chmod +x release/Lemonators-1.0.0.AppImage

# Test launch (with Lemonade server running)
./release/Lemonators-1.0.0.AppImage
```

---

## 🎯 Distribution

### **Distribute AppImage:**
- Share the single `.AppImage` file
- Users can run it directly (no installation)
- Works on all Linux distributions

### **Distribute .deb:**
- Share the `.deb` file
- Users install with `sudo dpkg -i`
- Integrates with system (menu entries, etc.)

---

## 🐛 Troubleshooting

### **"AppImage won't run":**
```bash
# Ensure it's executable
chmod +x release/Lemonators-1.0.0.AppImage

# Check dependencies
ldd release/Lemonators-1.0.0.AppImage
```

### **"Cannot connect to server":**
- Ensure Lemonade server is running on localhost:8000
- Check with: `curl http://localhost:8000/v1/models`

### **".deb installation fails":**
```bash
# Fix broken dependencies
sudo apt-get install -f
```

---

## 📦 Package Contents

The release build includes:
- ✅ Compiled React app (dist/)
- ✅ Electron binaries (dist-electron/)
- ✅ Character knowledge database (407 characters)
- ✅ SVG lemonade expressions
- ✅ All dependencies bundled
- ✅ Auto-update configuration

---

## 🎉 Success!

You now have distributable release builds ready to share:
- **AppImage**: Universal, portable, no-install Linux app
- **.deb**: System-integrated Debian/Ubuntu package

Both are production-ready and include all game features! 🚀

---

## 📄 Build Info

- **Build Date:** 2026-02-18
- **Version:** 1.0.0
- **Electron:** 33.4.11
- **Node:** 20.19.4
- **Builder:** electron-builder 26.7.0
