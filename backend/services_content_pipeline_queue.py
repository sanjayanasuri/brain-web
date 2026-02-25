"""
Content pipeline job queue (Redis-backed, with in-memory fallback).

Phase 1 MVP goals:
- Ingest endpoints enqueue jobs quickly.
- Jobs execute asynchronously.
- Retries with backoff.
- Safe to run multiple workers (Redis queue).

NOTE: This is intentionally lightweight and dependency-free (uses redis-py if available).
If you later adopt Celery/Dramatiq, keep the job payload contract stable.
"""

from __future__ import annotations

import heapq
import json
import logging
import time
from queue import Empty, Queue
from threading import Thread
from typing import Optional
from uuid import uuid4

from config import (
    CONTENT_PIPELINE_MAX_JOB_ATTEMPTS,
    REDIS_DB,
    REDIS_HOST,
    REDIS_PASSWORD,
    REDIS_PORT,
    REDIS_URL,
    USE_REDIS,
)
from db_postgres import set_request_db_identity, reset_request_db_identity
from services_branch_explorer import set_request_graph_identity, reset_request_graph_identity
from services_content_pipeline_jobs import ContentPipelineJob, FollowUpJob, run_content_pipeline_job

try:
    import redis
except Exception:  # pragma: no cover
    redis = None

logger = logging.getLogger("brain_web")

QUEUE_KEY = "bw:content_pipeline:queue"
SCHEDULED_KEY = "bw:content_pipeline:scheduled"

_PROMOTE_DUE_LUA = r"""
local zset = KEYS[1]
local list = KEYS[2]
local now = tonumber(ARGV[1])
local items = redis.call('ZRANGEBYSCORE', zset, '-inf', now, 'LIMIT', 0, 1)
if #items == 0 then
  return nil
end
redis.call('ZREM', zset, items[1])
redis.call('LPUSH', list, items[1])
return items[1]
"""


def _get_redis_client():
    if not USE_REDIS or redis is None:
        return None
    try:
        if REDIS_URL:
            r = redis.from_url(REDIS_URL, decode_responses=True, socket_timeout=2)
        else:
            r = redis.Redis(
                host=REDIS_HOST,
                port=REDIS_PORT,
                db=REDIS_DB,
                password=REDIS_PASSWORD,
                decode_responses=True,
                socket_timeout=2,
            )
        r.ping()
        return r
    except Exception as e:
        logger.warning(f"[content_pipeline_queue] Redis unavailable; using in-memory queue ({e})")
        return None


