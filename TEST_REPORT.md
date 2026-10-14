# Argus Platform — Automated Test Report & Verification Matrix

---

## 1. Test Execution Summary

- **Total Test Cases**: 32
- **Passed**: 32
- **Failed**: 0
- **Execution Time**: ~420ms
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
