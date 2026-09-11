"""Sandboxed Python runner for the Solver Agent.

The runner is invoked as a one-shot subprocess by ``src/python/runner.ts``.
Code is read from STDIN, executed in an isolated temporary directory with
matplotlib forced to the non-interactive ``Agg`` backend, and any open
figures are saved as PNG artifacts. After the script finishes, a single
JSON line prefixed with ``__SOLVER_RUNNER_RESULT__`` is written to STDOUT
that lists the produced artifacts so the Node side can pick them up.

The artifact bytes themselves are base64-encoded inline into the result
JSON: the temporary directory is destroyed as soon as the runner exits,
so the Node side cannot rely on reading paths from disk.

Layout per invocation::

    <tmp>/
        script.py            # the user code as written by the runner
        artifacts/           # any files the script writes (and auto-saved figures)

The runner refuses to keep artifacts larger than ``--max-artifact-bytes``
to avoid pathological matplotlib renders blowing up the ledger.
"""

from __future__ import annotations

import argparse
import base64
import json
import os
import runpy
import sys
import tempfile
import traceback
from pathlib import Path

RESULT_PREFIX = "__SOLVER_RUNNER_RESULT__"


def _save_open_figures(artifacts_dir: Path) -> None:
    try:
        import matplotlib.pyplot as plt
    except Exception:
        return
    nums = plt.get_fignums()
    for idx, num in enumerate(nums, start=1):
        try:
            fig = plt.figure(num)
            target = artifacts_dir / f"figure-{idx}.png"
            fig.savefig(target, bbox_inches="tight")
        except Exception:
            continue
    try:
        plt.close("all")
    except Exception:
        pass


def _collect_artifacts(artifacts_dir: Path, max_bytes: int) -> list[dict]:
    """Collect every file under ``artifacts_dir`` and inline its bytes as
    base64 into the result. We do NOT return raw filesystem paths because
    the temporary directory is wiped as soon as the runner exits — by the
    time the Node side reads the JSON trailer the paths would be dangling.
    """

    out: list[dict] = []
    if not artifacts_dir.exists():
        return out
    for path in sorted(artifacts_dir.rglob("*")):
        if not path.is_file():
            continue
        try:
            size = path.stat().st_size
        except OSError:
            continue
        rel_name = path.relative_to(artifacts_dir).as_posix()
        if size > max_bytes:
            out.append(
                {
                    "name": rel_name,
                    "skipped": True,
                    "reason": f"size {size} exceeds limit {max_bytes}",
                    "size": size,
                }
            )
            continue
        try:
            payload = path.read_bytes()
        except OSError as e:
            out.append(
                {
                    "name": rel_name,
                    "skipped": True,
                    "reason": f"failed to read: {e}",
                    "size": size,
                }
            )
            continue
        out.append(
            {
                "name": rel_name,
                "size": size,
                "data": base64.b64encode(payload).decode("ascii"),
            }
        )
    return out


def _force_matplotlib_agg() -> None:
    try:
        import matplotlib

        matplotlib.use("Agg", force=True)
    except Exception:
        pass


def _apply_resource_limits(max_memory_bytes: int, cpu_seconds: int) -> None:
    """Best-effort POSIX resource limits for untrusted, model-generated code.

    Each limit is applied independently so a platform that rejects one (for
    example macOS does not reliably honor ``RLIMIT_AS``) still gets the rest.
    A no-op on non-POSIX platforms.
    """

    if os.name != "posix":
        return
    try:
        import resource
    except Exception:
        return

    def _set(which, soft, hard=None) -> None:
        try:
            resource.setrlimit(which, (soft, hard if hard is not None else soft))
        except Exception:
            pass

    if cpu_seconds > 0:
        # Give the hard limit a little headroom over the soft limit so the
        # process receives SIGXCPU (catchable) before SIGKILL.
        _set(resource.RLIMIT_CPU, cpu_seconds, cpu_seconds + 1)
    if max_memory_bytes > 0:
        for name in ("RLIMIT_AS", "RLIMIT_DATA"):
            which = getattr(resource, name, None)
            if which is not None:
                _set(which, max_memory_bytes)
    # Cap individual file sizes the script may write (artifacts are collected
    # separately and still bounded by --max-artifact-bytes on the Node side).
    if max_memory_bytes > 0:
        _set(resource.RLIMIT_FSIZE, max_memory_bytes)
    # Bound the number of open file descriptors to curb fd-exhaustion abuse.
    soft_nofile = getattr(resource, "RLIMIT_NOFILE", None)
    if soft_nofile is not None:
        _set(soft_nofile, 256)


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--max-artifact-bytes", type=int, default=2_097_152)
    parser.add_argument("--max-memory-bytes", type=int, default=0)
    parser.add_argument("--cpu-seconds", type=int, default=0)
    args = parser.parse_args()

    code = sys.stdin.read()

    _force_matplotlib_agg()

    with tempfile.TemporaryDirectory(prefix="solver-runner-") as tmp:
        tmp_path = Path(tmp)
        artifacts_dir = tmp_path / "artifacts"
        artifacts_dir.mkdir(parents=True, exist_ok=True)

        script_path = tmp_path / "script.py"
        script_path.write_text(code)

        # Run with cwd = artifacts/ so any file the script writes via a
        # relative path is automatically collected as an artifact.
        os.chdir(artifacts_dir)

        exit_code = 0
        error_message: str | None = None
        try:
            _apply_resource_limits(args.max_memory_bytes, args.cpu_seconds)
            runpy.run_path(str(script_path), run_name="__main__")
        except SystemExit as se:
            exit_code = int(se.code) if isinstance(se.code, int) else 1
        except BaseException:
            exit_code = 1
            error_message = traceback.format_exc()
            sys.stderr.write(error_message)
            sys.stderr.flush()

        _save_open_figures(artifacts_dir)
        artifacts = _collect_artifacts(artifacts_dir, args.max_artifact_bytes)

        result = {
            "exitCode": exit_code,
            "error": error_message,
            "artifacts": artifacts,
        }
        sys.stdout.write("\n" + RESULT_PREFIX + json.dumps(result) + "\n")
        sys.stdout.flush()

    return 0


if __name__ == "__main__":
    raise SystemExit(main())