class ContentPipelineQueue:
    def __init__(self) -> None:
        self._redis = _get_redis_client()
        self._promote_script = self._redis.register_script(_PROMOTE_DUE_LUA) if self._redis else None

        self._mem_queue: Queue[str] = Queue()
        self._mem_scheduled: list[tuple[float, str]] = []

        self.running = False
        self.worker_thread: Optional[Thread] = None

    def enqueue(self, job: ContentPipelineJob, *, delay_s: int = 0) -> None:
        raw = job.model_dump_json()
        if self._redis is not None:
            if delay_s and delay_s > 0:
                self._redis.zadd(SCHEDULED_KEY, {raw: time.time() + float(delay_s)})
            else:
                self._redis.lpush(QUEUE_KEY, raw)
            return

        if delay_s and delay_s > 0:
            heapq.heappush(self._mem_scheduled, (time.time() + float(delay_s), raw))
        else:
            self._mem_queue.put(raw)

    def enqueue_job(
        self,
        *,
        job_type: str,
        content_item_id: str,
        user_id: str,
        tenant_id: str,
        attempt: int = 0,
        delay_s: int = 0,
        job_id: Optional[str] = None,
    ) -> None:
        job = ContentPipelineJob(
            job_id=job_id or uuid4().hex,
            job_type=job_type,  # type: ignore[arg-type]
            content_item_id=content_item_id,
            user_id=user_id,
            tenant_id=tenant_id,
            attempt=int(attempt or 0),
        )
        self.enqueue(job, delay_s=int(delay_s or 0))

    def _promote_due(self, *, max_batch: int = 50) -> None:
        if self._redis is None or self._promote_script is None:
            return
        now = int(time.time())
        moved = 0
        while moved < max_batch:
            try:
                res = self._promote_script(keys=[SCHEDULED_KEY, QUEUE_KEY], args=[now])
            except Exception:
                return
            if not res:
                return
            moved += 1

    def _dequeue_raw(self, *, timeout_s: float = 1.0) -> Optional[str]:
        if self._redis is not None:
            self._promote_due()
            item = self._redis.brpop(QUEUE_KEY, timeout=max(1, int(timeout_s)))
            if not item:
                return None
            _key, raw = item
            return raw

        # In-memory: promote scheduled jobs
        now = time.time()
        while self._mem_scheduled and self._mem_scheduled[0][0] <= now:
            _, raw = heapq.heappop(self._mem_scheduled)
            self._mem_queue.put(raw)
        try:
            return self._mem_queue.get(timeout=timeout_s)
        except Empty:
            return None

    def start_worker(self) -> None:
        if self.running:
            return
        self.running = True

        def worker() -> None:
            while self.running:
                raw = self._dequeue_raw(timeout_s=1.0)
                if not raw:
                    continue

                try:
                    job = ContentPipelineJob.model_validate_json(raw)
                except Exception as e:
                    logger.warning(f"[content_pipeline_queue] Dropping invalid job payload: {e}")
                    continue

                graph_tokens = set_request_graph_identity(job.user_id, job.tenant_id)
                db_tokens = set_request_db_identity(job.user_id, job.tenant_id)
                try:
                    followups = run_content_pipeline_job(job)
                except Exception as e:
                    attempts = int(job.attempt or 0) + 1
                    logger.error(
                        "[content_pipeline_queue] job_failed job_id=%s job_type=%s content_item_id=%s attempt=%s error=%s",
                        job.job_id,
                        job.job_type,
                        job.content_item_id,
                        attempts,
                        str(e),
                    )

                    if attempts >= int(CONTENT_PIPELINE_MAX_JOB_ATTEMPTS):
                        if job.job_type in ("extract_content", "analyze_content"):
                            try:
                                from services_content_pipeline_store import update_content_item_status

                                update_content_item_status(content_item_id=job.content_item_id, status="failed")
                            except Exception:
                                pass
                        continue

                    delay_s = min(60, 2 ** attempts)
                    retry_job = job.model_copy(update={"attempt": attempts})
                    self.enqueue(retry_job, delay_s=int(delay_s))
                    continue
                finally:
                    reset_request_db_identity(db_tokens)
                    reset_request_graph_identity(graph_tokens)

                for f in followups or []:
                    if isinstance(f, FollowUpJob):
                        self.enqueue_job(
                            job_type=f.job_type,
                            content_item_id=f.content_item_id,
                            user_id=f.user_id,
                            tenant_id=f.tenant_id,
                            delay_s=int(f.delay_s or 0),
                        )

        self.worker_thread = Thread(target=worker, daemon=True)
        self.worker_thread.start()
        logger.info("[content_pipeline_queue] Worker started (backend=%s)", "redis" if self._redis else "memory")

    def stop_worker(self) -> None:
        self.running = False
        if self.worker_thread:
            self.worker_thread.join(timeout=5.0)


_queue: Optional[ContentPipelineQueue] = None


def get_content_pipeline_queue() -> ContentPipelineQueue:
    global _queue
    if _queue is None:
        _queue = ContentPipelineQueue()
        _queue.start_worker()
    return _queue


def enqueue_content_pipeline_job(
    *,
    job_type: str,
    content_item_id: str,
    user_id: str,
    tenant_id: str,
    delay_s: int = 0,
) -> None:
    q = get_content_pipeline_queue()
    q.enqueue_job(
        job_type=job_type,
        content_item_id=content_item_id,
        user_id=user_id,
        tenant_id=tenant_id,
        delay_s=delay_s,
    )

