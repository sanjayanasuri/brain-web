# backend/services/task_generator.py
"""
Task generator service for adaptive learning system.
Generates task prompts and rubrics based on task type and context.
"""

from typing import Dict, Any, List
from models.study import ContextPack, TaskSpec
import uuid


# Task templates with prompts and rubrics
TASK_TEMPLATES = {
    "clarify": {
        "prompt_template": "Explain the selected content in your own words, using the provided context.\n\nSelected Content:\n{selection_content}\n\nContext:\n{context_summary}",
        "rubric": {
            "grounding": {
                "weight": 0.3,
                "description": "Are claims supported by the provided context? Penalty for unsupported assertions."
            },
            "coherence": {
                "weight": 0.25,
                "description": "Is there clear logical flow in the explanation?"
            },
            "completeness": {
                "weight": 0.2,
                "description": "Does the response address the main concepts in the selection?"
            },
            "transfer": {
                "weight": 0.15,
                "description": "Does the response show understanding beyond simple paraphrasing?"
            },
            "effort": {
                "weight": 0.1,
                "description": "Is there sufficient detail and thoughtfulness?"
            }
        },
        "compatible_modes": ["explain", "typing"],
        "disruption_cost": 0.1
    },
    
    "define_example": {
        "prompt_template": "Define the term '{term}' and provide an example from the context or your own experience.\n\nContext:\n{context_summary}",
        "rubric": {
            "grounding": {
                "weight": 0.3,
                "description": "Does the definition match the context?"
            },
            "coherence": {
                "weight": 0.2,
                "description": "Is the definition clear and well-structured?"
            },
            "completeness": {
                "weight": 0.2,
                "description": "Are both definition and example provided?"
            },
            "transfer": {
                "weight": 0.2,
                "description": "Does the example demonstrate understanding?"
            },
            "effort": {
                "weight": 0.1,
                "description": "Is the example detailed and relevant?"
            }
        },
        "compatible_modes": ["explain", "typing"],
        "disruption_cost": 0.1
    },
    
    "explain_back": {
        "prompt_template": "Teach the concept of '{concept}' to someone who has never heard of it before. Use simple language and examples.\n\nContext (for reference):\n{context_summary}",
        "rubric": {
            "grounding": {
                "weight": 0.25,
                "description": "Is the explanation grounded in accurate information?"
            },
            "coherence": {
                "weight": 0.3,
                "description": "Is the explanation appropriate for a beginner audience?"
            },
            "completeness": {
                "weight": 0.2,
                "description": "Does it cover the key aspects of the concept?"
            },
            "transfer": {
                "weight": 0.15,
                "description": "Are analogies or examples used effectively?"
            },
            "effort": {
                "weight": 0.1,
                "description": "Is there thoughtful simplification for the audience?"
            }
        },
        "compatible_modes": ["explain", "typing"],
        "disruption_cost": 0.3
    }
}


def generate_task(
    session_id: str,
    task_type: str,
    context_pack: ContextPack,
    difficulty: float = 0.5,  # NEW: Difficulty level (0-1)
    **kwargs
) -> TaskSpec:
    """
    Generate a task specification based on task type and context.
    
    Args:
        session_id: ID of the study session
        task_type: Type of task ('clarify', 'define_example', 'explain_back')
        context_pack: Context pack with excerpts and concepts
        difficulty: Difficulty level (0-1), default 0.5 (intermediate)
        **kwargs: Additional parameters (term, concept, etc.)
    
    Returns:
        TaskSpec with prompt, rubric, and metadata
    """
    
    if task_type not in TASK_TEMPLATES:
        raise ValueError(f"Unknown task type: {task_type}")
    
    template = TASK_TEMPLATES[task_type]
    
    # Build context summary from excerpts
    context_summary = "\n\n".join([
        f"[{e.source_type.upper()}] {e.content[:300]}..."
        for e in context_pack.excerpts[:3]  # Top 3 excerpts
    ])
    
    # Get selection content (first excerpt is the selection)
    selection_content = context_pack.excerpts[0].content if context_pack.excerpts else ""
    
    # Try to use difficulty-specific template if available
    try:
        from services.difficulty_engine import get_difficulty_template, get_difficulty_label
        
        # Get difficulty-specific prompt
        difficulty_context = {
            "term": kwargs.get("term", "the selected term"),
            "concept": kwargs.get("concept", "this concept"),
            "term1": kwargs.get("term1", "concept A"),
            "term2": kwargs.get("term2", "concept B"),
        }
        
        prompt = get_difficulty_template(task_type, difficulty, difficulty_context)
        
        # Add context to prompt
        prompt += f"\n\nContext (for reference):\n{context_summary}"
        
        # Add difficulty level to metadata
        difficulty_label = get_difficulty_label(difficulty)
        
    except (ImportError, KeyError):
        # Fallback to standard template if difficulty engine not available
        prompt_vars = {
            "selection_content": selection_content,
            "context_summary": context_summary,
            "term": kwargs.get("term", "the selected term"),
            "concept": kwargs.get("concept", "this concept"),
        }
        
        prompt = template["prompt_template"].format(**prompt_vars)
        difficulty_label = "intermediate"
    
    # Create task spec
    task_spec = TaskSpec(
        task_id=str(uuid.uuid4()),
        task_type=task_type,
        prompt=prompt,
        rubric_json=template["rubric"],
        context_pack=context_pack,
        compatible_modes=template["compatible_modes"],
        disruption_cost=template["disruption_cost"]
    )
    
    return task_spec


def get_task_types() -> List[str]:
    """Get list of available task types."""
    return list(TASK_TEMPLATES.keys())


def get_task_metadata(task_type: str) -> Dict[str, Any]:
    """Get metadata for a specific task type."""
    if task_type not in TASK_TEMPLATES:
        raise ValueError(f"Unknown task type: {task_type}")
    
    template = TASK_TEMPLATES[task_type]
    return {
        "task_type": task_type,
        "compatible_modes": template["compatible_modes"],
        "disruption_cost": template["disruption_cost"],
        "rubric_dimensions": list(template["rubric"].keys())
    }
