"""
Test manifest for Brain Web test suite.

This file defines all test suites and individual tests organized by feature area.
Used by the test API endpoints to expose test metadata and run tests.
"""
from typing import List, Dict, Any

TEST_SUITES: List[Dict[str, Any]] = [
    {
        "id": "graph-concepts",
        "label": "Graph & Concepts",
        "description": "Tests for concept CRUD, relationships, and graph operations",
        "tests": [
            {
                "id": "test_get_concept_by_id_success",
                "path": "tests/test_concepts_api.py::TestGetConceptById::test_get_concept_by_id_success",
                "description": "Successfully getting a concept by node_id returns correct data.",
                "enabled": True,
            },
            {
                "id": "test_get_concept_by_id_not_found",
                "path": "tests/test_concepts_api.py::TestGetConceptById::test_get_concept_by_id_not_found",
                "description": "Getting a non-existent concept returns 404.",
                "enabled": True,
            },
            {
                "id": "test_get_concept_by_name_success",
                "path": "tests/test_concepts_api.py::TestGetConceptByName::test_get_concept_by_name_success",
                "description": "Successfully getting a concept by name returns correct data.",
                "enabled": True,
            },
            {
                "id": "test_get_concept_by_name_not_found",
                "path": "tests/test_concepts_api.py::TestGetConceptByName::test_get_concept_by_name_not_found",
                "description": "Getting a concept by non-existent name returns 404.",
                "enabled": True,
            },
            {
                "id": "test_create_concept_success",
                "path": "tests/test_concepts_api.py::TestCreateConcept::test_create_concept_success",
                "description": "Creating a new concept returns a valid Concept and persists it in Neo4j.",
                "enabled": True,
            },
            {
                "id": "test_create_concept_missing_required_fields",
                "path": "tests/test_concepts_api.py::TestCreateConcept::test_create_concept_missing_required_fields",
                "description": "Creating a concept with missing required fields returns 422 validation error.",
                "enabled": True,
            },
            {
                "id": "test_create_relationship_success",
                "path": "tests/test_concepts_api.py::TestCreateRelationship::test_create_relationship_success",
                "description": "Creating a relationship between concepts succeeds.",
                "enabled": True,
            },
            {
                "id": "test_create_relationship_by_ids_success",
                "path": "tests/test_concepts_api.py::TestCreateRelationshipByIds::test_create_relationship_by_ids_success",
                "description": "Creating a relationship by node IDs succeeds.",
                "enabled": True,
            },
            {
                "id": "test_get_neighbors_success",
                "path": "tests/test_concepts_api.py::TestGetNeighbors::test_get_neighbors_success",
                "description": "Getting neighbors of a concept returns related concepts.",
                "enabled": True,
            },
            {
                "id": "test_get_neighbors_empty",
                "path": "tests/test_concepts_api.py::TestGetNeighbors::test_get_neighbors_empty",
                "description": "Getting neighbors of a concept with no neighbors returns empty list.",
                "enabled": True,
            },
            {
                "id": "test_delete_concept_success",
                "path": "tests/test_concepts_api.py::TestDeleteConcept::test_delete_concept_success",
                "description": "Deleting a concept succeeds and removes it from Neo4j.",
                "enabled": True,
            },
            {
                "id": "test_get_missing_descriptions_success",
                "path": "tests/test_concepts_api.py::TestGetMissingDescriptions::test_get_missing_descriptions_success",
                "description": "Getting concepts missing descriptions returns list of concepts without descriptions.",
                "enabled": True,
            },
            {
                "id": "test_get_concept_gaps_success",
                "path": "tests/test_concepts_api.py::TestGetConceptGaps::test_get_concept_gaps_success",
                "description": "Getting concept gaps returns concepts that need connections.",
                "enabled": True,
            },
            {
                "id": "test_get_all_graph_data",
                "path": "tests/test_concepts.py::test_get_all_graph_data",
                "description": "Graph API returns nodes and links with consistent schema.",
                "enabled": True,
            },
            {
                "id": "test_get_neighbors_with_relationships",
                "path": "tests/test_concepts.py::test_get_neighbors_with_relationships",
                "description": "Getting neighbors with relationships includes relationship metadata.",
                "enabled": True,
            },
        ],
    },
    {
        "id": "lectures",
        "label": "Lecture Ingestion",
        "description": "Tests for lecture ingestion, CRUD, and lecture steps",
        "tests": [
            {
                "id": "test_ingest_lecture_success",
                "path": "tests/test_lectures_api.py::TestIngestLecture::test_ingest_lecture_success",
                "description": "Ingesting a lecture creates/upserts concepts and relationships from LLM extraction.",
                "enabled": True,
            },
            {
                "id": "test_create_lecture_success",
                "path": "tests/test_lectures_api.py::TestCreateLecture::test_create_lecture_success",
                "description": "Creating a lecture manually succeeds and generates a lecture ID.",
                "enabled": True,
            },
            {
                "id": "test_get_lecture_success",
                "path": "tests/test_lectures_api.py::TestGetLecture::test_get_lecture_success",
                "description": "Getting a lecture by ID returns lecture data.",
                "enabled": True,
            },
            {
                "id": "test_add_lecture_step_success",
                "path": "tests/test_lectures_api.py::TestAddLectureStep::test_add_lecture_step_success",
                "description": "Adding a step to a lecture creates a COVERS relationship with step_order.",
                "enabled": True,
            },
            {
                "id": "test_get_lecture_steps_success",
                "path": "tests/test_lectures_api.py::TestGetLectureSteps::test_get_lecture_steps_success",
                "description": "Getting lecture steps returns steps in correct order.",
                "enabled": True,
            },
            {
                "id": "test_lecture_segments_ingestion",
                "path": "tests/test_lecture_segments.py::TestLectureSegmentsIngestion",
                "description": "Lecture segments are correctly extracted and stored during ingestion.",
                "enabled": True,
            },
            {
                "id": "test_get_lecture_segments",
                "path": "tests/test_lecture_segments.py::TestGetLectureSegments",
                "description": "Getting lecture segments returns segments with correct structure.",
                "enabled": True,
            },
        ],
    },
    {
        "id": "teaching-style",
        "label": "Teaching Style Profile",
        "description": "Tests for teaching style profile management and recomputation",
        "tests": [
            {
                "id": "test_get_teaching_style_success",
                "path": "tests/test_teaching_style_api.py::TestGetTeachingStyle::test_get_teaching_style_success",
                "description": "Returns a stored teaching style profile with all fields.",
                "enabled": True,
            },
            {
                "id": "test_get_teaching_style_default",
                "path": "tests/test_teaching_style_api.py::TestGetTeachingStyle::test_get_teaching_style_default",
                "description": "Returns default teaching style when none exists.",
                "enabled": True,
            },
            {
                "id": "test_update_teaching_style_success",
                "path": "tests/test_teaching_style_api.py::TestUpdateTeachingStyle::test_update_teaching_style_success",
                "description": "Updating teaching style profile persists changes.",
                "enabled": True,
            },
            {
                "id": "test_recompute_teaching_style_success",
                "path": "tests/test_teaching_style_api.py::TestRecomputeTeachingStyle::test_recompute_teaching_style_success",
                "description": "Recomputes profile from recent lectures without errors.",
                "enabled": True,
            },
        ],
    },
    {
        "id": "preferences",
        "label": "User Preferences",
        "description": "Tests for response style, focus areas, user profile, and Notion config",
        "tests": [
            {
                "id": "test_get_response_style_success",
                "path": "tests/test_preferences_api.py::TestResponseStyle::test_get_response_style_success",
                "description": "Getting response style profile returns stored or default profile.",
                "enabled": True,
            },
            {
                "id": "test_update_response_style_success",
                "path": "tests/test_preferences_api.py::TestResponseStyle::test_update_response_style_success",
                "description": "Updating response style profile persists changes.",
                "enabled": True,
            },
            {
                "id": "test_focus_areas_list",
                "path": "tests/test_preferences_api.py::TestFocusAreas::test_focus_areas_list",
                "description": "Listing focus areas returns all focus areas.",
                "enabled": True,
            },
            {
                "id": "test_focus_areas_create",
                "path": "tests/test_preferences_api.py::TestFocusAreas::test_focus_areas_create",
                "description": "Creating a focus area succeeds and persists it.",
                "enabled": True,
            },
            {
                "id": "test_user_profile_get",
                "path": "tests/test_preferences_api.py::TestUserProfile::test_user_profile_get",
                "description": "Getting user profile returns stored or default profile.",
                "enabled": True,
            },
            {
                "id": "test_notion_config_get",
                "path": "tests/test_preferences_api.py::TestNotionConfig::test_notion_config_get",
                "description": "Getting Notion configuration returns stored config.",
                "enabled": True,
            },
        ],
    },
    {
        "id": "notion-sync",
        "label": "Notion Sync",
        "description": "Tests for Notion synchronization, state management, and page conversion",
        "tests": [
            {
                "id": "test_state_management",
                "path": "tests/test_notion_sync.py::TestStateManagement",
                "description": "Timestamp state management (load/save) works correctly.",
                "enabled": True,
            },
            {
                "id": "test_find_updated_pages",
                "path": "tests/test_notion_sync.py::TestFindUpdatedPages",
                "description": "Finding updated Notion pages since last sync works correctly.",
                "enabled": True,
            },
            {
                "id": "test_page_to_lecture",
                "path": "tests/test_notion_sync.py::TestPageToLecture",
                "description": "Converting Notion page to lecture creates correct structure.",
                "enabled": True,
            },
            {
                "id": "test_sync_once",
                "path": "tests/test_notion_sync.py::TestSyncOnce",
                "description": "Full sync cycle processes updated pages correctly.",
                "enabled": True,
            },
        ],
    },
    {
        "id": "admin",
        "label": "Admin & Utilities",
        "description": "Tests for admin endpoints, import/export, and Notion admin",
        "tests": [
            {
                "id": "test_admin_import",
                "path": "tests/test_admin.py::test_admin_import",
                "description": "Admin CSV import endpoint triggers import successfully.",
                "enabled": True,
            },
            {
                "id": "test_admin_export",
                "path": "tests/test_admin.py::test_admin_export",
                "description": "Admin CSV export endpoint triggers export successfully.",
                "enabled": True,
            },
            {
                "id": "test_admin_import_api",
                "path": "tests/test_admin_api.py::TestAdminImport",
                "description": "Admin import API endpoint works correctly.",
                "enabled": True,
            },
            {
                "id": "test_admin_export_api",
                "path": "tests/test_admin_api.py::TestAdminExport",
                "description": "Admin export API endpoint works correctly.",
                "enabled": True,
            },
            {
                "id": "test_admin_sync_notion",
                "path": "tests/test_admin_api.py::TestAdminSyncNotion",
                "description": "Admin Notion sync endpoint triggers sync successfully.",
                "enabled": True,
            },
            {
                "id": "test_admin_notion_pages",
                "path": "tests/test_admin_api.py::TestAdminNotionPages",
                "description": "Admin Notion pages listing works correctly.",
                "enabled": True,
            },
        ],
    },
    {
        "id": "ai",
        "label": "AI & Chat",
        "description": "Tests for AI chat endpoints",
        "tests": [
            {
                "id": "test_ai_chat",
                "path": "tests/test_ai.py::test_ai_chat",
                "description": "AI chat endpoint returns response for valid message.",
                "enabled": True,
            },
            {
                "id": "test_ai_chat_empty_message",
                "path": "tests/test_ai.py::test_ai_chat_empty_message",
                "description": "AI chat endpoint handles empty message correctly.",
                "enabled": True,
            },
        ],
    },
    {
        "id": "core",
        "label": "Core & Internal",
        "description": "Tests for core functionality, error handling, and root endpoints",
        "tests": [
            {
                "id": "test_read_root",
                "path": "tests/test_root.py::test_read_root",
                "description": "Root endpoint returns health check status.",
                "enabled": True,
            },
            {
                "id": "test_unhandled_exceptions",
                "path": "tests/test_error_logging.py::TestUnhandledExceptions",
                "description": "Unhandled exceptions are logged and return sanitized error messages.",
                "enabled": True,
            },
            {
                "id": "test_http_exceptions",
                "path": "tests/test_error_logging.py::TestHTTPExceptions",
                "description": "HTTP exceptions are logged with appropriate levels.",
                "enabled": True,
            },
            {
                "id": "test_validation_errors",
                "path": "tests/test_error_logging.py::TestValidationErrors",
                "description": "Validation errors return 422 with error details.",
                "enabled": True,
            },
        ],
    },
]
