# SQLite Storage at Rest & Encryption Migration Guide

This guide describes how to configure, migrate, and maintain encrypted SQLite storage for the Smart AI Voice Agent.

---

## 1. Overview of Encryption Options

The Smart AI Voice Agent supports two operational tiers for encryption at rest:

1. **Volume-Level Encryption (Recommended for Production)**:
   * Protects both `data/voice_agent.db` and `data/chroma_db/chroma.sqlite3`.
   * Transparent to Python runtime, requires no native C dependencies, and leverages CPU AES-NI acceleration.
2. **SQLCipher Application-Level Encryption**:
   * Uses 256-bit AES page encryption directly within the SQLite file for `voice_agent.db`.
   * Activated when `DB_ENCRYPTION_KEY` is supplied and `sqlcipher3` is installed.
   * `Dockerfile.backend` installs `sqlcipher3` (statically linked wheels) and fails
     the build if `PRAGMA cipher_version` fails, so the standard image supports
     `DB_ENCRYPTION_KEY`. A custom image without the driver raises
     `DatabaseEncryptionError` at startup instead of running in plaintext; install
     `sqlcipher3` there, or use volume-level encryption.

---

## 2. Setting Up Volume-Level Encryption (Production)

### Option A: Cloud-Managed Block Storage (AWS / GCP / Azure)
Ensure that the volume backing the Docker host or mount directory (`/app/data`) has encryption enabled at the cloud provider level:
* **AWS ECS / EC2**: Enable AWS EBS volume encryption using AWS KMS keys.
* **GCP GKE / Compute Engine**: Enable Customer-Managed Encryption Keys (CMEK) on persistent disks.

### Option B: Linux Host dm-crypt / LUKS
To back the `/app/data` volume with a local encrypted filesystem on Linux:

```bash
# 1. Create a loopback or dedicated partition
dd if=/dev/zero of=/var/lib/smart_voice_data.img bs=1M count=2048

# 2. Format with LUKS
cryptsetup luksFormat /var/lib/smart_voice_data.img

# 3. Open the encrypted device
cryptsetup open /var/lib/smart_voice_data.img voice_data_crypt

# 4. Create filesystem and mount
mkfs.ext4 /dev/mapper/voice_data_crypt
mkdir -p /mnt/voice_encrypted_data
mount /dev/mapper/voice_data_crypt /mnt/voice_encrypted_data

# 5. Bind mount into docker-compose
# In docker-compose.yml:
# volumes:
#   - /mnt/voice_encrypted_data:/app/data
```

---

## 3. SQLCipher Migration Procedure

If you adopt SQLCipher for `voice_agent.db`:

### Step 1: Export Unencrypted SQLite Data
```bash
sqlite3 data/voice_agent.db ".dump" > /tmp/voice_agent_unencrypted.sql
```

### Step 2: Import into a SQLCipher-Encrypted Database
Using the `sqlcipher` command-line utility:

```bash
sqlcipher data/voice_agent_encrypted.db <<EOF
PRAGMA key = 'YOUR_PASSPHRASE_OR_HEX_KEY';
PRAGMA cipher_compatibility = 4;
.read /tmp/voice_agent_unencrypted.sql
EOF
```

### Step 3: Securely Erase Plaintext Dump
```bash
shred -u /tmp/voice_agent_unencrypted.sql
```

### Step 4: Configure the Application
In your `.env` or production secrets manager:

```env
DB_ENCRYPTION_KEY=YOUR_PASSPHRASE_OR_HEX_KEY
DATABASE_URL=sqlite:///./data/voice_agent_encrypted.db
```

---

## 4. Key Management Best Practices

1. **Never commit encryption keys**: Do not write keys to version control or hardcode in repository files.
2. **Use Docker Secrets or KMS**: In production container orchestration (Docker Swarm, Kubernetes), inject `DB_ENCRYPTION_KEY` via container secrets rather than raw environment variables.
3. **Key Rotation**:
   To re-encrypt an existing SQLCipher database with a new key:
   ```sql
   PRAGMA key = 'OLD_KEY';
   PRAGMA rekey = 'NEW_KEY';
   ```

---

## 5. Backup & Restore Procedures

### Backup
1. **Volume snapshots**: Take cloud snapshot of the encrypted block device (snapshots inherit encryption).
2. **SQLCipher backup**:
   Using SQLCipher vacuum into an encrypted backup:
   ```sql
   PRAGMA key = 'YOUR_KEY';
   VACUUM INTO 'data/backup_voice_agent.db';
   ```

### Restore
1. Verify the integrity of the backup copy:
   ```bash
   sqlcipher data/backup_voice_agent.db "PRAGMA key='YOUR_KEY'; SELECT count(*) FROM rooms;"
   ```
2. Replace the target database file and restart the service.
