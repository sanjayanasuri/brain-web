import json
import os
import threading
from dataclasses import dataclass
from pathlib import Path
from typing import Dict, List, Optional, Tuple


@dataclass(frozen=True)
class ExaSearchProfile:
    name: str
    search_type: str
    category: Optional[str]
    content_mode: str
    content_max_characters: int
    max_age_hours: Optional[int]
    include_domains: Tuple[str, ...]
    exclude_domains: Tuple[str, ...]


@dataclass(frozen=True)
class ExaPolicyRule:
    name: str
    profile: str
    match_any: Tuple[str, ...]
    match_all: Tuple[str, ...]


@dataclass(frozen=True)
class ExaQueryPolicyConfig:
    default_profile: str
    profiles: Dict[str, ExaSearchProfile]
    rules: Tuple[ExaPolicyRule, ...]


_LOCK = threading.Lock()
_CACHE: Optional[ExaQueryPolicyConfig] = None


def _default_path() -> Path:
    return Path(__file__).with_name("exa_query_policy.json")


def _normalize_domains(value: Optional[List[str]]) -> Tuple[str, ...]:
    if not value:
        return tuple()
    out: List[str] = []
    seen = set()
    for item in value:
        if not isinstance(item, str):
            continue
        v = item.strip().lower()
        if not v or v in seen:
            continue
        seen.add(v)
        out.append(v)
    return tuple(out)


def _parse_profiles(raw_profiles: Dict[str, object]) -> Dict[str, ExaSearchProfile]:
    profiles: Dict[str, ExaSearchProfile] = {}
    for name, raw in raw_profiles.items():
        if not isinstance(name, str) or not isinstance(raw, dict):
            raise ValueError("exa query policy profiles must be an object of objects")
        p = raw
        search_type = str(p.get("type", "auto")).strip().lower() or "auto"
        content_mode = str(p.get("content_mode", "text")).strip().lower() or "text"
        if content_mode not in ("text", "highlights", "none"):
            raise ValueError(f"Invalid content_mode for profile '{name}': {content_mode}")
        try:
            content_max_characters = int(p.get("content_max_characters", 12000))
        except Exception as e:
            raise ValueError(f"Invalid content_max_characters for profile '{name}': {e}") from e

        max_age_hours = p.get("max_age_hours")
        if max_age_hours is not None:
            try:
                max_age_hours = int(max_age_hours)
            except Exception as e:
                raise ValueError(f"Invalid max_age_hours for profile '{name}': {e}") from e

        category = p.get("category")
        if category is not None:
            category = str(category).strip()
            if not category:
                category = None

        include_domains = _normalize_domains(p.get("include_domains"))  # type: ignore[arg-type]
        exclude_domains = _normalize_domains(p.get("exclude_domains"))  # type: ignore[arg-type]
        if include_domains and exclude_domains:
            raise ValueError(f"Profile '{name}' cannot define both include_domains and exclude_domains")

        profiles[name] = ExaSearchProfile(
            name=name,
            search_type=search_type,
            category=category,
            content_mode=content_mode,
            content_max_characters=max(0, content_max_characters),
            max_age_hours=max_age_hours,
            include_domains=include_domains,
            exclude_domains=exclude_domains,
        )
    return profiles


def _parse_rules(raw_rules: List[object], profiles: Dict[str, ExaSearchProfile]) -> Tuple[ExaPolicyRule, ...]:
    rules: List[ExaPolicyRule] = []
    for idx, raw in enumerate(raw_rules):
        if not isinstance(raw, dict):
            raise ValueError(f"rules[{idx}] must be an object")
        name = str(raw.get("name", f"rule_{idx}")).strip() or f"rule_{idx}"
        profile = str(raw.get("profile", "")).strip()
        if profile not in profiles:
            raise ValueError(f"rules[{idx}] references unknown profile '{profile}'")
        match_any = tuple(
            s.strip().lower()
            for s in (raw.get("match_any") or [])
            if isinstance(s, str) and s.strip()
        )
        match_all = tuple(
            s.strip().lower()
            for s in (raw.get("match_all") or [])
            if isinstance(s, str) and s.strip()
        )
        if not match_any and not match_all:
            raise ValueError(f"rules[{idx}] must define match_any and/or match_all")
        rules.append(ExaPolicyRule(name=name, profile=profile, match_any=match_any, match_all=match_all))
    return tuple(rules)


def _load_config(path: Path) -> ExaQueryPolicyConfig:
    with path.open("r", encoding="utf-8") as f:
        raw = json.load(f)
    if not isinstance(raw, dict):
        raise ValueError("exa query policy file must be a JSON object")

    raw_profiles = raw.get("profiles")
    if not isinstance(raw_profiles, dict):
        raise ValueError("exa query policy 'profiles' must be an object")
    profiles = _parse_profiles(raw_profiles)

    default_profile = str(raw.get("default_profile", "")).strip()
    if default_profile not in profiles:
        raise ValueError(f"exa query policy default_profile '{default_profile}' not found in profiles")

    raw_rules = raw.get("rules") or []
    if not isinstance(raw_rules, list):
        raise ValueError("exa query policy 'rules' must be a list")
    rules = _parse_rules(raw_rules, profiles)

    return ExaQueryPolicyConfig(default_profile=default_profile, profiles=profiles, rules=rules)


def get_exa_query_policy_config(*, force_reload: bool = False) -> ExaQueryPolicyConfig:
    global _CACHE
    if _CACHE is not None and not force_reload:
        return _CACHE
    with _LOCK:
        if _CACHE is not None and not force_reload:
            return _CACHE
        override_path = os.getenv("EXA_QUERY_POLICY_CONFIG_PATH")
        path = Path(override_path).expanduser() if override_path else _default_path()
        _CACHE = _load_config(path)
        return _CACHE
