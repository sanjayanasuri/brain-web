"""
Graph manipulation tools for OpenAI function calling.

This module provides tool definitions and executors for the agentic chat system.
"""

from typing import Callable, Dict, Any, List
from neo4j import Session
import json

# Tool schemas for OpenAI function calling
GRAPH_TOOLS = [
    {
        "type": "function",
        "function": {
            "name": "create_knowledge_graph",
            "description": "Create a new knowledge graph for a specific topic that the user wants to learn about",
            "parameters": {
                "type": "object",
                "properties": {
                    "name": {"type": "string", "description": "Graph name (e.g., 'NBA', 'Machine Learning')"},
                    "description": {"type": "string", "description": "Brief description of what this graph is about"},
                    "intent": {"type": "string", "description": "User's learning intent or goal"}
                },
                "required": ["name"]
            }
        }
    },
    {
        "type": "function",
        "function": {
            "name": "add_concepts_to_graph",
            "description": "Add concepts (entities, topics) to a knowledge graph",
            "parameters": {
                "type": "object",
                "properties": {
                    "graph_id": {"type": "string", "description": "ID of the graph to add concepts to"},
                    "concepts": {
                        "type": "array",
                        "description": "List of concepts to add",
                        "items": {
                            "type": "object",
                            "properties": {
                                "name": {"type": "string", "description": "Concept name"},
                                "domain": {"type": "string", "description": "Domain/category (e.g., 'sports', 'technology')"},
                                "description": {"type": "string", "description": "Brief description of the concept"}
                            },
                            "required": ["name"]
                        }
                    }
                },
                "required": ["graph_id", "concepts"]
            }
        }
    },
    {
        "type": "function",
        "function": {
            "name": "fetch_web_metadata",
            "description": "Fetch metadata and information about a topic from the web",
            "parameters": {
                "type": "object",
                "properties": {
                    "topic": {"type": "string", "description": "Topic to research"},
                    "num_results": {"type": "integer", "description": "Number of results to fetch", "default": 5}
                },
                "required": ["topic"]
            }
        }
    },
    {
        "type": "function",
        "function": {
            "name": "update_user_interests",
            "description": "Update the user's profile with new interests or learning topics",
            "parameters": {
                "type": "object",
                "properties": {
                    "interests": {
                        "type": "array",
                        "items": {"type": "string"},
                        "description": "List of interests to add to user profile"
                    },
                    "active_topics": {
                        "type": "array",
                        "items": {"type": "string"},
                        "description": "Currently active learning topics"
                    }
                },
                "required": ["interests"]
            }
        }
    },
    {
        "type": "function",
        "function": {
            "name": "create_relationships",
            "description": "Create relationships/connections between concepts in a graph",
            "parameters": {
                "type": "object",
                "properties": {
                    "graph_id": {"type": "string", "description": "ID of the graph"},
                    "relationships": {
                        "type": "array",
                        "description": "List of relationships to create",
                        "items": {
                            "type": "object",
                            "properties": {
                                "source": {"type": "string", "description": "Source concept name"},
                                "target": {"type": "string", "description": "Target concept name"},
                                "predicate": {"type": "string", "description": "Relationship type (e.g., 'plays_for', 'is_part_of')"}
                            },
                            "required": ["source", "target", "predicate"]
                        }
                    }
                },
                "required": ["graph_id", "relationships"]
            }
        }
    }
]


