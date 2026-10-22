# Argus Platform — Automated Test Report & Verification Matrix

---

## 1. Test Execution Summary

- **Total Test Cases**: 59
- **Passed**: 59
- **Failed**: 0
- **Test Runner**: Node.js 22 with `tsx` (`src/backend/tests/run_tests.ts`)

---

## 2. Test Coverage by Domain

### Test Group 1: Perceptual Hashing & Hamming Distance Calculation
| Test Case | Description | Expected | Result |
| :--- | :--- | :--- | :--- |
| 1.1 | Identical 64-bit Hex Hashes | Distance = 0, Similarity = 100% | PASS |
| 1.2 | Single-bit Mutation | Distance = 1, Similarity = 98.44% | PASS |
| 1.3 | Maximum Inverse Hashes (`0x000...` vs `0xfff...`) | Distance = 64, Similarity = 0% | PASS |
| 1.4 | Grayscale 9x8 Raw Buffer Processing | 16-hex char digest with luminance | PASS |

### Test Group 2: Temporal Sequence Cross-Correlation & Alignment
| Test Case | Description | Expected | Result |
| :--- | :--- | :--- | :--- |
| 2.1 | Delayed Stream Sequence Matching | Match status = `POTENTIAL_MATCH` | PASS |
| 2.2 | Broadcast Delay Quantification | Accurately identifies +10.0s offset | PASS |
| 2.3 | Clustered Minimum Distance | Identifies min distance = 0 bits | PASS |
| 2.4 | Mathematical Confidence Metric | Assigns confidence > 0.80 | PASS |
| 2.5 | Non-infringing / Random Streams | Rejects with `NO_MATCH`, confidence = 0.0 | PASS |

### Test Group 3: Canonical URL Normalization & Deduplication
| Test Case | Description | Expected | Result |
| :--- | :--- | :--- | :--- |
| 3.1 | Domain Extraction & Lowercasing | Normalizes `STREAM-hd.TV` to `stream-hd.tv` | PASS |
| 3.2 | Tracking Parameter Stripping | Removes `utm_source`, `ref`, and `fbclid` | PASS |

### Test Group 4: Database CRUD, Integrity, & Forensic Fixtures
| Test Case | Description | Expected | Result |
| :--- | :--- | :--- | :--- |
| 4.1 | Reference Ground Truth Seeding | Inserts reference items with metadata | PASS |
| 4.2 | Candidate Inventory Seeding | Inserts candidates across edge cases | PASS |
| 4.3 | DRM Protection Edge Case | Records `DRM_PROTECTED` status without bypass | PASS |
| 4.4 | Unreachable / 404 Edge Case | Records `UNREACHABLE` on HTTP 404 response | PASS |
| 4.5 | Evidence Record Persistence | Stores matched pairs with thumbnails | PASS |
| 4.6 | SHA-256 Custody Seal Generation | Generates cryptographic chain of custody | PASS |
| 4.7 | Human Review State Transition | Transitions to `CONFIRMED_INFRINGEMENT` | PASS |
| 4.8 | Reviewer Attribution Audit Trail | Preserves investigator identity in DB | PASS |
| 4.9 | Computed System Statistics | Computes accurate DB counts without mocks | PASS |

### Test Group 5: Multi-Source Adapter Dispatch & DRM Compliance
| Test Case | Description | Expected | Result |
| :--- | :--- | :--- | :--- |
| 5.1 | AdapterRegistry Registration | Registers all 5 modular source adapters | PASS |
| 5.2 | YouTube URL Resolution | Resolves `YouTubeAdapter` for youtube.com watch URLs | PASS |
| 5.3 | Netflix URL Resolution | Resolves `StreamingServicesAdapter` for netflix.com URLs | PASS |
| 5.4 | Hotstar URL Resolution | Resolves `StreamingServicesAdapter` for hotstar.com URLs | PASS |
| 5.5 | Piracy Mirror Resolution | Resolves `SuspectedPiracyAdapter` for soap2day / embed domains | PASS |
| 5.6 | Public Archive Resolution | Resolves `PublicVideoPlatformsAdapter` for archive.org | PASS |
| 5.7 | Arbitrary Website Fallback | Resolves `WebCrawlerAdapter` for arbitrary public websites | PASS |
| 5.8 | Netflix DRM Probe Compliance | Flags `DRM_PROTECTED` (Widevine Modular) and refuses bypass | PASS |
| 5.9 | Cloudflare Turnstile Detection | Flags `BLOCKED` with HTTP 403 status | PASS |
| 5.10 | Direct HLS Manifest Acquisition | Acquires unencrypted `.m3u8` stream as `HLS_M3U8` | PASS |

### Test Group 6: Universal Multi-Source Discovery & Statutory Takedowns
| Test Case | Description | Expected | Result |
| :--- | :--- | :--- | :--- |
| 6.1 | Multi-Source Candidate Volume | Discovers 28 genuine candidate URLs across providers | PASS |
| 6.2 | Category Coverage | Includes YouTube, Streaming Services, Piracy/Embeds, Public Platforms | PASS |
| 6.3 | Canonical Deduplication | Guarantees all discovered URLs are unique | PASS |
| 6.4 | Asset Kind Classification | Distinguishes `DISCOVERED_PAGE` from `VERIFIED_VIDEO_ASSET` | PASS |
| 6.5 | Statutory DMCA Notice Generation | Includes 17 U.S.C. § 512(c)(3) header, SHA-256 seal, and perjury clause | PASS |

---

## 3. How to Execute Tests Locally

Run the test suite using npm:
```bash
npm test
```

Or execute directly with tsx:
```bash
npx tsx src/backend/tests/run_tests.ts
```
