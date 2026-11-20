# ADR-0010: Evaluation of SQLCipher and Storage Encryption at Rest

## Status
Accepted

## Context
The Smart AI Voice Agent persists guest reservations, room inventory, customer orders, tickets, and internal communications into an embedded SQLite database (`data/voice_agent.db`), and stores vector embeddings and chunk metadata in an embedded ChromaDB store (`data/chroma_db/chroma.sqlite3`). 

While session audit logs and memory telemetry are bounded in memory, persistent records in `data/voice_agent.db` contain guest PII (guest full names, reservation dates, room assignments, payment amounts). 

Issue **[SEC-10]** tracks evaluating options to protect these SQLite data stores against offline exfiltration in the event of host volume compromises, accidental backup exposure, or container escapes.

## Evaluated Alternatives

### 1. Application-Level SQLCipher (`sqlcipher3` / `pysqlcipher3`)
* **Mechanism**: Use SQLite extension packages that encrypt every page on disk using 256-bit AES, unlocking via `PRAGMA key = '...'`.
* **Pros**: Transparent page-level encryption inside the application process; only the database file itself is encrypted.
* **Cons**:
  * **Python 3.12 compatibility**: `sqlcipher3` packages on PyPI frequently fail to build or link cleanly on modern Python (3.12+) without dedicated C compilation environments (`libsqlcipher-dev`, OpenSSL).
  * **Cross-platform local dev**: Windows local development requires Visual Studio C++ build tools and compiled OpenSSL, introducing high friction for local contributors.
  * **ChromaDB friction**: ChromaDB (`chromadb.PersistentClient`) manages its own internal SQLite connection pool and does not provide an external API to supply `PRAGMA key`. Running ChromaDB on SQLCipher requires globally monkeypatching `sys.modules['sqlite3']`.
  * **Latency budget**: Encrypting and decrypting database pages adds a slight compute overhead during tool dispatch, though small (~1-3ms) for current workloads.

### 2. Volume-Level & Host-Level Transparent Encryption (LUKS / dm-crypt / Cloud Encrypted Disks)
* **Mechanism**: Encrypt the underlying host disk or Docker named volume mount (`/app/data`) using Linux kernel dm-crypt/LUKS, encrypted Docker volume drivers, or cloud provider storage encryption (AWS EBS encryption with KMS, GCP Persistent Disk encryption).
* **Pros**:
  * **Zero Python code modifications**: Standard `sqlite3` and `chromadb` continue operating at native speed with zero dependency bloat or build hurdles.
  * **Protects all persistent assets**: Simultaneously encrypts `data/voice_agent.db`, `data/chroma_db/chroma.sqlite3`, uploaded document backups, and any future persistent stores.
  * **Near-zero latency overhead**: Hardware-accelerated AES-NI CPU instructions handle volume I/O at disk controller speed, well within the sub-100ms voice pipeline budget.
  * **Enterprise compliance**: Standard practice for PCI-DSS and SOC 2 storage-at-rest requirements.
* **Cons**:
  * Requires operational configuration on the deployment host rather than being self-contained in a standalone `.db` file.

## Decision: Hybrid Strategy

1. **Application Layer (`HotelStore`)**:
   * Add optional `DB_ENCRYPTION_KEY` support in `AppSettings` and `HotelStore`.
   * When `DB_ENCRYPTION_KEY` is supplied, `HotelStore` attempts to apply `PRAGMA key` and verifies `PRAGMA cipher_version`. If a cipher driver is missing, it raises `DatabaseEncryptionError` rather than silently operating in unencrypted plaintext.
2. **Production Deployment Standard**:
   * Mandate **volume-level / host-level storage encryption** for the `/app/data` volume in production environments.
   * Emit a startup warning if `ENVIRONMENT=production` and `DB_ENCRYPTION_KEY` is unset to remind operators to verify encrypted volume backing.
3. **ChromaDB**:
   * Rely on host/volume-level storage encryption for ChromaDB rather than fragile monkeypatching of Chroma internals.

## Consequences
* Existing development setups and automated test suites continue running with zero friction or external C dependencies.
* Production systems can choose between container-level SQLCipher (when custom-compiled) and enterprise volume encryption.
* Security operations have clear migration and operational procedures documented in `docs/encrypted-sqlite-migration.md`.
