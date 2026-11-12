"""SQLite persistence for knowledge document metadata and persona assignments."""

from __future__ import annotations

import json
import logging
import sqlite3
from collections.abc import Generator
from contextlib import contextmanager
from datetime import UTC, datetime
from pathlib import Path
from typing import Any
from uuid import uuid4

logger = logging.getLogger(__name__)

SCHEMA_SQL = """
PRAGMA journal_mode = WAL;
PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS knowledge_documents (
    id TEXT PRIMARY KEY,
    filename TEXT NOT NULL,
    safe_filename TEXT NOT NULL,
    tenant_id TEXT NOT NULL,
    file_size_bytes INTEGER NOT NULL DEFAULT 0,
    chunks_indexed INTEGER NOT NULL DEFAULT 0,
    scope TEXT NOT NULL DEFAULT 'tenant_wide' CHECK (scope IN ('tenant_wide', 'persona_specific')),
    is_enabled INTEGER NOT NULL DEFAULT 1 CHECK (is_enabled IN (0, 1)),
    version INTEGER NOT NULL DEFAULT 1,
    ingestion_status TEXT NOT NULL DEFAULT 'indexed' CHECK (ingestion_status IN ('pending', 'indexing', 'indexed', 'failed', 'deleting')),
    ingestion_error TEXT,
    uploaded_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    UNIQUE (tenant_id, id)
);

CREATE INDEX IF NOT EXISTS idx_kdocs_tenant_status ON knowledge_documents(tenant_id, is_enabled);
CREATE INDEX IF NOT EXISTS idx_kdocs_tenant_ingestion ON knowledge_documents(tenant_id, ingestion_status);
CREATE INDEX IF NOT EXISTS idx_kdocs_tenant_name ON knowledge_documents(tenant_id, filename);

CREATE TABLE IF NOT EXISTS document_persona_assignments (
    document_id TEXT NOT NULL,
    persona_key TEXT NOT NULL,
    tenant_id TEXT NOT NULL,
    assigned_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (document_id, persona_key),
    FOREIGN KEY (tenant_id, document_id) REFERENCES knowledge_documents(tenant_id, id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_dpa_persona ON document_persona_assignments(tenant_id, persona_key);

CREATE TABLE IF NOT EXISTS persona_knowledge_settings (
    tenant_id TEXT NOT NULL,
    persona_key TEXT NOT NULL,
    grounding_mode TEXT NOT NULL DEFAULT 'hybrid_balanced' CHECK (grounding_mode IN ('knowledge_strict', 'prompt_only', 'hybrid_balanced', 'knowledge_first')),
    min_relevance_score REAL NOT NULL DEFAULT 0.65,
    max_chunks_per_turn INTEGER NOT NULL DEFAULT 3,
    custom_fallback_spoken TEXT,
    updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (tenant_id, persona_key)
);

CREATE TABLE IF NOT EXISTS knowledge_audit_logs (
    id TEXT PRIMARY KEY,
    tenant_id TEXT NOT NULL,
    actor_id TEXT NOT NULL,
    action TEXT NOT NULL,
    target_type TEXT NOT NULL,
    target_id TEXT NOT NULL,
    details_json TEXT,
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_k_audit ON knowledge_audit_logs(tenant_id, created_at);
"""


def _utc_now_iso() -> str:
    return datetime.now(UTC).isoformat()


