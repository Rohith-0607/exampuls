import asyncio
import pytest
from sqlalchemy import select, func

from app.database import AsyncSessionLocal
from app.models import Submission, AuditLog, Answer, Question
from app.services.exam_service import ensure_utc


@pytest.mark.asyncio
@pytest.mark.parametrize('number,reason', [(41, 'face_missing'), (42, 'camera_disconnected')])
async def test_camera_termination_submits_once_and_cannot_resume(client, number, reason):
    login = (await client.post('/api/auth/login', json={'username': f'candidate_{number:03d}', 'password': 'password123'})).json()
    headers = {'Authorization': 'Bearer ' + login['access_token']}
    exams = (await client.get('/api/exams', headers=headers)).json()
    exam_id = exams[0]['id']
    session_id = (await client.post(f'/api/exams/{exam_id}/start', headers=headers)).json()['session_id']
    questions = (await client.get(f'/api/sessions/{session_id}/questions', headers=headers)).json()
    saved = await client.put(f"/api/sessions/{session_id}/answers/{questions[0]['id']}", headers=headers, json={'selected_answer': 'A', 'version': 1})
    assert saved.status_code == 200
    ended = await client.post(f'/api/sessions/{session_id}/submit', headers=headers, params={'reason': reason})
    assert ended.status_code == 200
    assert ended.json()['status'] == 'submitted'
    assert ended.json()['termination_reason'] == reason
    assert ended.json()['unanswered_count'] == 19
    repeated = await client.post(f'/api/sessions/{session_id}/submit', headers=headers, params={'reason': reason})
    assert repeated.json()['score'] == ended.json()['score']
    assert repeated.json()['termination_reason'] == reason
    resumed = await client.post(f'/api/exams/{exam_id}/start', headers=headers)
    assert resumed.json()['status'] == 'submitted'
    assert resumed.json()['session_id'] == session_id
    changed = await client.put(f"/api/sessions/{session_id}/answers/{questions[0]['id']}", headers=headers, json={'selected_answer': 'B', 'version': 2})
    assert changed.status_code == 403
    restored = await client.get(f'/api/sessions/{session_id}/submission', headers=headers)
    assert restored.json()['termination_reason'] == reason
    async with AsyncSessionLocal() as session:
        assert await session.scalar(select(func.count(Submission.id)).where(Submission.session_id == session_id)) == 1
        assert await session.scalar(select(func.count(AuditLog.id)).where(AuditLog.target_id == session_id, AuditLog.action == 'exam_camera_ended')) == 1


@pytest.mark.asyncio
async def test_unrecognized_termination_reason_is_rejected(client):
    login = (await client.post('/api/auth/login', json={'username': 'candidate_043', 'password': 'password123'})).json()
    response = await client.post('/api/sessions/nonexistent/submit', headers={'Authorization': 'Bearer ' + login['access_token']}, params={'reason': 'arbitrary'})
    assert response.status_code == 422


@pytest.mark.asyncio
async def test_repeated_simultaneous_camera_submissions(client):
    """Automatic ending, manual submit, and network retries can arrive together."""
    for number in range(44, 49):
        login = (await client.post('/api/auth/login', json={'username': f'candidate_{number:03d}', 'password': 'password123'})).json()
        headers = {'Authorization': 'Bearer ' + login['access_token']}
        exam_id = (await client.get('/api/exams', headers=headers)).json()[0]['id']
        session_id = (await client.post(f'/api/exams/{exam_id}/start', headers=headers)).json()['session_id']
        responses = await asyncio.gather(*(
            client.post(f'/api/sessions/{session_id}/submit', headers=headers, params={'reason': 'face_missing'})
            for _ in range(6)
        ))
        assert all(response.status_code == 200 for response in responses)
        assert len({response.json()['submitted_at'] for response in responses}) == 1
        async with AsyncSessionLocal() as session:
            assert await session.scalar(select(func.count(Submission.id)).where(Submission.session_id == session_id)) == 1
            assert await session.scalar(select(func.count(AuditLog.id)).where(AuditLog.target_id == session_id, AuditLog.action == 'exam_camera_ended')) == 1


@pytest.mark.asyncio
async def test_answers_racing_camera_termination_cannot_change_final_score(client):
    for number in range(49, 54):
        login = (await client.post('/api/auth/login', json={'username': f'candidate_{number:03d}', 'password': 'password123'})).json()
        headers = {'Authorization': 'Bearer ' + login['access_token']}
        exam_id = (await client.get('/api/exams', headers=headers)).json()[0]['id']
        session_id = (await client.post(f'/api/exams/{exam_id}/start', headers=headers)).json()['session_id']
        question_id = (await client.get(f'/api/sessions/{session_id}/questions', headers=headers)).json()[0]['id']
        async with AsyncSessionLocal() as db:
            correct = (await db.scalar(select(Question.correct_answer).where(Question.id == question_id)))
        wrong = 'A' if correct != 'A' else 'B'
        saves = [client.put(f'/api/sessions/{session_id}/answers/{question_id}', headers=headers,
                            json={'selected_answer': correct if version % 2 else wrong, 'version': version})
                 for version in range(1, 7)]
        results = await asyncio.gather(*saves, client.post(f'/api/sessions/{session_id}/submit', headers=headers,
                                                          params={'reason': 'camera_disconnected'}))
        assert all(response.status_code in (200, 403) for response in results[:-1])
        assert results[-1].status_code == 200
        async with AsyncSessionLocal() as db:
            answer = await db.scalar(select(Answer).where(Answer.session_id == session_id, Answer.question_id == question_id))
            submission = await db.scalar(select(Submission).where(Submission.session_id == session_id))
            expected_score = 1.0 if answer and answer.selected_answer == correct else 0.0
            assert submission.score == expected_score
            if answer:
                assert ensure_utc(answer.updated_at) <= ensure_utc(submission.submitted_at)
        restored = await client.get(f'/api/sessions/{session_id}/submission', headers=headers)
        assert restored.status_code == 200
        assert restored.json()['score'] == results[-1].json()['score']
