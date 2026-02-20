import os
import logging
from typing import List, Dict, Any, Optional, Union, Generator
from openai import OpenAI
from config import OPENAI_API_KEY

logger = logging.getLogger("brain_web")

# ---------------------------------------------------------------------------
# Task type constants — import these everywhere instead of raw strings
# ---------------------------------------------------------------------------
TASK_CHAT_FAST = "chat_fast"    # Low-latency, cheaper model
TASK_CHAT_SMART = "chat_smart"  # Capable model for complex reasoning
TASK_REASONING = "reasoning"    # Heavy reasoning (o1/o3 when available)
TASK_VOICE = "voice"            # Ultra-low-latency for real-time voice
TASK_SYNTHESIS = "synthesis"    # Session/topic synthesis, fog-clearing

# ---------------------------------------------------------------------------
# Model mapping — all overridable via env vars, zero need to redeploy to
# swap a model version.
# ---------------------------------------------------------------------------
DEFAULT_MODELS: Dict[str, str] = {
    TASK_CHAT_FAST:  os.getenv("MODEL_CHAT_FAST",  "gpt-4o-mini"),
    TASK_CHAT_SMART: os.getenv("MODEL_CHAT_SMART", "gpt-4o"),
    TASK_REASONING:  os.getenv("MODEL_REASONING",  "gpt-4o"),      # swap to o3-mini when ready
    TASK_VOICE:      os.getenv("MODEL_VOICE",      "gpt-4o-mini"),  # latency-critical
    TASK_SYNTHESIS:  os.getenv("MODEL_SYNTHESIS",  "gpt-4o"),
}

# Fallback model used if a task type has no entry in DEFAULT_MODELS
_FALLBACK_MODEL = os.getenv("MODEL_FALLBACK", "gpt-4o-mini")


class ModelRouter:
    def __init__(self) -> None:
        self.api_key = OPENAI_API_KEY
        self.client: Optional[OpenAI] = None
        if self.api_key:
            self.client = OpenAI(api_key=self.api_key.strip().strip('"').strip("'"))
        else:
            logger.warning("[model_router] OPENAI_API_KEY not set — inference calls will fail.")

    def get_model_for_task(self, task_type: str, user_tier: str = "free") -> str:
        """
        Return the model name for a given task type.
        user_tier is reserved for future tier-based routing (e.g. 'pro' → gpt-4o everywhere).
        """
        return DEFAULT_MODELS.get(task_type, _FALLBACK_MODEL)

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
        tool_choice: Optional[str] = None,
    ) -> Union[str, Generator[Any, None, None]]:
        """Thin wrapper around OpenAI chat completions with task-based model routing."""
        if not self.client:
            raise ValueError("[model_router] OpenAI client not initialised. Check OPENAI_API_KEY.")

        model = self.get_model_for_task(task_type)

        kwargs: Dict[str, Any] = {
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
                return response  # caller iterates the generator
            return response.choices[0].message.content
        except Exception as e:
            logger.error(f"[model_router] completion failed (task={task_type} model={model}): {e}")
            raise


# Singleton — import this everywhere
model_router = ModelRouter()
