# Argus Anti-Piracy Intelligence & Evidence Platform
## Technical Architecture & Forensic Methodology Specification

---

## 1. System Mission & Core Distinction

Argus is an anti-piracy intelligence and digital evidence platform designed for high-value on-demand (VOD) media and live sports broadcasts.

A foundational principle of Argus is that **detection does not equate to infringement**:
1. Discovering a URL is merely an observation of a candidate pointer.
2. Intercepting an HLS playlist or web player confirms media accessibility, not piracy.
3. Automated perceptual fingerprint cross-correlation yields a statistical similarity confidence metric.
4. Only a licensed human investigator or rights-holder representative can issue a final legal enforcement finding.

---

## 2. Multi-Stage Pipeline Architecture

```
   ┌────────────────────────────────────────────────────────┐
   │       Stage A: Reference Content Registration          │
   │   - Video upload / direct master URL ingestion         │
   │   - Metadata extraction (codec, fps, duration)         │
   │   - 64-bit dHash / pHash frame fingerprint generation  │
   │   - SHA-256 ground-truth provenance seal               │
   └──────────────────────────┬─────────────────────────────┘
                              │
                              ▼
   ┌────────────────────────────────────────────────────────┐
   │           Stage B: Candidate Discovery                 │
   │   - Modular providers (Search, IPTV, Sports, Stream)   │
   │   - Domain & URL normalization / deduplication         │
   │   - Surveillance scope preservation                    │
   └──────────────────────────┬─────────────────────────────┘
                              │
                              ▼
   ┌────────────────────────────────────────────────────────┐
   │      Stage C: Verification & Media Acquisition         │
   │   - Network reachability probe (HTTP status, latency)   │
   │   - Content-Type & manifest validation (.m3u8, .mp4)   │
   │   - DRM detection & restriction respect (#EXT-X-KEY)   │
   │   - Graceful edge handling (404s, timeouts, dead links)│
   └──────────────────────────┬─────────────────────────────┘
                              │
                              ▼
   ┌────────────────────────────────────────────────────────┐
   │   Stage D: Perceptual Fingerprinting & Comparison      │
   │   - Downsampled 9x8 grayscale Difference Hash (dHash)  │
   │   - Hamming distance bit-level comparison (0-64 bits)  │
   │   - Temporal sequence alignment & sliding window delay │
   │   - Mathematical similarity & confidence calculation   │
   └──────────────────────────┬─────────────────────────────┘
                              │
                              ▼
   ┌────────────────────────────────────────────────────────┐
   │         Stage E: Digital Evidence & Governance         │
   │   - Side-by-side keyframe match viewer with timestamps │
   │   - SHA-256 chain of custody seal                      │
   │   - Human enforcement review audit trail               │
   │   - Statutory DMCA / Takedown Notice package generator │
   └────────────────────────────────────────────────────────┘
```

---

## 3. Perceptual Fingerprinting Methodology

### 3.1 64-bit Difference Hash (dHash) Algorithm
Rather than computing cryptographic hashes (like SHA-256 or MD5, where a single bit alteration completely changes the digest), perceptual hashing produces digests whose distance corresponds directly to visual difference:

1. **Grayscale Normalization**: Each sampled frame is converted to single-channel 8-bit luminance ($Y = 0.299R + 0.587G + 0.114B$).
2. **Spatial Downsampling**: The frame is rescaled to a $9 \times 8$ matrix (72 pixels).
3. **Relative Gradient Comparison**: For each of the 8 rows, the algorithm compares adjacent pixels:
   $$\text{bit}_{r, c} = \begin{cases} 1 & \text{if } P(r, c) > P(r, c+1) \\ 0 & \text{otherwise} \end{cases} \quad \text{for } 0 \le r < 8, \; 0 \le c < 8$$
4. **Digest Formulation**: The resulting 64 binary bits are encoded as a 16-character hexadecimal string.

### 3.2 Hamming Distance & Similarity Calculation
The distance between candidate hash $H_{\text{cand}}$ and reference hash $H_{\text{ref}}$ is measured using bitwise XOR:
$$D_{\text{Hamming}}(H_{\text{cand}}, H_{\text{ref}}) = \sum_{i=0}^{63} \left( H_{\text{cand}}[i] \oplus H_{\text{ref}}[i] \right)$$

$$\text{Similarity \%} = \left( 1 - \frac{D_{\text{Hamming}}}{64} \right) \times 100$$

- $D \le 5$: Identical content or high-bitrate re-encode ($\ge 92.2\%$ similarity)
- $D \le 12$: Strong match under moderate compression, scaling, or cropping ($\ge 81.3\%$ similarity)
- $D > 15$: Dissimilar content / non-infringing stream ($< 76.5\%$ similarity)

### 3.3 Temporal Sequence Cross-Correlation
Isolated single-frame matches can be spurious (e.g. blank black screens or static broadcaster logos). Argus performs sequence alignment across time:
1. Computes pairwise Hamming distances for all candidate and reference frame combinations.
2. Identifies temporal offset $\Delta t = t_{\text{cand}} - t_{\text{ref}}$.
3. Clusters matched keyframe pairs into coherent temporal delay bins.
4. In live sports streams, $\Delta t$ directly reveals the pirate feed's broadcast lag (typically $+10\text{s}$ to $+45\text{s}$).
5. Confidence score $C$ is mathematically derived:
   $$C = \text{baseSimilarity} \times \text{coverageRatio} \times \text{sequenceMultiplier}$$

---

## 4. Digital Chain of Custody & Evidence Architecture

Each verified match produces an immutable `evidence_records` row containing:
- Ground-truth reference metadata and rights holder identity
- Candidate source URL, resolved domain, and discovery provider
- Exact min and average Hamming distance
- Detected temporal delay offset in seconds
- Side-by-side keyframe match pairs (timestamps, preview thumbnails, dHash hex values)
- **SHA-256 Digital Custody Seal**: A cryptographic digest over the entire inspection vector, ensuring that evidence presented in legal proceedings cannot be retroactively manipulated.

---

## 5. Database Schema & Persistence

Stored locally via SQLite (`node:sqlite` `DatabaseSync` in `data/argus.db`):
- `reference_items`: Ground-truth asset records and SHA-256 file provenance
- `reference_fingerprints`: Timestamped 64-bit dHash values and keyframe previews
- `discovery_jobs`: Surveillance sweep logs, query parameters, candidate counts
- `candidates`: Discovered URLs with reachability status, HTTP codes, latency, and media types
- `candidate_fingerprints`: Extracted frame fingerprints from candidate streams
- `evidence_records`: Sealed forensic evidence packages with human review audit states
