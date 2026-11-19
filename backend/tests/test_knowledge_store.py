"""Unit tests for KnowledgeStore SQLite persistence and dynamic knowledge schemas."""

import json
from datetime import UTC, datetime
from pathlib import Path

import pytest
from pydantic import ValidationError

from backend.api.schemas import (
    DocumentAssignmentUpdate,
    DocumentScope,
    DocumentStatusUpdate,
    GroundingMode,
    IngestionStatus,
    KnowledgeDocumentResponse,
    PersonaKnowledgeSettingsResponse,
    PersonaKnowledgeSettingsUpdate,
)
from backend.rag.store import KnowledgeStore


@pytest.fixture
def store(tmp_path: Path) -> KnowledgeStore:
    """Fixture providing an isolated KnowledgeStore backed by a temporary SQLite database."""
    db_file = tmp_path / "test_knowledge.db"
    return KnowledgeStore(db_path=db_file, legacy_manifest_path=None)


class TestKnowledgeStore:
    """Verify ACID SQLite operations, foreign keys, and relational scoping."""

    def test_schema_initialization(self, store: KnowledgeStore) -> None:
        """Verify tables and foreign keys are created properly."""
        with store.connect() as conn:
            # Check foreign keys pragma
            fk = conn.execute("PRAGMA foreign_keys").fetchone()[0]
            assert fk == 1

            # Check tables exist
            tables = {
                row[0]
                for row in conn.execute(
                    "SELECT name FROM sqlite_master WHERE type='table'"
                ).fetchall()
            }
            assert "knowledge_documents" in tables
            assert "document_persona_assignments" in tables
            assert "persona_knowledge_settings" in tables
            assert "knowledge_audit_logs" in tables

    def test_create_and_get_document(self, store: KnowledgeStore) -> None:
        """Verify creating a tenant-wide document and retrieving it."""
        doc = store.create_document(
            tenant_id="grand-meridian",
            filename="Grand_Meridian_Policy.pdf",
            safe_filename="Grand_Meridian_Policy.pdf",
            file_size_bytes=10240,
            chunks_indexed=12,
            scope="tenant_wide",
        )
        assert doc is not None
        assert doc["filename"] == "Grand_Meridian_Policy.pdf"
        assert doc["tenant_id"] == "grand-meridian"
        assert doc["scope"] == "tenant_wide"
        assert doc["is_enabled"] is True
        assert doc["version"] == 1
        assert doc["chunks_indexed"] == 12
        assert doc["assigned_personas"] == []

        fetched = store.get_document("grand-meridian", doc["id"])
        assert fetched is not None
        assert fetched["id"] == doc["id"]
        assert fetched["safe_filename"] == "Grand_Meridian_Policy.pdf"

    def test_create_persona_specific_document(self, store: KnowledgeStore) -> None:
        """Verify creating a persona-specific document saves assignments."""
        doc = store.create_document(
            tenant_id="grand-meridian",
            filename="Room_Service_Menu.pdf",
            safe_filename="Room_Service_Menu.pdf",
            file_size_bytes=5000,
            chunks_indexed=8,
            scope="persona_specific",
            assigned_personas=["restaurant_dining"],
        )
        assert doc["scope"] == "persona_specific"
        assert doc["assigned_personas"] == ["restaurant_dining"]

        # Verify active doc IDs for Marco (restaurant_dining) vs Elena (hotel_booking_specialist)
        marco_docs = store.resolve_active_document_ids_for_persona("grand-meridian", "restaurant_dining")
        elena_docs = store.resolve_active_document_ids_for_persona("grand-meridian", "hotel_booking_specialist")

        assert doc["id"] in marco_docs
        assert doc["id"] not in elena_docs

    def test_reupload_collision_replacement(self, store: KnowledgeStore) -> None:
        """Verify re-uploading an existing filename increments version and preserves assignments."""
        # Initial upload
        doc1 = store.create_document(
            tenant_id="grand-meridian",
            filename="Dining_Menu.pdf",
            safe_filename="Dining_Menu.pdf",
            file_size_bytes=4000,
            chunks_indexed=5,
            scope="persona_specific",
            assigned_personas=["restaurant_dining"],
        )
        assert doc1["version"] == 1
        original_id = doc1["id"]

        # Re-upload with same filename
        doc2 = store.create_document(
            tenant_id="grand-meridian",
            filename="Dining_Menu.pdf",
            safe_filename="Dining_Menu.pdf",
            file_size_bytes=6000,
            chunks_indexed=8,
            scope="persona_specific",
            assigned_personas=["restaurant_dining", "hotel_booking_specialist"],
        )
        assert doc2["id"] == original_id
        assert doc2["version"] == 2
        assert doc2["chunks_indexed"] == 8
        assert sorted(doc2["assigned_personas"]) == ["hotel_booking_specialist", "restaurant_dining"]

    def test_soft_toggle_status(self, store: KnowledgeStore) -> None:
        """Verify toggling is_enabled excludes document from active persona retrieval."""
        doc = store.create_document(
            tenant_id="grand-meridian",
            filename="Spa_Guide.pdf",
            safe_filename="Spa_Guide.pdf",
            scope="tenant_wide",
        )
        assert doc["id"] in store.resolve_active_document_ids_for_persona("grand-meridian", "receptionist")

        # Soft disable
        success = store.set_document_enabled("grand-meridian", doc["id"], is_enabled=False)
        assert success is True

        disabled_doc = store.get_document("grand-meridian", doc["id"])
        assert disabled_doc is not None
        assert disabled_doc["is_enabled"] is False
        assert doc["id"] not in store.resolve_active_document_ids_for_persona("grand-meridian", "receptionist")

        # Re-enable using alias to verify backward compatibility
        store.set_document_status("grand-meridian", doc["id"], is_enabled=True)
        assert doc["id"] in store.resolve_active_document_ids_for_persona("grand-meridian", "receptionist")
        # Also check alias get_active_doc_ids_for_persona
        assert doc["id"] in store.get_active_doc_ids_for_persona("grand-meridian", "receptionist")

    def test_cascading_delete(self, store: KnowledgeStore) -> None:
        """Verify deleting a document cascades to remove its persona assignments."""
        doc = store.create_document(
            tenant_id="grand-meridian",
            filename="Travel_Shuttle.pdf",
            safe_filename="Travel_Shuttle.pdf",
            scope="persona_specific",
            assigned_personas=["travel_desk"],
        )
        doc_id = doc["id"]

        with store.connect() as conn:
            assignments_before = conn.execute(
                "SELECT count(*) FROM document_persona_assignments WHERE document_id = ?",
                (doc_id,),
            ).fetchone()[0]
            assert assignments_before == 1

        deleted = store.delete_document("grand-meridian", doc_id)
        assert deleted is True

        with store.connect() as conn:
            assignments_after = conn.execute(
                "SELECT count(*) FROM document_persona_assignments WHERE document_id = ?",
                (doc_id,),
            ).fetchone()[0]
            assert assignments_after == 0

        assert store.get_document("grand-meridian", doc_id) is None

    def test_set_document_assignments(self, store: KnowledgeStore) -> None:
        """Verify reassigning document scope and personas."""
        doc = store.create_document(
            tenant_id="grand-meridian",
            filename="Policy.pdf",
            safe_filename="Policy.pdf",
            scope="tenant_wide",
        )
        # Change to persona-specific
        updated = store.set_document_assignments(
            tenant_id="grand-meridian",
            document_id=doc["id"],
            scope="persona_specific",
            assigned_personas=["hotel_booking_specialist", "receptionist"],
        )
        assert updated is True

        refetched = store.get_document("grand-meridian", doc["id"])
        assert refetched is not None
        assert refetched["scope"] == "persona_specific"
        assert sorted(refetched["assigned_personas"]) == ["hotel_booking_specialist", "receptionist"]

    def test_list_documents(self, store: KnowledgeStore) -> None:
        """Verify bulk document listing with pre-populated assignments."""
        store.create_document(
            tenant_id="grand-meridian",
            filename="Doc1.pdf",
            safe_filename="Doc1.pdf",
            scope="tenant_wide",
        )
        store.create_document(
            tenant_id="grand-meridian",
            filename="Doc2.pdf",
            safe_filename="Doc2.pdf",
            scope="persona_specific",
            assigned_personas=["customer_care"],
        )
        store.create_document(
            tenant_id="other-hotel",
            filename="Other.pdf",
            safe_filename="Other.pdf",
            scope="tenant_wide",
        )

        docs = store.list_documents("grand-meridian")
        assert len(docs) == 2
        filenames = {d["filename"] for d in docs}
        assert filenames == {"Doc1.pdf", "Doc2.pdf"}

    def test_persona_knowledge_settings(self, store: KnowledgeStore) -> None:
        """Verify default grounding settings and upsert overrides."""
        # Get default
        default_settings = store.get_persona_settings("grand-meridian", "hotel_booking_specialist")
        assert default_settings["grounding_mode"] == "hybrid_balanced"
        assert default_settings["min_relevance_score"] == 0.65
        assert default_settings["max_chunks_per_turn"] == 3

        # Update to strict mode
        custom = store.upsert_persona_settings(
            tenant_id="grand-meridian",
            persona_key="hotel_booking_specialist",
            grounding_mode="knowledge_strict",
            min_relevance_score=0.75,
            max_chunks_per_turn=2,
            custom_fallback_spoken="I do not have verified booking records for that.",
        )
        assert custom["grounding_mode"] == "knowledge_strict"
        assert custom["min_relevance_score"] == 0.75
        assert custom["max_chunks_per_turn"] == 2
        assert custom["custom_fallback_spoken"] == "I do not have verified booking records for that."

    def test_audit_logging(self, store: KnowledgeStore) -> None:
        """Verify audit trail logging and retrieval."""
        audit_id = store.log_audit(
            tenant_id="grand-meridian",
            actor_id="admin-user-1",
            action="assign",
            target_type="document",
            target_id="doc-uuid-1",
            details={"scope": "persona_specific", "personas": ["restaurant_dining"]},
        )
        assert audit_id is not None

        logs = store.list_audit_logs("grand-meridian", limit=10)
        assert len(logs) == 1
        assert logs[0]["action"] == "assign"
        assert logs[0]["target_id"] == "doc-uuid-1"
        assert logs[0]["details"]["scope"] == "persona_specific"

    def test_legacy_manifest_migration(self, tmp_path: Path) -> None:
        """Verify automatic migration of legacy knowledge_documents.json."""
        manifest_file = tmp_path / "knowledge_documents.json"
        manifest_data = [
            {
                "name": "Legacy_Policy.txt",
                "tenant_id": "grand-meridian",
                "chunks_indexed": 150,
                "uploaded_at": "2026-10-30T15:45:28Z",
                "status": "indexed",
            },
            {
                "name": "Legacy_FAQ.md",
                "tenant_id": "grand-meridian",
                "chunks_indexed": 75,
                "uploaded_at": "2026-11-01T10:00:00Z",
                "status": "indexed",
            },
        ]
        manifest_file.write_text(json.dumps(manifest_data), encoding="utf-8")

        db_file = tmp_path / "migrated.db"
        migrated_store = KnowledgeStore(db_path=db_file, legacy_manifest_path=manifest_file)

        docs = migrated_store.list_documents("grand-meridian")
        assert len(docs) == 2
        names = {d["filename"] for d in docs}
        assert names == {"Legacy_Policy.txt", "Legacy_FAQ.md"}
        for d in docs:
            assert d["scope"] == "tenant_wide"
            assert d["ingestion_status"] == "indexed"
            assert d["is_enabled"] is True


