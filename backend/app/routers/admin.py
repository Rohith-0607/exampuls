from fastapi import APIRouter, Depends, HTTPException, status, Query
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, func, desc, case, or_
from typing import List
from datetime import datetime, timezone
from app.database import get_db
from app.models import (
    User, Candidate, Examination, ExaminationSession, Answer, Submission, SuspicionFlag
)
from app.schemas import (
    InvigilatorOverview, CandidateMonitorItem, LeaderboardItem, SuspicionFlagItem
)
from app.routers.deps import require_roles
from app.redis_client import redis_manager
from app.services.collusion_service import CollusionService

router = APIRouter(prefix="/api/admin/exams/{exam_id}", tags=["Invigilator / Admin"])

def utc_now():
    return datetime.now(timezone.utc)

@router.get("/overview", response_model=InvigilatorOverview)
async def get_overview(
    exam_id: str,
    admin: User = Depends(require_roles("admin", "invigilator")),
    db: AsyncSession = Depends(get_db)
):
    exam_res = await db.execute(select(Examination).where(Examination.id == exam_id))
    exam = exam_res.scalar_one_or_none()
    if not exam:
        raise HTTPException(status_code=404, detail="Examination not found")

    total_candidates_res = await db.execute(select(func.count(Candidate.id)))
    total_registered = total_candidates_res.scalar() or 0

    sessions_res = await db.execute(
        select(ExaminationSession.status, func.count(ExaminationSession.id))
        .where(ExaminationSession.examination_id == exam_id)
        .group_by(ExaminationSession.status)
    )
    status_counts = dict(sessions_res.all())

    active_count = status_counts.get("in_progress", 0)
    submitted_count = status_counts.get("submitted", 0)
    started_total = sum(status_counts.values())
    not_started_count = max(0, total_registered - started_total)

    flags_res = await db.execute(
        select(func.count(SuspicionFlag.id)).where(SuspicionFlag.examination_id == exam_id)
    )
    suspicious_count = flags_res.scalar() or 0

    return InvigilatorOverview(
        examination_id=exam.id,
        title=exam.title,
        total_registered=total_registered,
        active_count=active_count,
        submitted_count=submitted_count,
        not_started_count=not_started_count,
        suspicious_count=suspicious_count,
        duration_seconds=exam.duration_seconds,
        server_time=utc_now()
    )

@router.get("/candidates", response_model=List[CandidateMonitorItem])
async def list_candidates(
    exam_id: str,
    limit: int = Query(default=100, ge=1, le=500),
    offset: int = Query(default=0, ge=0),
    search: str = Query(default='', max_length=100),
    candidate_status: str = Query(default='all', alias='status', pattern='^(all|not_started|in_progress|submitted|expired)$'),
    admin: User = Depends(require_roles("admin", "invigilator")),
    db: AsyncSession = Depends(get_db)
):
    # Bound each dashboard response even when 20,000 candidates are registered.
    stmt = (
        select(Candidate, ExaminationSession, Submission)
        .outerjoin(
            ExaminationSession,
            (ExaminationSession.candidate_id == Candidate.id) & 
            (ExaminationSession.examination_id == exam_id)
        )
        .outerjoin(Submission, Submission.session_id == ExaminationSession.id)
        .order_by(Candidate.candidate_code)
    )
    if search.strip():
        term = f"%{search.strip()}%"
        stmt = stmt.where(or_(Candidate.candidate_code.ilike(term), Candidate.display_name.ilike(term)))
    if candidate_status == 'not_started':
        stmt = stmt.where(ExaminationSession.id.is_(None))
    elif candidate_status != 'all':
        stmt = stmt.where(ExaminationSession.status == candidate_status)
    stmt = stmt.limit(limit).offset(offset)
    results = (await db.execute(stmt)).all()

    session_ids = [sess.id for _, sess, _ in results if sess]
    answer_stats = {}
    if session_ids:
        stats = (await db.execute(
            select(
                Answer.session_id,
                func.sum(case((func.length(func.trim(Answer.selected_answer)) > 0, 1), else_=0)).label('answered'),
                func.sum(case((Answer.is_marked_for_review.is_(True), 1), else_=0)).label('marked'),
                func.max(Answer.updated_at).label('last_activity'),
            ).where(Answer.session_id.in_(session_ids)).group_by(Answer.session_id)
        )).all()
        answer_stats = {row.session_id: row for row in stats}

    # Also check which candidates have suspicion flags
    susp_stmt = select(SuspicionFlag.candidate_a_id, SuspicionFlag.candidate_b_id).where(
        SuspicionFlag.examination_id == exam_id
    )
    susp_res = (await db.execute(susp_stmt)).all()
    suspicious_candidates = set()
    for row in susp_res:
        suspicious_candidates.add(row[0])
        suspicious_candidates.add(row[1])

    monitor_items = []
    for cand, sess, sub in results:
        status_label = "not_started"
        answered_cnt = 0
        unanswered_cnt = 0
        marked_cnt = 0
        last_act = None
        score_val = None

        if sess:
            status_label = sess.status
            stats = answer_stats.get(sess.id)
            if stats:
                answered_cnt = stats.answered or 0
                marked_cnt = stats.marked or 0
                last_act = stats.last_activity
            
            total_qs = len(sess.question_order) if sess.question_order else 0
            unanswered_cnt = max(0, total_qs - answered_cnt)
            if sess.started_at and not last_act:
                last_act = sess.started_at

        if sub:
            score_val = sub.score

        monitor_items.append(CandidateMonitorItem(
            candidate_id=cand.id,
            candidate_code=cand.candidate_code,
            display_name=cand.display_name,
            status=status_label,
            answered_count=answered_cnt,
            unanswered_count=unanswered_cnt,
            marked_count=marked_cnt,
            score=score_val,
            is_suspicious=cand.id in suspicious_candidates,
            last_activity=last_act
        ))

    return monitor_items

