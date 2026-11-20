from uuid import uuid4

from sqlalchemy import select
from sqlalchemy.dialects.postgresql import insert as postgres_insert
from sqlalchemy.dialects.sqlite import insert as sqlite_insert
from starlette.concurrency import run_in_threadpool

from app.models import User, Candidate
from app.utils.security import hash_password


async def ensure_demo_candidates(session, count):
    """Add missing demo accounts in batches without changing passwords or exam data."""
    dialect = session.get_bind().dialect.name
    insert = postgres_insert if dialect == 'postgresql' else sqlite_insert
    password_hash = None

    for start in range(1, count + 1, 500):
        numbers = {f'candidate_{i:03d}': i for i in range(start, min(start + 500, count + 1))}
        rows = (await session.execute(
            select(User.username, User.id, User.role, Candidate.id.label('profile_id'))
            .outerjoin(Candidate, Candidate.user_id == User.id)
            .where(User.username.in_(numbers))
        )).all()
        existing = {row.username: row for row in rows}
        missing = [name for name in numbers if name not in existing]
        if missing:
            if password_hash is None:
                password_hash = await run_in_threadpool(hash_password, 'password123')
            await session.execute(
                insert(User).on_conflict_do_nothing(index_elements=['username']),
                [{'id': str(uuid4()), 'username': name, 'password_hash': password_hash, 'role': 'candidate'} for name in missing],
            )
            # Re-read IDs so simultaneous seeders always attach to the winning user.
            rows = (await session.execute(
                select(User.username, User.id, User.role, Candidate.id.label('profile_id'))
                .outerjoin(Candidate, Candidate.user_id == User.id)
                .where(User.username.in_(numbers))
            )).all()
        profiles = [
            {'id': str(uuid4()), 'user_id': row.id,
             'candidate_code': f'C-{1000 + numbers[row.username]}',
             'display_name': f'Candidate {numbers[row.username]:03d}'}
            for row in rows if row.role == 'candidate' and row.profile_id is None
        ]
        if profiles:
            await session.execute(insert(Candidate).on_conflict_do_nothing(index_elements=['user_id']), profiles)
        await session.commit()

    return count
