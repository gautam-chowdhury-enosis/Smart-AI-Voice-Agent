"""Unit tests for KnowledgeHubService persona document resolution and assignment CRUD (Issue #19)."""

from __future__ import annotations

import unittest
from pathlib import Path
from tempfile import TemporaryDirectory

from backend.api.knowledge import KnowledgeHubService
from backend.api.schemas import (
    DocumentScope,
    GroundingMode,
    PersonaKnowledgeSettingsUpdate,
)
from backend.config.settings import AppSettings
from backend.rag.store import KnowledgeStore
from backend.rag.vector_store import BaseVectorStore, DocumentChunk, MemoryVectorStore


class DurableMemoryVectorStore(BaseVectorStore):
    """Test adapter for persistent-store behavior without requiring native ChromaDB."""

    def __init__(self) -> None:
        self._memory = MemoryVectorStore()

    def add_chunks(self, chunks: list[DocumentChunk]) -> int:
        return self._memory.add_chunks(chunks)

    def search(
        self,
        query: str,
        top_k: int = 2,
        metadata_filter: dict[str, object] | None = None,
    ) -> list[DocumentChunk]:
        return self._memory.search(query, top_k, metadata_filter)

    def delete_by_doc(self, doc_name: str) -> int:
        return self._memory.delete_by_doc(doc_name)

    def delete_by_document_id(self, document_id: str) -> int:
        return self._memory.delete_by_document_id(document_id)

    def clear(self) -> None:
        self._memory.clear()

    def begin_staged_reindex(self) -> None:
        self._memory.begin_staged_reindex()

    def commit_staged_reindex(self) -> None:
        self._memory.commit_staged_reindex()

    def discard_staged_reindex(self) -> None:
        self._memory.discard_staged_reindex()


