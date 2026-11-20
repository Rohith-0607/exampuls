import os
import tempfile
from pathlib import Path

# Tests must never change candidate attempts in the running local application.
_test_directory = tempfile.TemporaryDirectory(prefix='exampulse-tests-')
os.environ['DATABASE_URL'] = f"sqlite+aiosqlite:///{(Path(_test_directory.name) / 'test.db').as_posix()}"
os.environ['SEED_CANDIDATE_COUNT'] = '100'

import pytest
import pytest_asyncio
from httpx import AsyncClient, ASGITransport
from app.main import app
from app.redis_client import redis_manager
from app.seed import seed_database
from app.database import engine

@pytest_asyncio.fixture(scope="session", autouse=True)
async def setup_test_environment():
    await seed_database()
    # Ensure redis fake connection is initialized
    await redis_manager.connect()
    yield
    await redis_manager.close()
    await engine.dispose()
    _test_directory.cleanup()

@pytest_asyncio.fixture
async def client():
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://testserver") as ac:
        yield ac

