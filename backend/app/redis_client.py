import json
import logging
import asyncio
from typing import Optional, Dict, Any, List, Tuple
import redis.asyncio as aioredis
from app.config import settings

logger = logging.getLogger("exampulse.redis")


class _FakePubSub:
    """Minimal in-memory Pub/Sub for local development when Redis/fakeredis is unavailable."""

    def __init__(self, manager: "RedisManager"):
        self._manager = manager
        self._channels: set = set()
        self._queue: asyncio.Queue = asyncio.Queue()

    async def subscribe(self, *channels: str):
        for ch in channels:
            self._channels.add(ch)
            self._manager._subscribers.setdefault(ch, []).append(self._queue)

    async def listen(self):
        while True:
            msg = await self._queue.get()
            yield msg

    async def close(self):
        for ch in list(self._channels):
            subs = self._manager._subscribers.get(ch, [])
            if self._queue in subs:
                subs.remove(self._queue)


class _FakeRedisClient:
    """Minimal in-memory Redis substitute supporting the subset of commands ExamPulse uses."""

    def __init__(self):
        self._data: Dict[str, str] = {}
        self._zsets: Dict[str, Dict[str, float]] = {}
        self._subscribers: Dict[str, List[asyncio.Queue]] = {}
        self._closed = False

    async def ping(self):
        return True

    async def get(self, key: str):
        return self._data.get(key)

    async def set(self, key: str, value: str, ex: Optional[int] = None):
        self._data[key] = value
        return True

    async def publish(self, channel: str, message: str):
        count = 0
        for q in self._subscribers.get(channel, []):
            await q.put({"type": "message", "channel": channel, "data": message})
            count += 1
        return count

    def pubsub(self):
        return _FakePubSub(self)

    async def zadd(self, key: str, mapping: Dict[str, float]):
        if key not in self._zsets:
            self._zsets[key] = {}
        self._zsets[key].update(mapping)
        return len(mapping)

    async def zrevrange(self, key: str, start: int, stop: int, withscores: bool = False):
        if key not in self._zsets:
            return [] if withscores else []
        items = sorted(self._zsets[key].items(), key=lambda x: x[1], reverse=True)
        sliced = items[start : stop + 1]
        if withscores:
            return [(member, score) for member, score in sliced]
        return [member for member, _ in sliced]

    async def aclose(self):
        self._closed = True
        self._data.clear()
        self._zsets.clear()
        self._subscribers.clear()

    async def close(self):
        await self.aclose()


class RedisManager:
    def __init__(self):
        self.client: Optional[aioredis.Redis] = None
        self.pubsub_client: Optional[aioredis.Redis] = None
        self.is_fake: bool = False

    async def connect(self):
        # 1. Try live Redis
        try:
            client = aioredis.from_url(
                settings.REDIS_URL,
                decode_responses=True,
                socket_connect_timeout=2.0
            )
            await client.ping()
            self.client = client
            self.is_fake = False
            logger.info("Connected to live Redis instance at %s", settings.REDIS_URL)
            return
        except Exception as e:
            logger.warning("Live Redis unreachable (%s).", str(e))

        # 2. Try fakeredis.aioredis (may crash on Python 3.14)
        if settings.USE_FAKE_REDIS_FALLBACK:
            try:
                import fakeredis.aioredis
                self.client = fakeredis.aioredis.FakeRedis(decode_responses=True)
                self.is_fake = True
                logger.info("Using in-memory FakeRedis fallback.")
                return
            except Exception as fe:
                logger.warning("fakeredis.aioredis unavailable (%s). Using minimal in-memory fake.", str(fe))

        # 3. Last-resort minimal in-memory fake
        self.client = _FakeRedisClient()
        self.is_fake = True
        logger.info("Using minimal in-memory Redis substitute.")

    async def close(self):
        if self.client:
            if hasattr(self.client, "aclose"):
                await self.client.aclose()
            else:
                await self.client.close()

    async def get_json(self, key: str) -> Optional[Any]:
        if not self.client:
            return None
        try:
            val = await self.client.get(key)
            return json.loads(val) if val else None
        except Exception as e:
            logger.error("Redis get_json error for %s: %s", key, str(e))
            return None

    async def set_json(self, key: str, value: Any, ttl: int = 3600):
        if not self.client:
            return
        try:
            await self.client.set(key, json.dumps(value), ex=ttl)
        except Exception as e:
            logger.error("Redis set_json error for %s: %s", key, str(e))

    async def publish_event(self, channel: str, message: Dict[str, Any]):
        if not self.client:
            return
        try:
            payload = json.dumps(message)
            await self.client.publish(channel, payload)
        except Exception as e:
            logger.error("Redis publish error on %s: %s", channel, str(e))

    # Leaderboard Operations using Redis Sorted Sets (ZSET)
    async def update_leaderboard(self, exam_id: str, candidate_code: str, score: float):
        if not self.client:
            return
        try:
            key = f"exam:{exam_id}:leaderboard"
            await self.client.zadd(key, {candidate_code: score})
        except Exception as e:
            logger.error("Redis leaderboard update error: %s", str(e))

    async def get_top_leaderboard(self, exam_id: str, limit: int = 50) -> List[tuple]:
        if not self.client:
            return []
        try:
            key = f"exam:{exam_id}:leaderboard"
            # returns list of (member, score)
            return await self.client.zrevrange(key, 0, limit - 1, withscores=True)
        except Exception as e:
            logger.error("Redis leaderboard fetch error: %s", str(e))
            return []

redis_manager = RedisManager()