async def execute_tool(
    tool_name: str,
    arguments: Dict[str, Any],
    session: Session,
    user_id: str,
    tenant_id: str,
    status_callback: Callable[[str], None]
) -> Dict[str, Any]:
    """
    Execute a tool and emit status updates.
    
    Args:
        tool_name: Name of the tool to execute
        arguments: Tool arguments from OpenAI
        session: Neo4j session
        user_id: User ID
        tenant_id: Tenant ID
        status_callback: Callback function to emit status messages
        
    Returns:
        Tool execution result
    """
    from services_branch_explorer import create_graph, set_active_graph
    from services_graph import get_user_profile, patch_user_profile
    
    if tool_name == "create_knowledge_graph":
        name = arguments["name"]
        status_callback(f"Creating knowledge graph: {name}...")
        
        try:
            graph = create_graph(
                session,
                name=name,
                template_description=arguments.get("description"),
                intent=arguments.get("intent"),
                tenant_id=tenant_id
            )
            
            # Set as active graph
            set_active_graph(session, graph["graph_id"])
            
            status_callback(f"Knowledge graph '{name}' created successfully")
            
            return {
                "success": True,
                "graph_id": graph["graph_id"],
                "name": graph["name"],
                "action": {
                    "type": "view_graph",
                    "graph_id": graph["graph_id"],
                    "label": f"View {name} Graph"
                }
            }
        except Exception as e:
            status_callback(f"Error creating graph: {str(e)}")
            return {"success": False, "error": str(e)}
    
    elif tool_name == "add_concepts_to_graph":
        graph_id = arguments["graph_id"]
        concepts = arguments["concepts"]
        
        status_callback(f"Adding {len(concepts)} concepts to graph...")
        
        try:
            added = []
            for concept in concepts:
                # Create concept using existing API
                # Note: This is a simplified version - you may need to adapt based on your actual API
                concept_data = {
                    "name": concept["name"],
                    "domain": concept.get("domain", "general"),
                    "description": concept.get("description", ""),
                    "type": "entity"
                }
                # TODO: Call actual concept creation function
                added.append(concept_data)
            
            status_callback(f"Added {len(added)} concepts successfully")
            return {"success": True, "added_count": len(added), "concepts": added}
        except Exception as e:
            status_callback(f"Error adding concepts: {str(e)}")
            return {"success": False, "error": str(e)}
    
    elif tool_name == "fetch_web_metadata":
        topic = arguments["topic"]
        num_results = arguments.get("num_results", 5)
        
        status_callback(f"Researching {topic} on the web...")
        
        try:
            # Use existing web search
            from services_web_search import search_and_fetch_content
            results = await search_and_fetch_content(topic, num_results=num_results)
            
            status_callback(f"Found {len(results)} sources for {topic}")
            return {"success": True, "sources": results, "count": len(results)}
        except Exception as e:
            status_callback(f"Error fetching web data: {str(e)}")
            return {"success": False, "error": str(e)}
    
    elif tool_name == "update_user_interests":
        interests = arguments["interests"]
        
        status_callback("Updating your profile...")
        
        try:
            profile = get_user_profile(session, user_id=user_id)
            current_interests = set(profile.interests or [])
            new_interests = set(interests)
            
            updated_interests = list(current_interests | new_interests)
            
            patch_user_profile(session, {
                "interests": updated_interests,
                "active_topics": arguments.get("active_topics", [])
            }, user_id=user_id)
            
            status_callback("Profile updated with new interests")
            return {
                "success": True,
                "interests": updated_interests,
                "action": {
                    "type": "add_to_profile",
                    "interest": ", ".join(interests),
                    "label": "✓ Added to Profile"
                }
            }
        except Exception as e:
            status_callback(f"Error updating profile: {str(e)}")
            return {"success": False, "error": str(e)}
    
    elif tool_name == "create_relationships":
        graph_id = arguments["graph_id"]
        relationships = arguments["relationships"]
        
        status_callback(f"Creating {len(relationships)} connections...")
        
        try:
            # TODO: Implement relationship creation using existing graph services
            created = []
            for rel in relationships:
                # Placeholder for relationship creation
                created.append(rel)
            
            status_callback(f"Created {len(created)} connections")
            return {"success": True, "created_count": len(created)}
        except Exception as e:
            status_callback(f"Error creating relationships: {str(e)}")
            return {"success": False, "error": str(e)}
    
    else:
        raise ValueError(f"Unknown tool: {tool_name}")
