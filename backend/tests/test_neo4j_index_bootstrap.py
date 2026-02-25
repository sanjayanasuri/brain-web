import services_branch_explorer


def test_ensure_schema_constraints_creates_services_graph_indexes(mock_neo4j_session, monkeypatch):
    monkeypatch.setattr(services_branch_explorer, "_SCHEMA_INITIALIZED", False)

    services_branch_explorer.ensure_schema_constraints(mock_neo4j_session)

    queries = [str(call.args[0]) for call in mock_neo4j_session.run.call_args_list]

    expected_index_names = [
        "artifact_artifact_id_index",
        "concept_url_slug_index",
        "source_graph_url_index",
        "meta_key_index",
        "user_profile_id_index",
        "focus_area_id_index",
        "answer_record_answer_id_index",
        "feedback_answer_id_index",
        "revision_answer_id_index",
        "style_feedback_feedback_id_index",
        "conversation_summary_id_index",
        "conversation_summary_user_tenant_timestamp_index",
        "learning_topic_id_index",
        "learning_topic_last_mentioned_index",
        "lecture_segment_segment_id_index",
        "analogy_tenant_label_lower_index",
    ]

    for index_name in expected_index_names:
        assert any(index_name in query for query in queries), f"Expected {index_name} to be created"

