"""The API's single error shape.

Every failure the client can branch on has a named code. The frontend switches on
`error.code`, never on a message string, so messages stay free to change.
"""

from __future__ import annotations

from typing import Any

from fastapi import Request, status
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse


class ApiError(Exception):
    """Base for every expected failure. Unexpected ones are 500s and are not this."""

    status_code: int = status.HTTP_400_BAD_REQUEST
    code: str = "BAD_REQUEST"

    def __init__(
        self,
        message: str,
        *,
        field: str | None = None,
        details: Any = None,
        code: str | None = None,
        status_code: int | None = None,
    ) -> None:
        super().__init__(message)
        self.message = message
        self.field = field
        self.details = details
        if code is not None:
            self.code = code
        if status_code is not None:
            self.status_code = status_code

    def to_body(self) -> dict[str, Any]:
        error: dict[str, Any] = {"code": self.code, "message": self.message}
        if self.field is not None:
            error["field"] = self.field
        if self.details is not None:
            error["details"] = self.details
        return {"error": error}


class NotFoundError(ApiError):
    status_code = status.HTTP_404_NOT_FOUND
    code = "NOT_FOUND"


class ConflictError(ApiError):
    status_code = status.HTTP_409_CONFLICT
    code = "CONFLICT"


class EmailTakenError(ConflictError):
    """Signup only. Login never says whether an address exists."""

    code = "EMAIL_TAKEN"


class AuthenticationError(ApiError):
    status_code = status.HTTP_401_UNAUTHORIZED
    code = "NOT_AUTHENTICATED"


class RoleRequiredError(ApiError):
    """403, never 404 — the UI renders the route frame and names the missing role."""

    status_code = status.HTTP_403_FORBIDDEN
    code = "ROLE_REQUIRED"


class EmailNotVerifiedError(ApiError):
    """403 on the actions that reach another human, never on reading.

    An unconfirmed account is allowed to sign in, look around and set its event
    up. What it may not do is send mail or publish, because those are the two
    ways a throwaway signup turns this install into somebody else's problem.
    """

    status_code = status.HTTP_403_FORBIDDEN
    code = "EMAIL_NOT_VERIFIED"


class OAuthError(ApiError):
    """The GitHub round trip failed, or came back without a usable identity."""

    status_code = status.HTTP_400_BAD_REQUEST
    code = "OAUTH_FAILED"


class RateLimitedError(ApiError):
    status_code = status.HTTP_429_TOO_MANY_REQUESTS
    code = "RATE_LIMITED"


class MagicLinkExpiredError(ApiError):
    status_code = status.HTTP_400_BAD_REQUEST
    code = "MAGIC_LINK_EXPIRED"


class CfpClosedError(ApiError):
    status_code = status.HTTP_403_FORBIDDEN
    code = "CFP_CLOSED"


class SubmissionLimitReachedError(ApiError):
    status_code = status.HTTP_403_FORBIDDEN
    code = "SUBMISSION_LIMIT_REACHED"


class FormLockedError(ApiError):
    status_code = status.HTTP_409_CONFLICT
    code = "FORM_LOCKED"


class RecipientCountMismatchError(ApiError):
    """The guard on mass email: the client's count no longer matches the server's."""

    status_code = status.HTTP_409_CONFLICT
    code = "RECIPIENT_COUNT_MISMATCH"


#: Routes declared anonymous and readable from anyone's site. `allow_any_origin`
#: sets the header on the way out of a successful request; this is the prefix
#: the error path has to recognise to do the same.
PUBLIC_PREFIX = "/v1/public/"


def _cors_headers_for(request: Request) -> dict[str, str]:
    """Errors under /v1/public need the same open CORS as their successes.

    `allow_any_origin` works by mutating the injected `Response`, which only
    exists when a route *returns*. Raising discards it and the handler builds a
    fresh response, so every public error went out with no
    `Access-Control-Allow-Origin` at all.

    A missing header does not merely hide the body — the browser rejects the
    whole fetch, so a cross-origin widget could not distinguish "not published
    yet" from a dead network and reported every failure identically. The
    response is anonymous either way; withholding the header protected nothing
    and cost the only useful diagnostic an embedder gets.
    """
    if not request.url.path.startswith(PUBLIC_PREFIX):
        return {}
    return {"Access-Control-Allow-Origin": "*", "Vary": "Origin"}


async def api_error_handler(request: Request, exc: Exception) -> JSONResponse:
    assert isinstance(exc, ApiError)
    return JSONResponse(
        status_code=exc.status_code,
        content=exc.to_body(),
        headers=_cors_headers_for(request),
    )


async def validation_error_handler(request: Request, exc: Exception) -> JSONResponse:
    """422 with per-field detail, in the same envelope as everything else."""
    assert isinstance(exc, RequestValidationError)
    errors = [
        {
            "field": ".".join(str(part) for part in err["loc"][1:]) or None,
            "message": err["msg"],
            "type": err["type"],
        }
        for err in exc.errors()
    ]
    return JSONResponse(
        status_code=status.HTTP_422_UNPROCESSABLE_CONTENT,
        content={
            "error": {
                "code": "VALIDATION_FAILED",
                "message": "The request body failed validation.",
                "details": {"errors": errors},
            }
        },
        # A public route rejecting a malformed query is as cross-origin as one
        # answering it — the CFP form posts here from the event's own site.
        headers=_cors_headers_for(request),
    )
