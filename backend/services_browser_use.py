"""
Service functions for Browser Use Cloud API integration.

Browser Use Cloud provides browser automation skills that can be executed
to perform web research and data extraction tasks.
"""

import logging
import requests
from typing import Any, Dict
from config import BROWSER_USE_API_KEY, BROWSER_USE_BASE

logger = logging.getLogger("brain_web")


def execute_skill(skill_id: str, parameters: Dict[str, Any]) -> Dict[str, Any]:
    """
    Execute a Browser Use skill with the given parameters.
    
    Args:
        skill_id: The ID of the skill to execute
        parameters: Dictionary of parameters to pass to the skill
        
    Returns:
        Dictionary containing the skill execution result
        
    Raises:
        requests.HTTPError: If the API request fails
        ValueError: If BROWSER_USE_API_KEY is not configured
    """
    if not BROWSER_USE_API_KEY:
        raise ValueError("BROWSER_USE_API_KEY environment variable is not set")
    
    # Log parameters being sent (without API keys)
    logger.info(f"Executing Browser Use skill {skill_id} with parameters: {parameters}")
    
    try:
        r = requests.post(
            f"{BROWSER_USE_BASE}/skills/{skill_id}/execute",
            headers={
                "X-Browser-Use-API-Key": BROWSER_USE_API_KEY,
                "Content-Type": "application/json",
            },
            json={"parameters": parameters},
            timeout=180,
        )
        
        # Log HTTP status code
        logger.info(f"Browser Use skill execution returned status code: {r.status_code}")
        
        # If request failed, log response text (first 2000 chars)
        if not r.ok:
            response_text = r.text[:2000] if r.text else "(empty response)"
            logger.error(
                f"Browser Use skill execution failed with status {r.status_code}. "
                f"Response (first 2000 chars): {response_text}"
            )
        
        r.raise_for_status()
        
        # Try to parse JSON and log if parsing fails
        try:
            result = r.json()
            logger.info(f"Browser Use skill execution succeeded. Response keys: {list(result.keys()) if isinstance(result, dict) else 'not a dict'}")
            return result
        except ValueError as e:
            response_text = r.text[:2000] if r.text else "(empty response)"
            logger.error(
                f"Failed to parse JSON response from Browser Use skill. "
                f"Parse error: {str(e)}. Response (first 2000 chars): {response_text}"
            )
            raise ValueError(f"Invalid JSON response from Browser Use API: {str(e)}") from e
            
    except requests.exceptions.Timeout:
        logger.error(f"Browser Use skill execution timed out after 180 seconds")
        raise
    except requests.exceptions.RequestException as e:
        logger.error(f"Browser Use skill execution request failed: {str(e)}")
        raise