class KnowledgeStore:
    """ACID SQLite store for knowledge document metadata and persona assignments."""

    def __init__(
        self,
        db_path: str | Path = "data/voice_agent.db",
        legacy_manifest_path: str | Path | None = "data/knowledge_documents.json",
    ) -> None:
        self.db_path = Path(db_path)
        if str(self.db_path) != ":memory:":
            self.db_path.parent.mkdir(parents=True, exist_ok=True)
        self._init_schema()
        if legacy_manifest_path:
            self._migrate_legacy_manifest(Path(legacy_manifest_path))

    @contextmanager
    def connect(self) -> Generator[sqlite3.Connection, None, None]:
        """Yield a transactional connection with foreign keys and WAL mode enabled."""
        connection = sqlite3.connect(str(self.db_path), timeout=15.0)
        connection.row_factory = sqlite3.Row
        connection.execute("PRAGMA foreign_keys = ON")
        if str(self.db_path) != ":memory:":
            connection.execute("PRAGMA journal_mode = WAL")
        try:
            yield connection
            connection.commit()
        except Exception:
            connection.rollback()
            raise
        finally:
            connection.close()

    def _init_schema(self) -> None:
        with self.connect() as conn:
            conn.executescript(SCHEMA_SQL)

    def _migrate_legacy_manifest(self, manifest_path: Path) -> int:
        """Migrate legacy flat JSON document manifest into SQLite without duplicate insertion."""
        if not manifest_path.exists():
            return 0

        try:
            raw = json.loads(manifest_path.read_text(encoding="utf-8"))
        except (OSError, json.JSONDecodeError) as exc:
            logger.warning("Could not read legacy knowledge manifest %s: %s", manifest_path, exc)
            return 0

        if not isinstance(raw, list):
            return 0

        migrated_count = 0
        with self.connect() as conn:
            for item in raw:
                if not isinstance(item, dict):
                    continue
                name = item.get("name")
                tenant_id = item.get("tenant_id")
                if not name or not tenant_id:
                    continue

                # Check if document already exists for this tenant
                existing = conn.execute(
                    "SELECT id FROM knowledge_documents WHERE tenant_id = ? AND filename = ?",
                    (str(tenant_id), str(name)),
                ).fetchone()

                if existing:
                    continue

                doc_id = uuid4().hex
                uploaded_at = str(item.get("uploaded_at") or _utc_now_iso())
                chunks = int(item.get("chunks_indexed") or 0)

                conn.execute(
                    """
                    INSERT INTO knowledge_documents (
                        id, filename, safe_filename, tenant_id, file_size_bytes,
                        chunks_indexed, scope, is_enabled, version,
                        ingestion_status, uploaded_at, updated_at
                    ) VALUES (?, ?, ?, ?, ?, ?, 'tenant_wide', 1, 1, 'indexed', ?, ?)
                    """,
                    (doc_id, str(name), str(name), str(tenant_id), 0, chunks, uploaded_at, uploaded_at),
                )
                migrated_count += 1

        if migrated_count > 0:
            logger.info("Migrated %d legacy knowledge documents into SQLite from %s", migrated_count, manifest_path)
        return migrated_count

    # -------------------------------------------------------------------------
    # Document CRUD Operations
    # -------------------------------------------------------------------------

    def create_document(
        self,
        tenant_id: str,
        filename: str,
        safe_filename: str,
        file_size_bytes: int = 0,
        chunks_indexed: int = 0,
        scope: str = "tenant_wide",
        assigned_personas: list[str] | None = None,
        ingestion_status: str = "indexed",
        ingestion_error: str | None = None,
        document_id: str | None = None,
    ) -> dict[str, Any]:
        """Create or update a document record atomically with persona assignments."""
        doc_id = document_id or uuid4().hex
        now = _utc_now_iso()

        with self.connect() as conn:
            # Check if document exists with this filename to handle re-uploads
            existing = conn.execute(
                "SELECT id, version FROM knowledge_documents WHERE tenant_id = ? AND filename = ?",
                (tenant_id, filename),
            ).fetchone()

            if existing:
                doc_id = existing["id"]
                new_version = int(existing["version"]) + 1
                conn.execute(
                    """
                    UPDATE knowledge_documents
                    SET safe_filename = ?, file_size_bytes = ?, chunks_indexed = ?,
                        scope = ?, ingestion_status = ?, ingestion_error = ?,
                        version = ?, updated_at = ?
                    WHERE tenant_id = ? AND id = ?
                    """,
                    (
                        safe_filename,
                        file_size_bytes,
                        chunks_indexed,
                        scope,
                        ingestion_status,
                        ingestion_error,
                        new_version,
                        now,
                        tenant_id,
                        doc_id,
                    ),
                )
            else:
                conn.execute(
                    """
                    INSERT INTO knowledge_documents (
                        id, filename, safe_filename, tenant_id, file_size_bytes,
                        chunks_indexed, scope, is_enabled, version,
                        ingestion_status, ingestion_error, uploaded_at, updated_at
                    ) VALUES (?, ?, ?, ?, ?, ?, ?, 1, 1, ?, ?, ?, ?)
                    """,
                    (
                        doc_id,
                        filename,
                        safe_filename,
                        tenant_id,
                        file_size_bytes,
                        chunks_indexed,
                        scope,
                        ingestion_status,
                        ingestion_error,
                        now,
                        now,
                    ),
                )

            # Update assignments if provided
            if assigned_personas is not None:
                conn.execute("DELETE FROM document_persona_assignments WHERE document_id = ?", (doc_id,))
                if scope == "persona_specific":
                    for persona_key in set(assigned_personas):
                        conn.execute(
                            """
                            INSERT INTO document_persona_assignments (document_id, persona_key, tenant_id, assigned_at)
                            VALUES (?, ?, ?, ?)
                            """,
                            (doc_id, persona_key, tenant_id, now),
                        )

        return self.get_document(tenant_id, doc_id)  # type: ignore[return-value]

    def get_document(self, tenant_id: str, document_id: str) -> dict[str, Any] | None:
        """Fetch one document with its assigned personas list."""
        with self.connect() as conn:
            row = conn.execute(
                "SELECT * FROM knowledge_documents WHERE tenant_id = ? AND id = ?",
                (tenant_id, document_id),
            ).fetchone()
            if not row:
                return None

            doc = dict(row)
            doc["is_enabled"] = bool(doc["is_enabled"])
            assignments = conn.execute(
                "SELECT persona_key FROM document_persona_assignments WHERE tenant_id = ? AND document_id = ?",
                (tenant_id, document_id),
            ).fetchall()
            doc["assigned_personas"] = [r["persona_key"] for r in assignments]
            return doc

    def get_document_by_filename(self, tenant_id: str, filename: str) -> dict[str, Any] | None:
        """Fetch one document by its filename."""
        with self.connect() as conn:
            row = conn.execute(
                "SELECT * FROM knowledge_documents WHERE tenant_id = ? AND filename = ?",
                (tenant_id, filename),
            ).fetchone()
            if not row:
                return None
            return self.get_document(tenant_id, row["id"])

    def list_documents(self, tenant_id: str) -> list[dict[str, Any]]:
        """List all documents for a tenant with populated assigned personas."""
        with self.connect() as conn:
            rows = conn.execute(
                "SELECT * FROM knowledge_documents WHERE tenant_id = ? ORDER BY uploaded_at DESC",
                (tenant_id,),
            ).fetchall()

            if not rows:
                return []

            # Bulk load assignments to avoid N+1 queries
            assignments = conn.execute(
                "SELECT document_id, persona_key FROM document_persona_assignments WHERE tenant_id = ?",
                (tenant_id,),
            ).fetchall()

            assignment_map: dict[str, list[str]] = {}
            for r in assignments:
                assignment_map.setdefault(r["document_id"], []).append(r["persona_key"])

            results = []
            for row in rows:
                doc = dict(row)
                doc["is_enabled"] = bool(doc["is_enabled"])
                doc["assigned_personas"] = assignment_map.get(doc["id"], [])
                results.append(doc)
            return results

    def delete_document(self, tenant_id: str, document_id: str) -> bool:
        """Permanently delete a document; foreign keys cascade assignment removal."""
        with self.connect() as conn:
            cursor = conn.execute(
                "DELETE FROM knowledge_documents WHERE tenant_id = ? AND id = ?",
                (tenant_id, document_id),
            )
            return cursor.rowcount > 0

    def set_document_enabled(self, tenant_id: str, document_id: str, is_enabled: bool) -> bool:
        """Soft-toggle document availability for live voice retrieval."""
        now = _utc_now_iso()
        with self.connect() as conn:
            cursor = conn.execute(
                "UPDATE knowledge_documents SET is_enabled = ?, updated_at = ? WHERE tenant_id = ? AND id = ?",
                (1 if is_enabled else 0, now, tenant_id, document_id),
            )
            return cursor.rowcount > 0

    # Backwards-compatible alias for set_document_enabled
    set_document_status = set_document_enabled

    def set_ingestion_status(
        self,
        tenant_id: str,
        document_id: str,
        ingestion_status: str,
        ingestion_error: str | None = None,
        chunks_indexed: int | None = None,
    ) -> bool:
        """Update ingestion lifecycle state and error messages."""
        now = _utc_now_iso()
        with self.connect() as conn:
            if chunks_indexed is not None:
                cursor = conn.execute(
                    """
                    UPDATE knowledge_documents
                    SET ingestion_status = ?, ingestion_error = ?, chunks_indexed = ?, updated_at = ?
                    WHERE tenant_id = ? AND id = ?
                    """,
                    (ingestion_status, ingestion_error, chunks_indexed, now, tenant_id, document_id),
                )
            else:
                cursor = conn.execute(
                    """
                    UPDATE knowledge_documents
                    SET ingestion_status = ?, ingestion_error = ?, updated_at = ?
                    WHERE tenant_id = ? AND id = ?
                    """,
                    (ingestion_status, ingestion_error, now, tenant_id, document_id),
                )
            return cursor.rowcount > 0

    def set_document_assignments(
        self,
        tenant_id: str,
        document_id: str,
        scope: str,
        assigned_personas: list[str],
    ) -> bool:
        """Update document scope and persona assignments atomically."""
        now = _utc_now_iso()
        with self.connect() as conn:
            doc = conn.execute(
                "SELECT id FROM knowledge_documents WHERE tenant_id = ? AND id = ?",
                (tenant_id, document_id),
            ).fetchone()
            if not doc:
                return False

            conn.execute(
                "UPDATE knowledge_documents SET scope = ?, updated_at = ? WHERE tenant_id = ? AND id = ?",
                (scope, now, tenant_id, document_id),
            )

            conn.execute("DELETE FROM document_persona_assignments WHERE document_id = ?", (document_id,))
            if scope == "persona_specific":
                for persona_key in set(assigned_personas):
                    conn.execute(
                        """
                        INSERT INTO document_persona_assignments (document_id, persona_key, tenant_id, assigned_at)
                        VALUES (?, ?, ?, ?)
                        """,
                        (document_id, persona_key, tenant_id, now),
                    )
            return True

    def resolve_active_document_ids_for_persona(self, tenant_id: str, persona_key: str) -> list[str]:
        """Query currently indexed, enabled document UUIDs visible to this persona."""
        with self.connect() as conn:
            cursor = conn.execute(
                """
                SELECT kd.id FROM knowledge_documents kd
                LEFT JOIN document_persona_assignments dpa
                  ON kd.id = dpa.document_id AND dpa.persona_key = ?
                WHERE kd.tenant_id = ?
                  AND kd.is_enabled = 1
                  AND kd.ingestion_status = 'indexed'
                  AND (kd.scope = 'tenant_wide' OR dpa.persona_key IS NOT NULL)
                """,
                (persona_key, tenant_id),
            )
            return [row["id"] for row in cursor.fetchall()]

    # Backwards-compatible alias for resolve_active_document_ids_for_persona
    get_active_doc_ids_for_persona = resolve_active_document_ids_for_persona

    # -------------------------------------------------------------------------
    # Persona Knowledge Settings Operations
    # -------------------------------------------------------------------------

    def get_persona_settings(self, tenant_id: str, persona_key: str) -> dict[str, Any]:
        """Get or initialize default knowledge grounding settings for a persona."""
        with self.connect() as conn:
            row = conn.execute(
                "SELECT * FROM persona_knowledge_settings WHERE tenant_id = ? AND persona_key = ?",
                (tenant_id, persona_key),
            ).fetchone()

            if row:
                return dict(row)

            # Insert default settings if absent
            now = _utc_now_iso()
            conn.execute(
                """
                INSERT OR IGNORE INTO persona_knowledge_settings (
                    tenant_id, persona_key, grounding_mode, min_relevance_score,
                    max_chunks_per_turn, custom_fallback_spoken, updated_at
                ) VALUES (?, ?, 'hybrid_balanced', 0.65, 3, NULL, ?)
                """,
                (tenant_id, persona_key, now),
            )
            return {
                "tenant_id": tenant_id,
                "persona_key": persona_key,
                "grounding_mode": "hybrid_balanced",
                "min_relevance_score": 0.65,
                "max_chunks_per_turn": 3,
                "custom_fallback_spoken": None,
                "updated_at": now,
            }

    def upsert_persona_settings(
        self,
        tenant_id: str,
        persona_key: str,
        grounding_mode: str,
        min_relevance_score: float = 0.65,
        max_chunks_per_turn: int = 3,
        custom_fallback_spoken: str | None = None,
    ) -> dict[str, Any]:
        """Update or insert knowledge grounding configuration for a persona."""
        now = _utc_now_iso()
        with self.connect() as conn:
            conn.execute(
                """
                INSERT INTO persona_knowledge_settings (
                    tenant_id, persona_key, grounding_mode, min_relevance_score,
                    max_chunks_per_turn, custom_fallback_spoken, updated_at
                ) VALUES (?, ?, ?, ?, ?, ?, ?)
                ON CONFLICT(tenant_id, persona_key) DO UPDATE SET
                    grounding_mode = excluded.grounding_mode,
                    min_relevance_score = excluded.min_relevance_score,
                    max_chunks_per_turn = excluded.max_chunks_per_turn,
                    custom_fallback_spoken = excluded.custom_fallback_spoken,
                    updated_at = excluded.updated_at
                """,
                (
                    tenant_id,
                    persona_key,
                    grounding_mode,
                    min_relevance_score,
                    max_chunks_per_turn,
                    custom_fallback_spoken,
                    now,
                ),
            )
        return self.get_persona_settings(tenant_id, persona_key)

    # -------------------------------------------------------------------------
    # Administrative Audit Logging
    # -------------------------------------------------------------------------

    def log_audit(
        self,
        tenant_id: str,
        actor_id: str,
        action: str,
        target_type: str,
        target_id: str,
        details: dict[str, Any] | None = None,
    ) -> str:
        """Record an administrative change in the tamper-evident audit log."""
        audit_id = uuid4().hex
        details_json = json.dumps(details) if details else None
        now = _utc_now_iso()
        with self.connect() as conn:
            conn.execute(
                """
                INSERT INTO knowledge_audit_logs (
                    id, tenant_id, actor_id, action, target_type, target_id, details_json, created_at
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
                """,
                (audit_id, tenant_id, actor_id, action, target_type, target_id, details_json, now),
            )
        return audit_id

    def list_audit_logs(self, tenant_id: str, limit: int = 50) -> list[dict[str, Any]]:
        """Fetch recent audit log entries for a tenant."""
        with self.connect() as conn:
            rows = conn.execute(
                "SELECT * FROM knowledge_audit_logs WHERE tenant_id = ? ORDER BY created_at DESC LIMIT ?",
                (tenant_id, limit),
            ).fetchall()
            results = []
            for r in rows:
                item = dict(r)
                if item.get("details_json"):
                    try:
                        item["details"] = json.loads(item["details_json"])
                    except json.JSONDecodeError:
                        item["details"] = None
                else:
                    item["details"] = None
                results.append(item)
            return results
