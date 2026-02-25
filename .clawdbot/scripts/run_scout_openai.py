#!/usr/bin/env python3
"""
Headless scout: call OpenAI with the scout prompt + repo filesystem snapshot,
extract a JSON array from the response, and write it to SCOUT_OUTPUT_PATH.

Requires: pip install openai (python-dotenv optional; loads .env if present)
Env: OPENAI_API_KEY from .env if not set; SCOUT_OUTPUT_PATH (required); SCOUT_PROMPT_PATH (optional)
"""
import json
import os
import re
import sys

# Max chars of repo context to send (leave room for prompt + response)
REPO_CONTEXT_MAX_CHARS = 90_000
SKIP_DIRS = {".git", "node_modules", ".venv", "venv", "__pycache__", ".next", "dist", "build", ".cache"}
INCLUDE_EXT = (".py", ".ts", ".tsx", ".js", ".jsx", ".md", ".json", ".sh")
INCLUDE_PATHS = ("backend", "frontend", ".clawdbot", "docs")
MAX_LINES_PER_FILE = 120
MAX_FILES = 80


def _load_dotenv() -> None:
    """Load .env from backend/.env, repo_root/.env, repo_root/.env.local (later overrides; matches backend/config)."""
    script_dir = os.path.dirname(os.path.abspath(__file__))
    repo_root = os.path.abspath(os.path.join(script_dir, "..", ".."))
    backend_dir = os.path.join(repo_root, "backend")
    paths = (
        os.path.join(backend_dir, ".env"),
        os.path.join(repo_root, ".env"),
        os.path.join(repo_root, ".env.local"),
    )
    try:
        from dotenv import load_dotenv
        for path in paths:
            if os.path.isfile(path):
                load_dotenv(dotenv_path=path, override=True)
        return
    except ImportError:
        pass
    for path in paths:
        if not os.path.isfile(path):
            continue
        with open(path) as f:
            for line in f:
                line = line.strip()
                if line and not line.startswith("#") and "=" in line:
                    k, _, v = line.partition("=")
                    k, v = k.strip(), v.strip().strip('"').strip("'")
                    if k == "OPENAI_API_KEY":
                        os.environ[k] = v


def _repo_root() -> str:
    script_dir = os.path.dirname(os.path.abspath(__file__))
    return os.path.abspath(os.path.join(script_dir, "..", ".."))


def _gather_repo_context() -> str:
    root = _repo_root()
    parts = []
    total = 0
    file_count = 0
    for dir_name in INCLUDE_PATHS:
        dir_path = os.path.join(root, dir_name)
        if not os.path.isdir(dir_path):
            continue
        for base, dirs, filenames in os.walk(dir_path, topdown=True):
            dirs[:] = [d for d in dirs if d not in SKIP_DIRS]
            rel_base = os.path.relpath(base, root)
            for fn in filenames:
                if file_count >= MAX_FILES or total >= REPO_CONTEXT_MAX_CHARS:
                    break
                if not any(fn.endswith(ext) for ext in INCLUDE_EXT):
                    continue
                if fn.endswith(".min.js") or ".bundle." in fn:
                    continue
                path = os.path.join(base, fn)
                rel = os.path.join(rel_base, fn)
                try:
                    with open(path, "r", encoding="utf-8", errors="replace") as f:
                        lines = f.readlines()
                except OSError:
                    continue
                head = "".join(lines[:MAX_LINES_PER_FILE])
                if len(lines) > MAX_LINES_PER_FILE:
                    head += f"\n... ({len(lines) - MAX_LINES_PER_FILE} more lines)\n"
                block = f"\n### {rel}\n```\n{head}\n```\n"
                if total + len(block) > REPO_CONTEXT_MAX_CHARS:
                    block = block[: REPO_CONTEXT_MAX_CHARS - total]
                    parts.append(block)
                    total = REPO_CONTEXT_MAX_CHARS
                    break
                parts.append(block)
                total += len(block)
                file_count += 1
        if file_count >= MAX_FILES or total >= REPO_CONTEXT_MAX_CHARS:
            break
    return "## Repo snapshot (filesystem)\n\nBelow are file paths and contents from the repository. Use them to propose concrete, scoped improvements.\n" + "".join(parts)


def main():
    _load_dotenv()
    out_path = os.environ.get("SCOUT_OUTPUT_PATH")
    if not out_path:
        print("SCOUT_OUTPUT_PATH must be set", file=sys.stderr)
        sys.exit(1)

    # Use stdin if scout.sh piped the rendered prompt; else read from file
    if not sys.stdin.isatty():
        prompt_text = sys.stdin.read()
    else:
        prompt_path = os.environ.get("SCOUT_PROMPT_PATH", "")
        if not prompt_path or not os.path.isfile(prompt_path):
            script_dir = os.path.dirname(os.path.abspath(__file__))
            prompt_path = os.path.join(script_dir, "..", "prompts", "scout.md")
        with open(prompt_path, "r") as f:
            prompt_text = f.read().replace("{{SCOUT_OUTPUT_PATH}}", out_path)

    # Inject repo filesystem snapshot so the model can analyze real code
    repo_context = _gather_repo_context()
    prompt_text = prompt_text + "\n\n" + repo_context

    try:
        from openai import OpenAI
    except ImportError:
        print("pip install openai", file=sys.stderr)
        sys.exit(1)

    api_key = os.environ.get("OPENAI_API_KEY")
    if not api_key:
        print("OPENAI_API_KEY must be set", file=sys.stderr)
        sys.exit(1)

    client = OpenAI()
    resp = client.chat.completions.create(
        model=os.environ.get("SCOUT_OPENAI_MODEL", "gpt-4o"),
        messages=[{"role": "user", "content": prompt_text}],
    )
    content = (resp.choices[0].message.content or "").strip()

    # Extract JSON array: allow markdown code block or raw array
    data = None
    m = re.search(r"\[[\s\S]*\]", content)
    if m:
        try:
            data = json.loads(m.group(0))
        except json.JSONDecodeError:
            pass
    if data is None:
        try:
            data = json.loads(content)
        except json.JSONDecodeError:
            print("Model response did not contain valid JSON array", file=sys.stderr)
            print(content[:500], file=sys.stderr)
            sys.exit(1)
    if not isinstance(data, list):
        print("Model response was not a JSON array", file=sys.stderr)
        sys.exit(1)

    with open(out_path, "w") as f:
        json.dump(data, f, indent=2)
    print(f"Wrote {len(data)} proposal(s) to {out_path}", file=sys.stderr)

if __name__ == "__main__":
    main()