@router.get("/leaderboard", response_model=List[LeaderboardItem])
async def get_leaderboard(
    exam_id: str,
    admin: User = Depends(require_roles("admin", "invigilator")),
    db: AsyncSession = Depends(get_db)
):
    # Fetch official submissions joined with Candidate
    stmt = (
        select(Submission, ExaminationSession, Candidate)
        .join(ExaminationSession, ExaminationSession.id == Submission.session_id)
        .join(Candidate, Candidate.id == ExaminationSession.candidate_id)
        .where(ExaminationSession.examination_id == exam_id)
        .order_by(desc(Submission.score), Submission.submitted_at)
    )
    result = await db.execute(stmt)
    rows = result.all()

    leaderboard = []
    for rank, (sub, sess, cand) in enumerate(rows, 1):
        leaderboard.append(LeaderboardItem(
            rank=rank,
            candidate_code=cand.candidate_code,
            display_name=cand.display_name,
            score=sub.score,
            correct_count=sub.correct_count,
            incorrect_count=sub.incorrect_count,
            unanswered_count=sub.unanswered_count,
            submitted_at=sub.submitted_at
        ))

    return leaderboard

@router.get("/suspicious-activity", response_model=List[SuspicionFlagItem])
async def get_suspicious_activity(
    exam_id: str,
    admin: User = Depends(require_roles("admin", "invigilator")),
    db: AsyncSession = Depends(get_db)
):
    stmt = (
        select(SuspicionFlag)
        .where(SuspicionFlag.examination_id == exam_id)
        .order_by(desc(SuspicionFlag.similarity_score))
    )
    result = await db.execute(stmt)
    flags = result.scalars().all()

    items = []
    for f in flags:
        cand_a = (await db.execute(select(Candidate).where(Candidate.id == f.candidate_a_id))).scalar_one()
        cand_b = (await db.execute(select(Candidate).where(Candidate.id == f.candidate_b_id))).scalar_one()
        items.append(SuspicionFlagItem(
            id=f.id,
            examination_id=f.examination_id,
            candidate_a_code=cand_a.candidate_code,
            candidate_a_name=cand_a.display_name,
            candidate_b_code=cand_b.candidate_code,
            candidate_b_name=cand_b.display_name,
            similarity_score=f.similarity_score,
            risk_level=f.risk_level,
            reason=f.reason,
            evidence=f.evidence,
            created_at=f.created_at
        ))

    return items


@router.post("/run-collusion-detection")
async def run_collusion_detection(
    exam_id: str,
    threshold: float = 0.70,
    admin: User = Depends(require_roles("admin", "invigilator")),
    db: AsyncSession = Depends(get_db)
):
    flags = await CollusionService.analyze_collusion(exam_id, db, similarity_threshold=threshold)
    return {
        "status": "success",
        "flags_detected": len(flags),
        "message": f"Collusion scan complete. Found {len(flags)} suspicious pairings."
    }