class TestKnowledgeSchemas:
    """Verify Pydantic v2 schemas for knowledge assignment and grounding settings."""

    def test_document_response_schema(self) -> None:
        """Verify KnowledgeDocumentResponse model validation."""
        data = {
            "id": "doc-uuid-123",
            "name": "Rate_Card.pdf",
            "tenant_id": "grand-meridian",
            "chunks_indexed": 10,
            "uploaded_at": datetime.now(UTC),
            "status": "indexed",
            "is_enabled": True,
            "scope": "persona_specific",
            "assigned_personas": ["hotel_booking_specialist"],
            "version": 1,
            "ingestion_status": IngestionStatus.INDEXED,
        }
        res = KnowledgeDocumentResponse.model_validate(data)
        assert res.id == "doc-uuid-123"
        assert res.scope == DocumentScope.PERSONA_SPECIFIC
        assert res.assigned_personas == ["hotel_booking_specialist"]
        assert res.ingestion_status == IngestionStatus.INDEXED

    def test_persona_knowledge_settings_response(self) -> None:
        """Verify PersonaKnowledgeSettingsResponse validation."""
        data = {
            "tenant_id": "grand-meridian",
            "persona_key": "receptionist",
            "grounding_mode": GroundingMode.HYBRID_BALANCED,
            "min_relevance_score": 0.65,
            "max_chunks_per_turn": 3,
            "custom_fallback_spoken": None,
            "updated_at": datetime.now(UTC),
        }
        res = PersonaKnowledgeSettingsResponse.model_validate(data)
        assert res.persona_key == "receptionist"
        assert res.grounding_mode == GroundingMode.HYBRID_BALANCED

    def test_persona_settings_bounds(self) -> None:
        """Verify validation bounds on min_relevance_score and max_chunks."""
        # Valid update
        update = PersonaKnowledgeSettingsUpdate(
            grounding_mode=GroundingMode.KNOWLEDGE_STRICT,
            min_relevance_score=0.70,
            max_chunks_per_turn=4,
        )
        assert update.grounding_mode == GroundingMode.KNOWLEDGE_STRICT
        assert update.min_relevance_score == 0.70

        # Invalid min_relevance_score > 1.0
        with pytest.raises(ValidationError):
            PersonaKnowledgeSettingsUpdate(
                grounding_mode=GroundingMode.KNOWLEDGE_STRICT,
                min_relevance_score=1.5,
            )

        # Invalid max_chunks_per_turn > 5
        with pytest.raises(ValidationError):
            PersonaKnowledgeSettingsUpdate(
                grounding_mode=GroundingMode.KNOWLEDGE_STRICT,
                max_chunks_per_turn=10,
            )

    def test_document_assignment_update(self) -> None:
        """Verify assignment update payload schema."""
        update = DocumentAssignmentUpdate(
            scope=DocumentScope.PERSONA_SPECIFIC,
            assigned_personas=["receptionist", "travel_desk"],
        )
        assert update.scope == DocumentScope.PERSONA_SPECIFIC
        assert len(update.assigned_personas) == 2

    def test_document_status_update(self) -> None:
        """Verify status update payload schema."""
        status_update = DocumentStatusUpdate(is_enabled=False)
        assert status_update.is_enabled is False
