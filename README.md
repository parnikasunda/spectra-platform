# Argus Anti-Piracy Intelligence & Evidence Platform

> Production-oriented Anti-Piracy Intelligence & Evidence Platform for VOD Media and Live Sports Streams with Perceptual Fingerprinting and Temporal Cross-Correlation.

---

## 1. Prerequisites

- **Node.js**: Version 22.x or higher (with built-in `node:sqlite` support)
- **FFmpeg & FFprobe**: Version 4.4+ (installed on Linux/macOS/Windows)
- **npm** or **pnpm** package manager

To verify installations:
```bash
node -v
ffmpeg -version
ffprobe -version
```

---

## 2. Environment Configuration

Copy the example environment configuration:
```bash
cp .env.example .env
```

Configurable parameters in `.env`:
```ini
PORT=3000
DATABASE_PATH="./data/argus.db"
MEDIA_STORAGE_PATH="./data/media"
FINGERPRINT_HAMMING_THRESHOLD=10
FINGERPRINT_SAMPLE_INTERVAL_SEC=2
```

---

## 3. Installation & Local Development

Install project dependencies:
```bash
npm install
```

Start the integrated full-stack development server:
```bash
npm run dev
```

The application will start on **http://localhost:3000** with:
- Full Express backend API mounted at `/api/*`
- SQLite database auto-initialized at `./data/argus.db`
- Vite React frontend served with high-performance HMR

---

## 4. Running the Automated Test Suite

Argus includes a test suite covering mathematical perceptual hashing, Hamming distance, sequence correlation, database CRUD operations, and edge-case handling:

```bash
npm test
```

Expected output:
```
======================================================
  ARGUS ANTI-PIRACY PLATFORM — COMPREHENSIVE TEST SUITE
======================================================

[Test Group 1] Perceptual Hashing & Hamming Metric Verification
  ✓ PASS: Identical hashes produce Hamming distance of 0
  ✓ PASS: Identical hashes produce 100% similarity
  ✓ PASS: Single-bit variation produces Hamming distance of 1
  ...
[Test Group 4] Database CRUD & Forensic Suite Verification
  ✓ PASS: Seeded 2 reference items successfully
  ✓ PASS: Seeded 4 candidate sources across edge cases
  ✓ PASS: DRM_PROTECTED stream edge case correctly recorded in database
  ✓ PASS: UNREACHABLE / 404 stream edge case correctly recorded in database
  ✓ PASS: Cryptographic SHA-256 custody seal is present
  ✓ PASS: Human review decision successfully recorded

======================================================
  TEST RESULTS: 32 PASSED, 0 FAILED
======================================================
```

---

## 5. End-to-End Workflow Demonstration

### Step 1: Initialize Database or Load Forensic Test Suite
- Open the application at `http://localhost:3000`.
- Click **"Forensic Test Suite"** in the top navigation bar.
- This immediately seeds authentic test assets into the SQLite database:
  - Reference 1: UEFA Champions League (Arsenal vs Bayern) with 8 frame fingerprints
  - Reference 2: "Apex Horizon" (2026 Feature Film) with 6 frame fingerprints
  - Candidate 1: Infringing live stream on `live2all.sx` (+16s broadcast delay, 96% match)
  - Candidate 2: DRM-protected stream on `stream-gate-01.cx` (flags `DRM_PROTECTED`, respects encryption)
  - Candidate 3: Expired stream on `buffstreams.sx` (flags `UNREACHABLE`, HTTP 404)
  - Candidate 4: Unrelated culinary video on `public-web.tv` (flags `NO_MATCH`)

### Step 2: Register a Custom Reference Video
- Navigate to **"Reference Library"** -> Click **"Register Reference"**.
- Choose **"Direct Video Upload"** to upload an MP4/WebM file, or **"Direct Stream URL"** to supply an HLS `.m3u8` playlist.
- The server executes FFmpeg to extract frames, calculate 64-bit dHash strings, and compute the SHA-256 provenance hash.
- Click **"Inspect Hashes"** to view the scrubbable frame timeline.

### Step 3: Launch Discovery Sweeps
- Navigate to **"Discovery Sweeps"** -> Click **"Launch Discovery Sweep"**.
- Select a provider: *Live Sports Indexer*, *Web Stream Inspector*, *IPTV Stream Prober*, or *Search API Crawler*.
- Specify search keywords and domain restrictions.
- The sweep runs, normalizes URLs, deduplicates records, and populates the Candidate Matrix.

### Step 4: Verify Candidate Sources
- Navigate to **"Candidate Matrix"**.
- Review discovered sources with reachability latency and HTTP codes.
- Click **"Verify & Match"** on any row to trigger real-time HTTP probing, HLS manifest parsing, frame extraction, and temporal correlation.
- Click the terminal icon on any candidate to inspect HTTP headers and inspection logs.

### Step 5: Forensic Keyframe Review & Legal Takedown
- Navigate to **"Evidence Vault"**.
- Inspect side-by-side keyframes: Reference Frame vs Candidate Frame with exact timestamps.
- View the Hamming distance meter and broadcast delay calculation.
- Complete the **Human Review** form: select *Confirm Infringement*, *Authorized Licensee*, or *False Positive*, sign with investigator credentials, and click **"Sign & Record Decision"**.
- Click **"Generate DMCA Notice"** to produce a formal statutory takedown package containing the SHA-256 custody seal, stream URLs, and legal affirmations.

---

## 6. Production Build & Deployment

To create an optimized production build:
```bash
npm run build
npm start
```
