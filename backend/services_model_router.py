import os
import logging
from typing import List, Dict, Any, Optional, Union, Generator
from openai import OpenAI
from config import OPENAI_API_KEY

logger = logging.getLogger("brain_web")

# Task Types
TASK_CHAT_FAST = "chat_fast"       # gpt-4o-mini
TASK_CHAT_SMART = "chat_smart"     # gpt-4o
TASK_REASONING = "reasoning"       # o1-mini or o1-preview (if available)
TASK_VOICE = "voice"               # gpt-4o-mini (low latency)
TASK_SYNTHESIS = "synthesis"       # gpt-4o

# Default Models
DEFAULT_MODELS = {
    TASK_CHAT_FAST: "gpt-4o-mini",
    TASK_CHAT_SMART: "gpt-4o",
    TASK_REASONING: "gpt-4o", # Fallback until o1 is broadly available/configured
    TASK_VOICE: "gpt-4o-mini",
    TASK_SYNTHESIS: "gpt-4o",
}

class ModelRouter:
    def __init__(self):
        self.api_key = OPENAI_API_KEY
        self.client = None
        if self.api_key:
            self.client = OpenAI(api_key=self.api_key.strip().strip('"').strip("'"))
        else:
            logger.warning("OPENAI_API_KEY not found. ModelRouter will fail on inference.")

    def get_model_for_task(self, task_type: str, user_tier: str = "free") -> str:
        """
        Selects the appropriate model based on task and user tier.
        Future: 'pro' users could get gpt-4o for everything.
        """
        # Simple for now: just map task to default model
        return DEFAULT_MODELS.get(task_type, "gpt-4o-mini")

    def completion(
        self,
        messages: List[Dict[str, str]],
        task_type: str = TASK_CHAT_FAST,
        user_id: Optional[str] = None,
        temperature: float = 0.7,
        max_tokens: Optional[int] = None,
        stream: bool = False,
        response_format: Optional[Dict[str, Any]] = None,
        tools: Optional[List[Dict[str, Any]]] = None,
        tool_choice: Optional[str] = None
    ) -> Union[str, Generator[Any, None, None]]:
        """
        Wrapper for OpenAI chat completion.
        """
        if not self.client:
            raise ValueError("OpenAI Client not initialized. Check OPENAI_API_KEY.")

        model = self.get_model_for_task(task_type)
        
        # O1 models don't support system messages in the same way, or temperature
        # For now, we assume standard GPT-4o arch.
        
        kwargs = {
            "model": model,
            "messages": messages,
            "stream": stream,
        }
        
        if temperature is not None:
             kwargs["temperature"] = temperature
        if max_tokens is not None:
            kwargs["max_tokens"] = max_tokens
        if response_format is not None:
            kwargs["response_format"] = response_format
        if tools is not None:
            kwargs["tools"] = tools
        if tool_choice is not None:
            kwargs["tool_choice"] = tool_choice

        try:
            response = self.client.chat.completions.create(**kwargs)
            
            if stream:
                return response # Return the generator
            else:
                return response.choices[0].message.content
        except Exception as e:
            logger.error(f"ModelRouter completion failed: {e}")
            raise e

# Singleton instance
model_router = ModelRouter()
