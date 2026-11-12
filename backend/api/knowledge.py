"""Tenant-scoped Knowledge Hub services for safe local document ingestion."""

from __future__ import annotations

import json
import logging
import re
from datetime import UTC, datetime
from functools import lru_cache
from pathlib import Path
from threading import RLock
from typing import Any
from uuid import uuid4

from backend.api.schemas import (
    DocumentScope,
    GroundingMode,
    IngestionStatus,
    KnowledgeChunkResponse,
    KnowledgeDocumentResponse,
    KnowledgeSearchResponse,
    PersonaKnowledgeSettingsResponse,
    PersonaKnowledgeSettingsUpdate,
)
from backend.config.settings import AppSettings, get_settings
from backend.rag.ingestion import DocumentIngestionPipeline
from backend.rag.retriever import RAGContextRetriever
from backend.rag.store import KnowledgeStore
from backend.rag.vector_store import (
    BaseVectorStore,
    MemoryVectorStore,
    UnavailableVectorStore,
    VectorStoreUnavailableError,
    get_vector_store,
)

logger = logging.getLogger(__name__)

ALLOWED_DOCUMENT_EXTENSIONS = {".md", ".pdf", ".txt"}
MAX_DOCUMENT_BYTES = 10 * 1024 * 1024
SAFE_TENANT_ID = re.compile(r"^[a-z0-9][a-z0-9_-]{0,63}$")


class KnowledgeStoreUnavailableError(VectorStoreUnavailableError):
    """Raised when durable tenant knowledge storage is not available."""


def _utc_now() -> datetime:
    return datetime.now(UTC)


def _build_document_response(doc: dict[str, Any]) -> KnowledgeDocumentResponse:
    """Map a raw SQLite document record to a validated Pydantic v2 response."""
    uploaded_at = doc.get("uploaded_at")
    if isinstance(uploaded_at, str):
        try:
            uploaded_at_dt = datetime.fromisoformat(uploaded_at)
        except ValueError:
            uploaded_at_dt = _utc_now()
    elif isinstance(uploaded_at, datetime):
        uploaded_at_dt = uploaded_at
    else:
        uploaded_at_dt = _utc_now()

    raw_status = doc.get("ingestion_status") or doc.get("status") or "indexed"
    try:
        ingestion_status = IngestionStatus(raw_status)
    except ValueError:
        ingestion_status = IngestionStatus.INDEXED

    raw_scope = doc.get("scope") or "tenant_wide"
    try:
        scope = DocumentScope(raw_scope)
    except ValueError:
        scope = DocumentScope.TENANT_WIDE

    status_val = ingestion_status.value

    return KnowledgeDocumentResponse(
        id=doc.get("id"),
        name=doc.get("filename") or doc.get("name", "untitled"),
        tenant_id=doc.get("tenant_id", "grand-meridian"),
        chunks_indexed=int(doc.get("chunks_indexed", 0)),
        uploaded_at=uploaded_at_dt,
        status=status_val,  # type: ignore[arg-type]
        is_enabled=bool(doc.get("is_enabled", True)),
        scope=scope,
        assigned_personas=list(doc.get("assigned_personas", [])),
        version=int(doc.get("version", 1)),
        ingestion_status=ingestion_status,
        ingestion_error=doc.get("ingestion_error"),
    )


# Backwards-compatible alias
_to_document_response = _build_document_response


