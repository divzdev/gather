"""Auth primitives. Getting any of these wrong is a breach, not a bug."""

from __future__ import annotations

import uuid
from datetime import timedelta

import jwt
import pytest

from app.core.security import (
    create_access_token,
    decode_access_token,
    generate_token,
    hash_ip,
    hash_password,
    hash_token,
    verify_password,
)


def test_password_hash_is_argon2id_and_verifies() -> None:
    hashed = hash_password("correct horse battery staple")
    assert hashed.startswith("$argon2id$")
    assert verify_password("correct horse battery staple", hashed)


def test_wrong_password_is_rejected() -> None:
    assert not verify_password("wrong", hash_password("right"))


def test_same_password_hashes_differently() -> None:
    """A shared salt would let one rainbow table cover every user."""
    assert hash_password("same") != hash_password("same")


def test_verify_does_not_raise_on_a_garbage_hash() -> None:
    """A corrupted column must fail the login, not 500 the endpoint."""
    assert not verify_password("anything", "not-a-hash")


def test_generated_tokens_are_unique_and_long() -> None:
    tokens = {generate_token() for _ in range(500)}
    assert len(tokens) == 500
    assert all(len(t) >= 40 for t in tokens)


def test_token_hash_is_stable_and_one_way() -> None:
    token = generate_token()
    assert hash_token(token) == hash_token(token)
    assert token not in hash_token(token)
    assert len(hash_token(token)) == 64


def test_ip_hash_is_not_reversible_to_the_address() -> None:
    assert "203.0.113.7" not in hash_ip("203.0.113.7")
    assert hash_ip("203.0.113.7") != hash_ip("203.0.113.8")


def test_access_token_round_trips_with_its_claims() -> None:
    subject = uuid.uuid4()
    token = create_access_token(subject, claims={"org_id": "abc"})
    payload = decode_access_token(token)
    assert payload["sub"] == str(subject)
    assert payload["typ"] == "access"
    assert payload["org_id"] == "abc"


def test_expired_token_is_rejected() -> None:
    token = create_access_token(uuid.uuid4(), expires_in=timedelta(seconds=-1))
    with pytest.raises(jwt.ExpiredSignatureError):
        decode_access_token(token)


def test_token_signed_with_another_key_is_rejected() -> None:
    forged = jwt.encode(
        {"sub": str(uuid.uuid4()), "typ": "access", "iat": 0, "exp": 9999999999},
        "attacker-key",
        algorithm="HS256",
    )
    with pytest.raises(jwt.InvalidSignatureError):
        decode_access_token(forged)


def test_alg_none_token_is_rejected() -> None:
    """The classic JWT bypass: strip the signature and claim alg=none."""
    forged = jwt.encode(
        {"sub": str(uuid.uuid4()), "typ": "access", "iat": 0, "exp": 9999999999},
        key="",
        algorithm="none",
    )
    with pytest.raises(jwt.PyJWTError):
        decode_access_token(forged)


def test_speaker_token_is_distinguishable_from_staff() -> None:
    """A speaker token must never be mistaken for staff access."""
    event_id = uuid.uuid4()
    token = create_access_token(uuid.uuid4(), kind="speaker", claims={"event_id": str(event_id)})
    payload = decode_access_token(token)
    assert payload["typ"] == "speaker"
    assert payload["event_id"] == str(event_id)
