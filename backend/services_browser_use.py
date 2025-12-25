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


class BrowserUseAPIError(Exception):
    """Custom exception for Browser Use API errors that preserves HTTP status codes."""
    def __init__(self, message: str, status_code: int = None, response_text: str = None):
        super().__init__(message)
        self.status_code = status_code
        self.response_text = response_text


def execute_skill(skill_id: str, parameters: Dict[str, Any]) -> Dict[str, Any]:
    """
    Execute a Browser Use skill with the given parameters.
    
    Args:
        skill_id: The ID of the skill to execute
        parameters: Dictionary of parameters to pass to the skill
        
    Returns:
        Dictionary containing the skill execution result
        
    Raises:
        BrowserUseAPIError: If the API request fails (preserves HTTP status code)
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
        
        # If request failed, log response text and raise with preserved status code
        if not r.ok:
            response_text = r.text[:2000] if r.text else "(empty response)"
            logger.error(
                f"Browser Use skill execution failed with status {r.status_code}. "
                f"Response (first 2000 chars): {response_text}"
            )
            
            # Create a more descriptive error message
            error_msg = f"{r.status_code} Client Error: {r.reason or 'Bad Request'}"
            if response_text and response_text != "(empty response)":
                # Try to extract error detail from JSON response if available
                try:
                    error_json = r.json()
                    if isinstance(error_json, dict) and "detail" in error_json:
                        error_msg = f"{r.status_code} {r.reason or 'Error'}: {error_json['detail']}"
                    elif isinstance(error_json, dict) and "message" in error_json:
                        error_msg = f"{r.status_code} {r.reason or 'Error'}: {error_json['message']}"
                except (ValueError, KeyError):
                    # If not JSON or no detail field, use the response text
                    error_msg = f"{r.status_code} {r.reason or 'Error'}: {response_text[:500]}"
            
            raise BrowserUseAPIError(
                error_msg,
                status_code=r.status_code,
                response_text=response_text
            )
        
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
            
    except BrowserUseAPIError:
        # Re-raise our custom error as-is
        raise
    except requests.exceptions.Timeout:
        logger.error(f"Browser Use skill execution timed out after 180 seconds")
        raise BrowserUseAPIError("Request timed out after 180 seconds", status_code=504)
    except requests.exceptions.HTTPError as e:
        # Handle other HTTP errors
        status_code = e.response.status_code if e.response else None
        response_text = e.response.text[:2000] if e.response and e.response.text else None
        logger.error(f"Browser Use skill execution HTTP error: {str(e)}")
        raise BrowserUseAPIError(
            f"HTTP error: {str(e)}",
            status_code=status_code,
            response_text=response_text
        )
    except requests.exceptions.RequestException as e:
        logger.error(f"Browser Use skill execution request failed: {str(e)}")
        raise BrowserUseAPIError(f"Request failed: {str(e)}", status_code=None)

