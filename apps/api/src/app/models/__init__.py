"""Every model must be imported here.

Alembic autogenerate and the tenancy registry both walk the declarative
registry; a model that is never imported is invisible to both, which means it
silently gets no migration and no tenant filtering.
"""

from app.models.auth import AuthSession, MagicLink
from app.models.base import Base, EventScoped, OrgScoped
from app.models.enums import (
    ActorKind,
    AiProposalKind,
    AiProposalStatus,
    ConflictKind,
    ContentStatus,
    CriterionKind,
    DecisionStatus,
    DuplicateStatus,
    EventStatus,
    ExpertiseLevel,
    FormKind,
    FormStatus,
    IntegrationProvider,
    MagicLinkPurpose,
    MessagePurpose,
    MessageStatus,
    PageVisibility,
    PushKind,
    ReviewRoundStatus,
    ReviewStatus,
    Role,
    SessionSpeakerRole,
    SessionStatus,
    SpeakerStatus,
    SubmissionStatus,
    TaskKind,
    TaskStatus,
)
from app.models.event import Event, EventMember
from app.models.file import File
from app.models.form import Form, FormFieldStats
from app.models.message import Message, MessageBatch, MessageTemplate
from app.models.ops import (
    ActivityLog,
    AiProposal,
    IntegrationConfig,
    IntegrationPush,
    SavedView,
)
from app.models.organization import Organization, OrgMember
from app.models.page import Page
from app.models.program import (
    EventDay,
    Room,
    RoomBlackout,
    ScheduleBlock,
    SessionFormat,
    Track,
)
from app.models.review import (
    AiScore,
    DuplicateFlag,
    Review,
    ReviewerAssignment,
    ReviewRound,
    ReviewScore,
    RubricCriterion,
)
from app.models.session import (
    ConflictDismissal,
    PublishedSchedule,
    SavedEmbed,
    Session,
    SessionSpeaker,
)
from app.models.speaker import EventSpeaker, Speaker
from app.models.submission import (
    Submission,
    SubmissionNote,
    SubmissionSpeaker,
    SubmissionTag,
)
from app.models.task import SpeakerTask, TaskFile, TaskTemplate
from app.models.user import User

__all__ = [
    "ActivityLog",
    "ActorKind",
    "AiProposal",
    "AiProposalKind",
    "AiProposalStatus",
    "AiScore",
    "AuthSession",
    "Base",
    "ConflictDismissal",
    "ConflictKind",
    "ContentStatus",
    "CriterionKind",
    "DecisionStatus",
    "DuplicateFlag",
    "DuplicateStatus",
    "Event",
    "EventDay",
    "EventMember",
    "EventScoped",
    "EventSpeaker",
    "EventStatus",
    "ExpertiseLevel",
    "File",
    "Form",
    "FormFieldStats",
    "FormKind",
    "FormStatus",
    "IntegrationConfig",
    "IntegrationProvider",
    "IntegrationPush",
    "MagicLink",
    "MagicLinkPurpose",
    "Message",
    "MessageBatch",
    "MessagePurpose",
    "MessageStatus",
    "MessageTemplate",
    "OrgMember",
    "OrgScoped",
    "Organization",
    "Page",
    "PageVisibility",
    "PublishedSchedule",
    "PushKind",
    "Review",
    "ReviewRound",
    "ReviewRoundStatus",
    "ReviewScore",
    "ReviewStatus",
    "ReviewerAssignment",
    "Role",
    "Room",
    "RoomBlackout",
    "RubricCriterion",
    "SavedEmbed",
    "SavedView",
    "ScheduleBlock",
    "Session",
    "SessionFormat",
    "SessionSpeaker",
    "SessionSpeakerRole",
    "SessionStatus",
    "Speaker",
    "SpeakerStatus",
    "SpeakerTask",
    "Submission",
    "SubmissionNote",
    "SubmissionSpeaker",
    "SubmissionStatus",
    "SubmissionTag",
    "TaskFile",
    "TaskKind",
    "TaskStatus",
    "TaskTemplate",
    "Track",
    "User",
]
