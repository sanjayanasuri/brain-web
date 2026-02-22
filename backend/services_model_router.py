import os
import logging
from typing import List, Dict, Any, Optional, Union, Generator
from openai import OpenAI
from config import OPENAI_API_KEY

logger = logging.getLogger("brain_web")

# ---------------------------------------------------------------------------
# Task type constants — import these everywhere, never use raw strings
# ---------------------------------------------------------------------------
TASK_CHAT_FAST   = "chat_fast"    # Low-latency, cheaper model
TASK_CHAT_SMART  = "chat_smart"   # Capable model for complex reasoning
TASK_REASONING   = "reasoning"    # Heavy reasoning (o1/o3 when available)
TASK_VOICE       = "voice"        # Ultra-low-latency for real-time voice
TASK_SYNTHESIS   = "synthesis"    # Session/topic synthesis, fog-clearing
# Backward-compat alias used by older call sites.
TASK_SYNTHESIZE  = TASK_SYNTHESIS
TASK_EXTRACT     = "extract"      # Concept/entity extraction from text
TASK_SUMMARIZE   = "summarize"    # Summarization tasks
TASK_SEARCH      = "search"       # Web search synthesis / re-ranking
TASK_RECOMMEND   = "recommend"    # Recommendation and gap analysis
TASK_EMBEDDING   = "embedding"    # Semantic search vectors

# ---------------------------------------------------------------------------
# Model mapping — every model is overridable via an env var.
# Swap models without touching code or redeploying.
# ---------------------------------------------------------------------------
DEFAULT_MODELS: Dict[str, str] = {
    TASK_CHAT_FAST:  os.getenv("MODEL_CHAT_FAST",  "gpt-4o-mini"),
    TASK_CHAT_SMART: os.getenv("MODEL_CHAT_SMART", "gpt-4o"),
    TASK_REASONING:  os.getenv("MODEL_REASONING",  "gpt-4o"),      # swap to o3-mini when ready
    TASK_VOICE:      os.getenv("MODEL_VOICE",      "gpt-4o-mini"),  # latency-critical
    TASK_SYNTHESIS:  os.getenv("MODEL_SYNTHESIS",  "gpt-4o"),
    TASK_EXTRACT:    os.getenv("MODEL_EXTRACT",    "gpt-4o"),       # more precise for graph extraction
    TASK_SUMMARIZE:  os.getenv("MODEL_SUMMARIZE",  "gpt-4o-mini"),
    TASK_SEARCH:     os.getenv("MODEL_SEARCH",     "gpt-4o-mini"),
    TASK_RECOMMEND:  os.getenv("MODEL_RECOMMEND",  "gpt-4o-mini"),
    TASK_EMBEDDING:  os.getenv("MODEL_EMBEDDING",  "text-embedding-3-small"),
}

# Fallback used if an unknown task type is passed
_FALLBACK_MODEL = os.getenv("MODEL_FALLBACK", "gpt-4o-mini")


class ModelRouter:
    def __init__(self) -> None:
        self.api_key = OPENAI_API_KEY
        self.client: Optional[OpenAI] = None
        if self.api_key:
            cleaned = self.api_key.strip().strip('"').strip("'")
            if cleaned and cleaned.startswith("sk-"):
                try:
                    self.client = OpenAI(api_key=cleaned)
                except Exception as e:
                    logger.error(f"[model_router] Failed to init OpenAI client: {e}")
        if not self.client:
            logger.warning("[model_router] OPENAI_API_KEY not set or invalid — inference calls will fail.")

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

    def embed(self, text: Union[str, List[str]], task_type: str = TASK_EMBEDDING) -> Union[List[float], List[List[float]]]:
        """Generate embeddings for text or list of texts."""
        if not self.client:
            raise ValueError("[model_router] OpenAI client not initialised.")
            
        model = self.get_model_for_task(task_type)
        try:
            response = self.client.embeddings.create(
                model=model,
                input=text
            )
            if isinstance(text, str):
                return response.data[0].embedding
            return [d.embedding for d in response.data]
        except Exception as e:
            logger.error(f"[model_router] embedding failed: {e}")
            raise


# Singleton — import this everywhere
model_router = ModelRouter()
