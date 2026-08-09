from __future__ import annotations

from enum import StrEnum


class Role(StrEnum):
    """Staff roles, most privileged first. Speakers are not users and have no role."""

    OWNER = "owner"
    ADMIN = "admin"
    COORDINATOR = "coordinator"
    REVIEWER = "reviewer"


class MagicLinkPurpose(StrEnum):
    PORTAL = "portal"
    STATUS = "status"


class EventStatus(StrEnum):
    DRAFT = "draft"
    CFP_OPEN = "cfp_open"
    IN_REVIEW = "in_review"
    SCHEDULED = "scheduled"
    LIVE = "live"
    ARCHIVED = "archived"


class FormKind(StrEnum):
    CFP = "cfp"
    TASK = "task"


class FormStatus(StrEnum):
    DRAFT = "draft"
    OPEN = "open"
    CLOSED = "closed"


class SpeakerStatus(StrEnum):
    PROSPECTIVE = "prospective"
    ACCEPTED = "accepted"
    CONFIRMED = "confirmed"
    DECLINED = "declined"
    WITHDRAWN = "withdrawn"


class SubmissionStatus(StrEnum):
    DRAFT = "draft"
    SUBMITTED = "submitted"
    IN_REVIEW = "in_review"
    ACCEPTED = "accepted"
    WAITLISTED = "waitlisted"
    REJECTED = "rejected"
    WITHDRAWN = "withdrawn"


class DecisionStatus(StrEnum):
    """The separation that stops accidental mass email: a decision is recorded as
    pending_send and only the send endpoint moves it to sent."""

    NONE = "none"
    PENDING_SEND = "pending_send"
    SENT = "sent"


class ReviewRoundStatus(StrEnum):
    DRAFT = "draft"
    OPEN = "open"
    CLOSED = "closed"


class CriterionKind(StrEnum):
    """A scorecard field. `text` is qualitative and never enters the mean."""

    RATING = "rating"
    SELECT = "select"
    TEXT = "text"


class ReviewStatus(StrEnum):
    PENDING = "pending"
    SCORED = "scored"
    SKIPPED = "skipped"
    FLAGGED = "flagged"


class DuplicateStatus(StrEnum):
    OPEN = "open"
    KEPT_BOTH = "kept_both"
    MARKED_DUPLICATE = "marked_duplicate"
    MERGED = "merged"


class SessionStatus(StrEnum):
    UNSCHEDULED = "unscheduled"
    SCHEDULED = "scheduled"
    CONFIRMED = "confirmed"


class SessionSpeakerRole(StrEnum):
    SPEAKER = "speaker"
    MODERATOR = "moderator"
    PANELIST = "panelist"


class ContentStatus(StrEnum):
    """Approval gate for anything speaker-supplied that reaches the public site."""

    PENDING = "pending"
    APPROVED = "approved"
    CHANGES_REQUESTED = "changes_requested"


class ConflictKind(StrEnum):
    ROOM = "room"
    SPEAKER = "speaker"
    TRACK = "track"


class TaskKind(StrEnum):
    UPLOAD = "upload"
    FORM = "form"
    ACKNOWLEDGE = "acknowledge"
    EXTERNAL_LINK = "external_link"


class TaskStatus(StrEnum):
    """`overdue` is derived — swept nightly and recomputed on read — never a
    transition a caller performs."""

    NOT_STARTED = "not_started"
    IN_PROGRESS = "in_progress"
    SUBMITTED = "submitted"
    COMPLETE = "complete"
    OVERDUE = "overdue"


class PageVisibility(StrEnum):
    DRAFT = "draft"
    SPEAKERS_ONLY = "speakers_only"
    PUBLIC = "public"


class MessagePurpose(StrEnum):
    ACCEPTANCE = "acceptance"
    REJECTION = "rejection"
    WAITLIST = "waitlist"
    TASK_REMINDER = "task_reminder"
    SCHEDULE_CHANGE = "schedule_change"
    PORTAL_INVITE = "portal_invite"
    REVIEWER_NUDGE = "reviewer_nudge"
    CUSTOM = "custom"


class MessageStatus(StrEnum):
    DRAFT = "draft"
    QUEUED = "queued"
    SENT = "sent"
    FAILED = "failed"
    BOUNCED = "bounced"
    COMPLAINED = "complained"


class ActorKind(StrEnum):
    USER = "user"
    SPEAKER = "speaker"
    SYSTEM = "system"
    AI = "ai"


class AiProposalKind(StrEnum):
    SCHEDULE = "schedule"
    DUPLICATES = "duplicates"
    NORMALIZE = "normalize"
    SCORE = "score"
    ASSIGN_REVIEWERS = "assign_reviewers"


class AiProposalStatus(StrEnum):
    STREAMING = "streaming"
    READY = "ready"
    PARTIALLY_ACCEPTED = "partially_accepted"
    ACCEPTED = "accepted"
    DISCARDED = "discarded"
    FAILED = "failed"


class IntegrationProvider(StrEnum):
    ACCELEVENTS = "accelevents"


class PushKind(StrEnum):
    DRY_RUN = "dry_run"
    EXECUTE = "execute"
