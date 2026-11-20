import asyncio

import pytest
import pytest_asyncio
from sqlalchemy import select, func

from app.database import AsyncSessionLocal
from app.demo_accounts import ensure_demo_candidates
from app.models import Candidate, User


@pytest_asyncio.fixture(scope='module')
async def twenty_thousand_candidates():
    async with AsyncSessionLocal() as session:
        await ensure_demo_candidates(session, 20000)


@pytest.mark.asyncio
async def test_provisioning_twenty_thousand_is_idempotent(twenty_thousand_candidates):
    async with AsyncSessionLocal() as session:
        original = (await session.execute(select(User).where(User.username == 'candidate_003'))).scalar_one()
        original_id, original_hash = original.id, original.password_hash
        await ensure_demo_candidates(session, 20000)
        assert (await session.scalar(select(func.count(Candidate.id)))) == 20000
        assert (await session.scalar(select(func.count(User.id)).where(User.role == 'candidate'))) == 20000
        await session.refresh(original)
        assert original.id == original_id
        assert original.password_hash == original_hash
        last = (await session.execute(select(User).where(User.username == 'candidate_20000'))).scalar_one()
        assert await session.scalar(select(Candidate.id).where(Candidate.user_id == last.id))


@pytest.mark.asyncio
async def test_candidates_beyond_two_start_independently(client, twenty_thousand_candidates):
    async def enter(number):
        login = await client.post('/api/auth/login', json={'username': f'candidate_{number:03d}', 'password': 'password123'})
        assert login.status_code == 200, login.text
        headers = {'Authorization': 'Bearer ' + login.json()['access_token']}
        exams = (await client.get('/api/exams', headers=headers)).json()
        response = await client.post(f"/api/exams/{exams[0]['id']}/start", headers=headers)
        assert response.status_code == 200, response.text
        data = response.json()
        questions = await client.get(f"/api/sessions/{data['session_id']}/questions", headers=headers)
        assert questions.status_code == 200
        assert len(questions.json()) == 20
        return headers, data['session_id']

    entered = await asyncio.gather(*(enter(i) for i in (3, 101, 10000, 20000)))
    assert len({session_id for _, session_id in entered}) == 4
    # One candidate's token cannot access another candidate's session.
    response = await client.get(f'/api/sessions/{entered[0][1]}/questions', headers=entered[1][0])
    assert response.status_code == 404


@pytest.mark.asyncio
async def test_admin_candidate_pagination_and_global_search(client, twenty_thousand_candidates):
    login = (await client.post('/api/auth/login', json={'username': 'admin', 'password': 'admin123'})).json()
    headers = {'Authorization': 'Bearer ' + login['access_token']}
    exams = (await client.get('/api/exams', headers=headers)).json()
    url = f"/api/admin/exams/{exams[0]['id']}/candidates"
    first = await client.get(url, headers=headers)
    second = await client.get(url, headers=headers, params={'offset': 100})
    assert len(first.json()) == len(second.json()) == 100
    assert not ({row['candidate_id'] for row in first.json()} & {row['candidate_id'] for row in second.json()})
    found = await client.get(url, headers=headers, params={'search': 'Candidate 20000'})
    assert found.status_code == 200
    assert [row['display_name'] for row in found.json()] == ['Candidate 20000']
    rejected = await client.get(url, headers=headers, params={'limit': 20000})
    assert rejected.status_code == 422