class TestKnowledgeHubService(unittest.TestCase):
    """Test suite validating KnowledgeHubService persona resolution, assignment CRUD, and search."""

    def setUp(self) -> None:
        self.temp_dir = TemporaryDirectory()
        self.data_dir = Path(self.temp_dir.name)
        self.db_path = self.data_dir / "voice_agent.db"
        self.manifest_path = self.data_dir / "knowledge_documents.json"
        self.store = KnowledgeStore(db_path=self.db_path, legacy_manifest_path=self.manifest_path)
        self.settings = AppSettings()
        self.service = KnowledgeHubService(
            settings=self.settings,
            data_dir=self.data_dir,
            store=self.store,
        )
        self.vector_store = DurableMemoryVectorStore()
        self.service._stores["grand-meridian"] = self.vector_store

    def tearDown(self) -> None:
        self.temp_dir.cleanup()

    # -------------------------------------------------------------------------
    # 1. Active Document Resolution Tests
    # -------------------------------------------------------------------------

    def test_get_active_doc_ids_for_persona_resolution(self) -> None:
        """Tenant-wide documents and assigned documents resolve correctly per persona."""
        tenant = "grand-meridian"

        # Doc 1: Tenant-wide
        doc_tw = self.store.create_document(
            tenant_id=tenant,
            filename="general_rules.md",
            safe_filename="general_rules.md",
            scope="tenant_wide",
        )

        # Doc 2: Persona-specific assigned to hotel_assistant
        doc_ha = self.store.create_document(
            tenant_id=tenant,
            filename="room_rates.md",
            safe_filename="room_rates.md",
            scope="persona_specific",
            assigned_personas=["hotel_assistant"],
        )

        # Doc 3: Persona-specific assigned to concierge
        doc_co = self.store.create_document(
            tenant_id=tenant,
            filename="local_tours.md",
            safe_filename="local_tours.md",
            scope="persona_specific",
            assigned_personas=["concierge"],
        )

        ha_ids = self.service.resolve_active_document_ids_for_persona(tenant, "hotel_assistant")
        co_ids = self.service.resolve_active_document_ids_for_persona(tenant, "concierge")
        rd_ids = self.service.resolve_active_document_ids_for_persona(tenant, "front_desk")

        # hotel_assistant gets tenant-wide + room_rates
        self.assertIn(doc_tw["id"], ha_ids)
        self.assertIn(doc_ha["id"], ha_ids)
        self.assertNotIn(doc_co["id"], ha_ids)

        # concierge gets tenant-wide + local_tours
        self.assertIn(doc_tw["id"], co_ids)
        self.assertIn(doc_co["id"], co_ids)
        self.assertNotIn(doc_ha["id"], co_ids)

        # front_desk only gets tenant-wide
        self.assertIn(doc_tw["id"], rd_ids)
        self.assertNotIn(doc_ha["id"], rd_ids)
        self.assertNotIn(doc_co["id"], rd_ids)

        # Verify backwards-compatible alias
        ha_alias_ids = self.service.get_active_doc_ids_for_persona(tenant, "hotel_assistant")
        self.assertEqual(ha_ids, ha_alias_ids)

    def test_get_active_doc_ids_excludes_disabled_or_failed_documents(self) -> None:
        """Disabled or unindexed documents are strictly excluded from active turn resolution."""
        tenant = "grand-meridian"

        doc = self.store.create_document(
            tenant_id=tenant,
            filename="policy.md",
            safe_filename="policy.md",
            scope="tenant_wide",
        )

        # 1. Enabled and indexed -> included
        ids = self.service.resolve_active_document_ids_for_persona(tenant, "hotel_assistant")
        self.assertIn(doc["id"], ids)

        # 2. Disabled -> excluded
        self.service.set_document_enabled(tenant, doc["id"], is_enabled=False)
        ids = self.service.resolve_active_document_ids_for_persona(tenant, "hotel_assistant")
        self.assertNotIn(doc["id"], ids)

        # Re-enable
        self.service.set_document_enabled(tenant, doc["id"], is_enabled=True)

        # 3. Failed ingestion status -> excluded
        self.store.set_ingestion_status(tenant, doc["id"], ingestion_status="failed")
        ids = self.service.resolve_active_document_ids_for_persona(tenant, "hotel_assistant")
        self.assertNotIn(doc["id"], ids)

        # 4. Indexing status -> excluded
        self.store.set_ingestion_status(tenant, doc["id"], ingestion_status="indexing")
        ids = self.service.resolve_active_document_ids_for_persona(tenant, "hotel_assistant")
        self.assertNotIn(doc["id"], ids)

    # -------------------------------------------------------------------------
    # 2. Assignment & Status CRUD Tests
    # -------------------------------------------------------------------------

    def test_assign_document_to_personas_crud(self) -> None:
        """Assigning document updates scope and persona associations atomically."""
        tenant = "grand-meridian"
        doc = self.store.create_document(
            tenant_id=tenant,
            filename="spa_menu.md",
            safe_filename="spa_menu.md",
            scope="tenant_wide",
        )

        # Assign to specific personas using clean method name
        updated = self.service.update_document_assignments(
            tenant_id=tenant,
            document_id=doc["id"],
            scope=DocumentScope.PERSONA_SPECIFIC,
            assigned_personas=["concierge", "hotel_assistant"],
        )

        self.assertEqual(updated.scope, DocumentScope.PERSONA_SPECIFIC)
        self.assertCountEqual(updated.assigned_personas, ["concierge", "hotel_assistant"])

        # Verify active ids reflect assignment
        self.assertIn(doc["id"], self.service.resolve_active_document_ids_for_persona(tenant, "concierge"))
        self.assertIn(doc["id"], self.service.resolve_active_document_ids_for_persona(tenant, "hotel_assistant"))
        self.assertNotIn(doc["id"], self.service.resolve_active_document_ids_for_persona(tenant, "front_desk"))

        # Verify alias works
        updated_alias = self.service.assign_document_to_personas(
            tenant_id=tenant,
            document_id=doc["id"],
            scope=DocumentScope.PERSONA_SPECIFIC,
            assigned_personas=["concierge"],
        )
        self.assertCountEqual(updated_alias.assigned_personas, ["concierge"])

        # Non-existent doc raises ValueError
        with self.assertRaises(ValueError):
            self.service.update_document_assignments(
                tenant, "non-existent-id", DocumentScope.TENANT_WIDE, []
            )

    def test_set_document_status_toggle(self) -> None:
        """Toggling document status updates the database and response schema."""
        tenant = "grand-meridian"
        doc = self.store.create_document(
            tenant_id=tenant,
            filename="wifi.md",
            safe_filename="wifi.md",
        )

        res = self.service.set_document_enabled(tenant, doc["id"], is_enabled=False)
        self.assertFalse(res.is_enabled)

        res = self.service.set_document_enabled(tenant, doc["id"], is_enabled=True)
        self.assertTrue(res.is_enabled)

        # Check alias
        res_alias = self.service.set_document_status(tenant, doc["id"], is_enabled=False)
        self.assertFalse(res_alias.is_enabled)

        with self.assertRaises(ValueError):
            self.service.set_document_enabled(tenant, "missing-id", is_enabled=True)

    def test_delete_document_cascades_all_resources(self) -> None:
        """Deleting a document purges SQLite, vector chunks, and filesystem upload."""
        tenant = "grand-meridian"
        content = b"High-speed fiber WiFi password is GrandMeridianGuest2026."
        res = self.service.save_and_index(tenant, "wifi_passcode.txt", content)
        doc_id = res.id
        self.assertIsNotNone(doc_id)

        # Verify document exists in vector store and filesystem
        file_path = self.data_dir / "uploads" / tenant / "wifi_passcode.txt"
        self.assertTrue(file_path.exists())
        self.assertTrue(self.vector_store.search("fiber WiFi", metadata_filter={"tenant_id": tenant}))

        # Delete document
        deleted = self.service.delete_document(tenant, doc_id)  # type: ignore[arg-type]
        self.assertTrue(deleted)

        # File and vectors must be gone
        self.assertFalse(file_path.exists())
        self.assertEqual(len(self.vector_store.search("fiber WiFi", metadata_filter={"tenant_id": tenant})), 0)

        # Store record must be gone
        with self.assertRaises(ValueError):
            self.service.get_document(tenant, doc_id)  # type: ignore[arg-type]

        # Deleting non-existent doc returns False
        self.assertFalse(self.service.delete_document(tenant, "non-existent-id"))

    # -------------------------------------------------------------------------
    # 3. Persona Grounding Settings Tests
    # -------------------------------------------------------------------------

    def test_persona_settings_defaults_and_updates(self) -> None:
        """Persona grounding policies default correctly and can be customized."""
        tenant = "grand-meridian"

        # Default settings
        defaults = self.service.get_persona_settings(tenant, "hotel_assistant")
        self.assertEqual(defaults.grounding_mode, GroundingMode.HYBRID_BALANCED)
        self.assertEqual(defaults.min_relevance_score, 0.65)
        self.assertEqual(defaults.max_chunks_per_turn, 3)
        self.assertIsNone(defaults.custom_fallback_spoken)

        # Update settings
        update_payload = PersonaKnowledgeSettingsUpdate(
            grounding_mode=GroundingMode.KNOWLEDGE_STRICT,
            min_relevance_score=0.85,
            max_chunks_per_turn=2,
            custom_fallback_spoken="I can only speak from verified hotel policies.",
        )
        updated = self.service.update_persona_settings(tenant, "hotel_assistant", update_payload)

        self.assertEqual(updated.grounding_mode, GroundingMode.KNOWLEDGE_STRICT)
        self.assertEqual(updated.min_relevance_score, 0.85)
        self.assertEqual(updated.max_chunks_per_turn, 2)
        self.assertEqual(updated.custom_fallback_spoken, "I can only speak from verified hotel policies.")

        # Re-querying should return persisted values
        queried = self.service.get_persona_settings(tenant, "hotel_assistant")
        self.assertEqual(queried.grounding_mode, GroundingMode.KNOWLEDGE_STRICT)
        self.assertEqual(queried.min_relevance_score, 0.85)

    # -------------------------------------------------------------------------
    # 4. Re-Upload Replacement & Versioning Tests
    # -------------------------------------------------------------------------

    def test_reupload_preserves_canonical_uuid_and_increments_version(self) -> None:
        """Re-uploading the same filename updates content, keeps UUID, and increments version."""
        tenant = "grand-meridian"
        first_content = b"Pool hours are 8 AM to 8 PM daily."
        doc1 = self.service.save_and_index(
            tenant,
            "pool_rules.md",
            first_content,
            scope=DocumentScope.PERSONA_SPECIFIC,
            assigned_personas=["concierge"],
        )
        initial_id = doc1.id
        self.assertEqual(doc1.version, 1)
        self.assertEqual(doc1.scope, DocumentScope.PERSONA_SPECIFIC)
        self.assertIn("concierge", doc1.assigned_personas)

        # Check search results have version 1 text
        search1 = self.service.search(tenant, "When does the pool close?", persona_key="concierge")
        self.assertTrue(search1.has_context)
        self.assertIn("8 PM", search1.chunks[0].excerpt)

        # Re-upload with new content and no persona arguments (should preserve existing)
        second_content = b"Pool hours are 7 AM to 10 PM daily in summer."
        doc2 = self.service.save_and_index(tenant, "pool_rules.md", second_content)

        # Assert canonical UUID unchanged
        self.assertEqual(doc2.id, initial_id)
        # Assert version incremented
        self.assertEqual(doc2.version, 2)
        # Assert persona assignments preserved
        self.assertEqual(doc2.scope, DocumentScope.PERSONA_SPECIFIC)
        self.assertIn("concierge", doc2.assigned_personas)

        # Check search results now reflect version 2 text
        search2 = self.service.search(tenant, "When does the pool close?", persona_key="concierge")
        self.assertTrue(search2.has_context)
        self.assertIn("10 PM", search2.chunks[0].excerpt)
        self.assertNotIn("8 PM", search2.chunks[0].excerpt)

    # -------------------------------------------------------------------------
    # 5. Persona-Scoped Retrieval & Search Guardrails
    # -------------------------------------------------------------------------

    def test_search_persona_scoped_isolation(self) -> None:
        """Personas only retrieve chunks from documents they are authorized to access."""
        tenant = "grand-meridian"

        # Doc A: Hotel Assistant only
        self.service.save_and_index(
            tenant,
            "checkout_late.md",
            b"Late checkouts can be requested until 1 PM for an additional $40 fee.",
            scope=DocumentScope.PERSONA_SPECIFIC,
            assigned_personas=["hotel_assistant"],
        )

        # Doc B: Concierge only
        self.service.save_and_index(
            tenant,
            "museum_tickets.md",
            b"The Modern Art Museum is open Tuesday through Sunday with discounted $15 tickets.",
            scope=DocumentScope.PERSONA_SPECIFIC,
            assigned_personas=["concierge"],
        )

        # 1. Hotel assistant searches late checkout -> matches
        res_ha = self.service.search(tenant, "late checkout fee", persona_key="hotel_assistant")
        self.assertTrue(res_ha.has_context)
        self.assertIn("Late checkouts", res_ha.chunks[0].excerpt)

        # 2. Concierge searches late checkout -> blocked / no context
        res_co = self.service.search(tenant, "late checkout fee", persona_key="concierge")
        self.assertFalse(res_co.has_context)
        self.assertEqual(len(res_co.chunks), 0)

        # 3. Concierge searches museum tickets -> matches
        res_co_museum = self.service.search(tenant, "museum tickets", persona_key="concierge")
        self.assertTrue(res_co_museum.has_context)
        self.assertIn("Modern Art Museum", res_co_museum.chunks[0].excerpt)

        # 4. Front desk has NO documents assigned -> returns immediately with fallback
        res_fd = self.service.search(tenant, "museum tickets", persona_key="front_desk")
        self.assertFalse(res_fd.has_context)
        self.assertEqual(len(res_fd.chunks), 0)

    def test_search_respects_custom_fallback_and_score_thresholds(self) -> None:
        """Search uses persona-specific custom fallback when no matches pass score threshold."""
        tenant = "grand-meridian"
        self.service.update_persona_settings(
            tenant,
            "hotel_assistant",
            PersonaKnowledgeSettingsUpdate(
                grounding_mode=GroundingMode.KNOWLEDGE_STRICT,
                min_relevance_score=0.95,  # Impractically high threshold
                custom_fallback_spoken="I cannot find that in my official hotel reference documents.",
            ),
        )

        self.service.save_and_index(
            tenant,
            "parking_policy.md",
            b"Self parking is $25 per night.",
            scope=DocumentScope.TENANT_WIDE,
        )

        # Search should fail threshold and return custom fallback
        res = self.service.search(tenant, "parking cost", persona_key="hotel_assistant")
        self.assertFalse(res.has_context)
        self.assertEqual(res.fallback_spoken, "I cannot find that in my official hotel reference documents.")

    def test_list_documents_retrieves_all_with_assigned_personas(self) -> None:
        """Listing documents returns all documents with populated assigned personas."""
        tenant = "grand-meridian"
        self.service.save_and_index(
            tenant,
            "doc_one.txt",
            b"Content one.",
            scope=DocumentScope.PERSONA_SPECIFIC,
            assigned_personas=["front_desk"],
        )
        self.service.save_and_index(
            tenant,
            "doc_two.txt",
            b"Content two.",
            scope=DocumentScope.TENANT_WIDE,
        )

        docs = self.service.list_documents(tenant)
        self.assertEqual(len(docs), 2)
        doc_map = {d.name: d for d in docs}
        self.assertIn("doc_one.txt", doc_map)
        self.assertIn("doc_two.txt", doc_map)
        self.assertEqual(doc_map["doc_one.txt"].assigned_personas, ["front_desk"])
        self.assertEqual(doc_map["doc_two.txt"].scope, DocumentScope.TENANT_WIDE)


if __name__ == "__main__":
    unittest.main()