class KnowledgeHubService:
    """Coordinates uploads, staged reindexing, and retrieval testing per tenant."""

    def __init__(
        self,
        settings: AppSettings,
        data_dir: Path | None = None,
        store: KnowledgeStore | None = None,
    ) -> None:
        self._settings = settings
        self._data_dir = data_dir or Path("data")
        self._uploads_dir = self._data_dir / "uploads"
        self._manifest_path = self._data_dir / "knowledge_documents.json"
        self._store = store or KnowledgeStore(
            db_path=self._data_dir / "voice_agent.db",
            legacy_manifest_path=self._manifest_path,
        )
        self._stores: dict[str, BaseVectorStore] = {}
        self._tenant_write_locks: dict[str, RLock] = {}
        self._lock = RLock()
        self._manifest_lock = RLock()

    @staticmethod
    def validate_tenant_id(tenant_id: str) -> str:
        """Validate tenant isolation keys before accessing local file or vector paths."""
        normalized = tenant_id.strip().lower()
        if not SAFE_TENANT_ID.fullmatch(normalized):
            raise ValueError("Tenant ID may contain lowercase letters, digits, hyphens, and underscores only.")
        return normalized

    @staticmethod
    def safe_filename(filename: str) -> str:
        """Return a stable, traversal-safe filename for document replacement semantics."""
        name = Path(filename).name.strip()
        extension = Path(name).suffix.lower()
        stem = re.sub(r"[^A-Za-z0-9._-]+", "-", Path(name).stem).strip(".-_")
        if not stem or extension not in ALLOWED_DOCUMENT_EXTENSIONS:
            raise ValueError("Only PDF, Markdown, and text documents are supported.")
        return f"{stem[:120]}{extension}"

    def _store_for(self, tenant_id: str) -> BaseVectorStore:
        with self._lock:
            if tenant_id not in self._stores:
                self._stores[tenant_id] = get_vector_store(
                    persist_dir=self._settings.chroma_persist_dir,
                    tenant_id=tenant_id,
                )
            return self._stores[tenant_id]

    def _write_lock_for(self, tenant_id: str) -> RLock:
        with self._lock:
            if tenant_id not in self._tenant_write_locks:
                self._tenant_write_locks[tenant_id] = RLock()
            return self._tenant_write_locks[tenant_id]

    def _durable_store_for(self, tenant_id: str) -> BaseVectorStore:
        """Return the tenant store only when it is backed by persistent ChromaDB."""
        store = self._store_for(tenant_id)
        if isinstance(store, MemoryVectorStore):
            raise KnowledgeStoreUnavailableError(
                "Persistent knowledge storage is unavailable. No document was indexed; "
                "check the ChromaDB installation and data directory."
            )
        return store

    def retriever_for(self, tenant_id: str) -> RAGContextRetriever:
        """Create a tenant retriever without making voice startup depend on ChromaDB."""
        tenant_id = self.validate_tenant_id(tenant_id)
        store = self._store_for(tenant_id)
        if isinstance(store, MemoryVectorStore):
            return RAGContextRetriever(
                vector_store=UnavailableVectorStore(
                    "Persistent ChromaDB is unavailable; uploaded knowledge cannot be searched."
                )
            )
        return RAGContextRetriever(vector_store=store)

    def _load_manifest(self) -> list[dict[str, object]]:
        if not self._manifest_path.exists():
            return []
        try:
            raw = json.loads(self._manifest_path.read_text(encoding="utf-8"))
        except (OSError, json.JSONDecodeError) as exc:
            raise RuntimeError("The knowledge document manifest cannot be read.") from exc
        if not isinstance(raw, list) or any(not isinstance(entry, dict) for entry in raw):
            raise RuntimeError("The knowledge document manifest has an invalid format.")
        return raw

    def _write_manifest(self, entries: list[dict[str, object]]) -> None:
        with self._manifest_lock:
            self._manifest_path.parent.mkdir(parents=True, exist_ok=True)
            temporary_path = self._manifest_path.with_name(
                f".{self._manifest_path.name}.{uuid4().hex}.tmp"
            )
            try:
                temporary_path.write_text(json.dumps(entries, indent=2), encoding="utf-8")
                temporary_path.replace(self._manifest_path)
            finally:
                temporary_path.unlink(missing_ok=True)

    def list_documents(self, tenant_id: str) -> list[KnowledgeDocumentResponse]:
        """List successfully indexed documents for the requested tenant."""
        tenant_id = self.validate_tenant_id(tenant_id)
        docs = self._store.list_documents(tenant_id)
        return [_build_document_response(entry) for entry in docs]

    def get_document(self, tenant_id: str, document_id: str) -> KnowledgeDocumentResponse:
        """Fetch a single document by tenant and document ID."""
        tenant_id = self.validate_tenant_id(tenant_id)
        doc = self._store.get_document(tenant_id, document_id)
        if not doc:
            raise ValueError(f"Document {document_id} not found.")
        return _build_document_response(doc)

    def document_count(self, tenant_id: str = "grand-meridian") -> int:
        """Return indexed document count for dashboard health metadata."""
        return len(self.list_documents(tenant_id))

    def storage_health(self, tenant_id: str = "grand-meridian") -> tuple[bool, str]:
        """Report whether this tenant's knowledge store is persistent and usable."""
        tenant_id = self.validate_tenant_id(tenant_id)
        store = self._store_for(tenant_id)
        if isinstance(store, MemoryVectorStore):
            return (
                False,
                "Persistent ChromaDB is unavailable; knowledge uploads and live retrieval are disabled.",
            )
        return (
            True,
            "Persistent tenant-isolated ChromaDB is available; "
            f"configured embeddings: {self._settings.embedding_provider}.",
        )

    # -------------------------------------------------------------------------
    # Dynamic Persona Assignment & Resolution Operations
    # -------------------------------------------------------------------------

    def resolve_active_document_ids_for_persona(self, tenant_id: str, persona_key: str) -> list[str]:
        """Query currently indexed, enabled document UUIDs visible to this persona."""
        tenant_id = self.validate_tenant_id(tenant_id)
        return self._store.resolve_active_document_ids_for_persona(tenant_id, persona_key)

    # Backwards-compatible alias for resolve_active_document_ids_for_persona
    get_active_doc_ids_for_persona = resolve_active_document_ids_for_persona

    def update_document_assignments(
        self,
        tenant_id: str,
        document_id: str,
        scope: DocumentScope | str,
        assigned_personas: list[str],
    ) -> KnowledgeDocumentResponse:
        """Update document scope and persona assignments atomically."""
        tenant_id = self.validate_tenant_id(tenant_id)
        scope_str = scope.value if isinstance(scope, DocumentScope) else str(scope)
        success = self._store.set_document_assignments(
            tenant_id=tenant_id,
            document_id=document_id,
            scope=scope_str,
            assigned_personas=assigned_personas,
        )
        if not success:
            raise ValueError(f"Document {document_id} not found.")
        return self.get_document(tenant_id, document_id)

    # Backwards-compatible alias for update_document_assignments
    assign_document_to_personas = update_document_assignments

    def set_document_enabled(
        self,
        tenant_id: str,
        document_id: str,
        is_enabled: bool,
    ) -> KnowledgeDocumentResponse:
        """Soft-toggle document availability for live voice retrieval."""
        tenant_id = self.validate_tenant_id(tenant_id)
        success = self._store.set_document_enabled(tenant_id, document_id, is_enabled)
        if not success:
            raise ValueError(f"Document {document_id} not found.")
        return self.get_document(tenant_id, document_id)

    # Backwards-compatible alias for set_document_enabled
    set_document_status = set_document_enabled

    def delete_document(self, tenant_id: str, document_id: str) -> bool:
        """Permanently delete a document from vector index, SQLite, and disk."""
        tenant_id = self.validate_tenant_id(tenant_id)
        with self._write_lock_for(tenant_id):
            doc = self._store.get_document(tenant_id, document_id)
            if not doc:
                return False

            # 1. Purge chunks from vector store by canonical UUID
            try:
                store = self._store_for(tenant_id)
                if hasattr(store, "delete_by_document_id"):
                    store.delete_by_document_id(document_id)
                else:
                    store.delete_by_doc(doc.get("safe_filename") or doc.get("filename", ""))
            except Exception as exc:
                logger.warning("Could not delete chunks for document %s: %s", document_id, exc)

            # 2. Purge upload file from disk if present
            filename = doc.get("safe_filename") or doc.get("filename")
            if filename:
                file_path = self._uploads_dir / tenant_id / filename
                try:
                    file_path.unlink(missing_ok=True)
                except OSError as exc:
                    logger.warning("Could not delete physical upload file %s: %s", file_path, exc)

            # 3. Delete from SQLite store (cascades to assignments)
            deleted = self._store.delete_document(tenant_id, document_id)

            # 4. Sync manifest for legacy compatibility
            with self._manifest_lock:
                try:
                    previous = self._load_manifest()
                    updated = [
                        entry
                        for entry in previous
                        if not (
                            entry.get("tenant_id") == tenant_id
                            and (entry.get("id") == document_id or entry.get("name") == doc.get("filename"))
                        )
                    ]
                    if len(updated) != len(previous):
                        self._write_manifest(updated)
                except Exception as exc:
                    logger.warning("Could not sync manifest during document deletion: %s", exc)

            return deleted

    # -------------------------------------------------------------------------
    # Persona Knowledge Grounding Settings
    # -------------------------------------------------------------------------

    def get_persona_settings(self, tenant_id: str, persona_key: str) -> PersonaKnowledgeSettingsResponse:
        """Get or initialize default knowledge grounding settings for a persona."""
        tenant_id = self.validate_tenant_id(tenant_id)
        data = self._store.get_persona_settings(tenant_id, persona_key)
        updated_at = data.get("updated_at")
        updated_at_dt = datetime.fromisoformat(updated_at) if isinstance(updated_at, str) else None
        return PersonaKnowledgeSettingsResponse(
            tenant_id=data["tenant_id"],
            persona_key=data["persona_key"],
            grounding_mode=GroundingMode(data.get("grounding_mode", "hybrid_balanced")),
            min_relevance_score=float(data.get("min_relevance_score", 0.65)),
            max_chunks_per_turn=int(data.get("max_chunks_per_turn", 3)),
            custom_fallback_spoken=data.get("custom_fallback_spoken"),
            updated_at=updated_at_dt,
        )

    def update_persona_settings(
        self,
        tenant_id: str,
        persona_key: str,
        update: PersonaKnowledgeSettingsUpdate,
    ) -> PersonaKnowledgeSettingsResponse:
        """Update grounding policy and thresholds for one persona."""
        tenant_id = self.validate_tenant_id(tenant_id)
        grounding_str = (
            update.grounding_mode.value
            if isinstance(update.grounding_mode, GroundingMode)
            else str(update.grounding_mode)
        )
        data = self._store.upsert_persona_settings(
            tenant_id=tenant_id,
            persona_key=persona_key,
            grounding_mode=grounding_str,
            min_relevance_score=update.min_relevance_score,
            max_chunks_per_turn=update.max_chunks_per_turn,
            custom_fallback_spoken=update.custom_fallback_spoken,
        )
        updated_at = data.get("updated_at")
        updated_at_dt = datetime.fromisoformat(updated_at) if isinstance(updated_at, str) else None
        return PersonaKnowledgeSettingsResponse(
            tenant_id=data["tenant_id"],
            persona_key=data["persona_key"],
            grounding_mode=GroundingMode(data.get("grounding_mode", "hybrid_balanced")),
            min_relevance_score=float(data.get("min_relevance_score", 0.65)),
            max_chunks_per_turn=int(data.get("max_chunks_per_turn", 3)),
            custom_fallback_spoken=data.get("custom_fallback_spoken"),
            updated_at=updated_at_dt,
        )

    # -------------------------------------------------------------------------
    # Ingestion & Re-Upload Replacement
    # -------------------------------------------------------------------------

    def save_and_index(
        self,
        tenant_id: str,
        original_filename: str,
        content: bytes,
        scope: DocumentScope | str = DocumentScope.TENANT_WIDE,
        assigned_personas: list[str] | None = None,
    ) -> KnowledgeDocumentResponse:
        """Persist an upload and stage it into the tenant's active knowledge base."""
        tenant_id = self.validate_tenant_id(tenant_id)
        with self._write_lock_for(tenant_id):
            return self._save_and_index_locked(
                tenant_id,
                original_filename,
                content,
                scope=scope,
                assigned_personas=assigned_personas,
            )

    def _save_and_index_locked(
        self,
        tenant_id: str,
        original_filename: str,
        content: bytes,
        scope: DocumentScope | str = DocumentScope.TENANT_WIDE,
        assigned_personas: list[str] | None = None,
    ) -> KnowledgeDocumentResponse:
        """Validate, persist, and index one upload while holding its tenant write lock."""
        filename = self.safe_filename(original_filename)
        if not content:
            raise ValueError("The uploaded document is empty.")
        if len(content) > MAX_DOCUMENT_BYTES:
            raise ValueError("Documents must be 10 MB or smaller.")

        # SEC-06 / 2.4: Magic-byte and payload inspection to prevent polyglot files
        extension = Path(filename).suffix.lower()
        if extension == ".pdf":
            if not content.startswith(b"%PDF-"):
                raise ValueError("Invalid PDF format: file header must start with %PDF-.")
        elif extension in {".txt", ".md"}:
            if b"\x00" in content:
                raise ValueError("Text files must not contain binary null bytes.")
            try:
                content.decode("utf-8")
            except UnicodeDecodeError as exc:
                raise ValueError("Text and Markdown files must be valid UTF-8 encoded text.") from exc

        # Check existing document for re-upload replacement semantics
        existing_doc = self._store.get_document_by_filename(tenant_id, original_filename)
        if existing_doc:
            doc_id = existing_doc["id"]
            if assigned_personas is None:
                effective_personas = existing_doc.get("assigned_personas", [])
            else:
                effective_personas = assigned_personas
            if (
                scope == DocumentScope.TENANT_WIDE
                and existing_doc.get("scope") == "persona_specific"
                and assigned_personas is None
            ):
                effective_scope = "persona_specific"
            else:
                effective_scope = scope.value if isinstance(scope, DocumentScope) else str(scope)
        else:
            doc_id = uuid4().hex
            effective_personas = assigned_personas or []
            effective_scope = scope.value if isinstance(scope, DocumentScope) else str(scope)

        store = self._durable_store_for(tenant_id)
        tenant_dir = self._uploads_dir / tenant_id
        tenant_dir.mkdir(parents=True, exist_ok=True)
        destination = tenant_dir / filename
        upload_id = uuid4().hex
        temporary_path = destination.with_name(f".{destination.stem}.{upload_id}.upload{destination.suffix}")
        backup_path = destination.with_name(f".{destination.name}.{upload_id}.backup")
        pipeline = DocumentIngestionPipeline(vector_store=store)
        staged = False
        previous_entries: list[dict[str, object]] | None = None
        manifest_updated = False
        destination_backed_up = False
        destination_promoted = False

        try:
            temporary_path.write_bytes(content)
            staged = True
            store.begin_staged_reindex()

            # Purge prior chunks for this canonical document ID
            try:
                store.delete_by_document_id(doc_id)
            except NotImplementedError:
                store.delete_by_doc(filename)

            indexed = pipeline.ingest_file(
                temporary_path,
                metadata={
                    "tenant_id": tenant_id,
                    "source": "admin_upload",
                    "doc_name": original_filename,
                    "document_id": doc_id,
                },
                document_id=doc_id,
            )
            if indexed < 1:
                raise ValueError("No readable text was found in the uploaded document.")

            with self._manifest_lock:
                previous_entries = self._load_manifest()

                if destination.exists():
                    destination.replace(backup_path)
                    destination_backed_up = True
                temporary_path.replace(destination)
                destination_promoted = True

                # Persist to SQLite store atomically
                doc_record = self._store.create_document(
                    tenant_id=tenant_id,
                    filename=original_filename,
                    safe_filename=filename,
                    file_size_bytes=len(content),
                    chunks_indexed=indexed,
                    scope=effective_scope,
                    assigned_personas=effective_personas,
                    ingestion_status="indexed",
                    document_id=doc_id,
                )

                # Keep manifest synchronized for legacy compatibility
                entries = [
                    entry
                    for entry in previous_entries
                    if not (
                        entry.get("tenant_id") == tenant_id
                        and (entry.get("name") == original_filename or entry.get("id") == doc_id)
                    )
                ]
                record = _build_document_response(doc_record)
                entries.append(record.model_dump(mode="json"))
                self._write_manifest(entries)
                manifest_updated = True

                store.commit_staged_reindex()
                staged = False

            if destination_backed_up:
                try:
                    backup_path.unlink()
                except OSError:
                    logger.warning("Could not remove successful upload backup %s", backup_path, exc_info=True)
            return record

        except Exception as exc:
            rollback_errors: list[Exception] = []
            if manifest_updated and previous_entries is not None:
                try:
                    with self._manifest_lock:
                        self._write_manifest(previous_entries)
                except OSError as rollback_exc:
                    rollback_errors.append(rollback_exc)
                    logger.exception("Could not restore the knowledge document manifest")
            if destination_promoted:
                try:
                    destination.unlink(missing_ok=True)
                except OSError as rollback_exc:
                    rollback_errors.append(rollback_exc)
                    logger.exception("Could not remove the failed promoted upload %s", destination)
            if destination_backed_up:
                try:
                    backup_path.replace(destination)
                except OSError as rollback_exc:
                    rollback_errors.append(rollback_exc)
                    logger.exception("Could not restore the previous upload %s", destination)
            if staged:
                try:
                    store.discard_staged_reindex()
                except Exception as rollback_exc:
                    rollback_errors.append(rollback_exc)
                    logger.exception("Could not discard staged knowledge index changes")
            if destination_promoted or manifest_updated:
                # Rollback SQLite state
                try:
                    if existing_doc:
                        self._store.create_document(
                            tenant_id=tenant_id,
                            filename=existing_doc["filename"],
                            safe_filename=existing_doc["safe_filename"],
                            file_size_bytes=existing_doc["file_size_bytes"],
                            chunks_indexed=existing_doc["chunks_indexed"],
                            scope=existing_doc["scope"],
                            assigned_personas=existing_doc.get("assigned_personas", []),
                            ingestion_status=existing_doc.get("ingestion_status", "indexed"),
                            document_id=doc_id,
                        )
                    else:
                        self._store.delete_document(tenant_id, doc_id)
                except Exception as rollback_exc:
                    rollback_errors.append(rollback_exc)
                    logger.exception("Could not rollback SQLite knowledge store state")

            if rollback_errors:
                raise RuntimeError(
                    "Knowledge upload failed and rollback was incomplete; inspect backend logs."
                ) from exc
            raise
        finally:
            try:
                temporary_path.unlink(missing_ok=True)
            except OSError:
                logger.warning("Could not remove temporary knowledge upload %s", temporary_path, exc_info=True)

    def search(
        self,
        tenant_id: str,
        query: str,
        persona_key: str | None = None,
    ) -> KnowledgeSearchResponse:
        """Run a voice-guarded retrieval test against one tenant collection, optionally scoped to a persona."""
        tenant_id = self.validate_tenant_id(tenant_id)
        durable_store = self._durable_store_for(tenant_id)
        is_memory_store = isinstance(durable_store, MemoryVectorStore) or hasattr(durable_store, "_memory")
        retriever = RAGContextRetriever(vector_store=durable_store)

        if persona_key is not None:
            settings = self.get_persona_settings(tenant_id, persona_key)
            active_doc_ids = self.resolve_active_document_ids_for_persona(tenant_id, persona_key)
            if not active_doc_ids:
                fallback = settings.custom_fallback_spoken or retriever.fallback_message
                return KnowledgeSearchResponse(
                    has_context=False,
                    chunks=[],
                    fallback_spoken=fallback,
                )
            metadata_filter = {
                "tenant_id": tenant_id,
                "document_id": {"$in": active_doc_ids},
            }
            top_k = settings.max_chunks_per_turn
            if is_memory_store and settings.min_relevance_score == 0.65:
                min_score = 0.20
            else:
                min_score = settings.min_relevance_score
        else:
            settings = None
            metadata_filter = {"tenant_id": tenant_id}
            top_k = 2
            min_score = 0.20 if is_memory_store else 0.0

        result = retriever.query_with_context(query, metadata_filter=metadata_filter)
        chunks: list[KnowledgeChunkResponse] = []
        for chunk in result["chunks"]:
            clamped_score = round(max(0.0, min(1.0, float(chunk.score))), 4)
            if clamped_score >= min_score:
                chunks.append(
                    KnowledgeChunkResponse(
                        source=str(chunk.metadata.get("doc_name", "Knowledge document")),
                        excerpt=chunk.text[:800],
                        score=clamped_score,
                    )
                )
            if len(chunks) >= top_k:
                break

        has_context = len(chunks) > 0
        fallback = result.get("fallback_spoken")
        if not has_context and settings is not None and settings.custom_fallback_spoken:
            fallback = settings.custom_fallback_spoken

        return KnowledgeSearchResponse(
            has_context=has_context,
            chunks=chunks,
            fallback_spoken=fallback if not has_context else None,
        )


@lru_cache(maxsize=1)
def get_knowledge_hub() -> KnowledgeHubService:
    """Return the process-wide Knowledge Hub shared by Admin and voice sessions."""
    return KnowledgeHubService(get_settings())
