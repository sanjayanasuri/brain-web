# backend/services/orchestrator.py
"""
Intelligent task orchestrator for adaptive learning system.
Phase 3: Selects tasks based on mode inertia, user performance, and continuity.
"""

from typing import Dict, List, Optional
from services.task_generator import get_task_types, get_task_metadata


def select_next_task(
    session_id: str,
    user_performance: Dict[str, float],
    current_mode: str,
    mode_inertia: float,
    recent_tasks: List[str],
    threshold: float = 0.7
) -> str:
    """
    Select the optimal next task using intelligent scoring.
    
    Args:
        session_id: Session UUID
        user_performance: Dict of {task_type: avg_score}
        current_mode: Current mode ('explain', 'typing', 'voice')
        mode_inertia: Current inertia level (0-1)
        recent_tasks: List of recent task types (most recent first)
        threshold: Inertia threshold for mode switching resistance
    
    Returns:
        Selected task type
    """
    
    available_tasks = get_task_types()
    scores = {}
    
    for task_type in available_tasks:
        # Get task metadata
        task_meta = get_task_metadata(task_type)
        
        # 1. Base score: user's average performance on this task type
        base_score = user_performance.get(task_type, 0.5)  # Default 0.5 for new users
        
        # 2. Continuity score: does task support current mode?
        continuity_score = calculate_continuity_score(
            task_type=task_type,
            current_mode=current_mode,
            compatible_modes=task_meta['compatible_modes']
        )
        
        # 3. Disruption penalty: cost of switching modes
        disruption_penalty = calculate_disruption_penalty(
            task_type=task_type,
            current_mode=current_mode,
            mode_inertia=mode_inertia,
            compatible_modes=task_meta['compatible_modes'],
            disruption_cost=task_meta['disruption_cost'],
            threshold=threshold
        )
        
        # 4. Recency penalty: avoid repetition
        recency_penalty = calculate_recency_penalty(task_type, recent_tasks)
        
        # Final weighted score
        final_score = (
            (base_score * 0.4) +
            (continuity_score * 0.3) -
            (disruption_penalty * 0.2) -
            (recency_penalty * 0.1)
        )
        
        scores[task_type] = final_score
    
    # Select task with highest score
    selected_task = max(scores, key=scores.get)
    
    # Log for debugging
    print(f"[Orchestrator] Scores: {scores}")
    print(f"[Orchestrator] Selected: {selected_task} (score: {scores[selected_task]:.3f})")
    
    return selected_task


def calculate_continuity_score(
    task_type: str,
    current_mode: str,
    compatible_modes: List[str]
) -> float:
    """
    Calculate continuity score based on mode compatibility.
    
    Returns:
        1.0 if task supports current mode, 0.3 otherwise
    """
    if current_mode in compatible_modes:
        return 1.0
    else:
        return 0.3


def calculate_disruption_penalty(
    task_type: str,
    current_mode: str,
    mode_inertia: float,
    compatible_modes: List[str],
    disruption_cost: float,
    threshold: float
) -> float:
    """
    Calculate disruption penalty for mode switching.
    
    Higher inertia = higher penalty for switching modes.
    
    Returns:
        Penalty value (0-1)
    """
    # If task is compatible with current mode, no disruption
    if current_mode in compatible_modes:
        return 0.0
    
    # If inertia is above threshold, resist mode switch
    if mode_inertia > threshold:
        # High inertia = high penalty
        return disruption_cost * mode_inertia
    else:
        # Low inertia = reduced penalty
        return disruption_cost * 0.5


def calculate_recency_penalty(task_type: str, recent_tasks: List[str]) -> float:
    """
    Calculate recency penalty to avoid repetition.
    
    Args:
        task_type: Task type to evaluate
        recent_tasks: List of recent task types (most recent first)
    
    Returns:
        Penalty value (0-0.5)
    """
    if not recent_tasks:
        return 0.0
    
    # Heavy penalty if task was just used
    if len(recent_tasks) > 0 and task_type == recent_tasks[0]:
        return 0.5
    
    # Medium penalty if task was used in last 2
    if len(recent_tasks) > 1 and task_type in recent_tasks[:2]:
        return 0.3
    
    # Light penalty if task was used in last 3
    if len(recent_tasks) > 2 and task_type in recent_tasks[:3]:
        return 0.1
    
    return 0.0


def should_switch_mode(
    current_mode: str,
    selected_task_type: str,
    mode_inertia: float,
    threshold: float = 0.7
) -> bool:
    """
    Determine if mode should switch based on selected task and inertia.
    
    Args:
        current_mode: Current mode
        selected_task_type: Selected task type
        mode_inertia: Current inertia level
        threshold: Inertia threshold
    
    Returns:
        True if mode should switch, False otherwise
    """
    task_meta = get_task_metadata(selected_task_type)
    
    # If task is compatible with current mode, don't switch
    if current_mode in task_meta['compatible_modes']:
        return False
    
    # If inertia is below threshold, allow switch
    if mode_inertia < threshold:
        return True
    
    # High inertia: resist switch
    return False


def get_recommended_mode(task_type: str) -> str:
    """
    Get the recommended mode for a task type.
    
    Args:
        task_type: Task type
    
    Returns:
        Recommended mode ('explain', 'typing', 'voice')
    """
    task_meta = get_task_metadata(task_type)
    
    # Return first compatible mode as default
    if task_meta['compatible_modes']:
        return task_meta['compatible_modes'][0]
    
    return 'explain'


def calculate_new_inertia(
    current_inertia: float,
    task_score: float,
    mode_switched: bool
) -> float:
    """
    Calculate new inertia based on task performance and mode switching.
    
    Args:
        current_inertia: Current inertia level (0-1)
        task_score: Composite score from task attempt (0-1)
        mode_switched: Whether mode was switched for this task
    
    Returns:
        New inertia level (0-1)
    """
    # If mode switched, reset to mid-level
    if mode_switched:
        return 0.5
    
    # Increase inertia on success, decrease on struggle
    if task_score >= 0.7:
        delta = 0.1
    elif task_score >= 0.5:
        delta = 0.05
    else:
        delta = -0.05
    
    # Clamp to [0, 1]
    new_inertia = max(0.0, min(1.0, current_inertia + delta))
    
    return new_inertia
