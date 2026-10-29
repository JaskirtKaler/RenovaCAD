import fcntl
import json
import os
from pathlib import Path
import sys
import time
import uuid


def open_directory(parent, name):
    try:
        os.mkdir(name, mode=0o700, dir_fd=parent)
    except FileExistsError:
        pass
    return os.open(name, os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW, dir_fd=parent)


def read_json(directory, name):
    fd = os.open(name, os.O_RDONLY | os.O_NOFOLLOW, dir_fd=directory)
    with os.fdopen(fd, "r", encoding="utf-8") as source:
        return json.load(source)


def merge_rules(store, root, commands):
    if not isinstance(store, dict) or store.get("schema_version") != 2 or not isinstance(store.get("rules"), list):
        raise ValueError("unsupported approval store")
    existing = {
        tuple(entry["rule"]["argv_prefix"])
        for entry in store["rules"]
        if isinstance(entry, dict)
        and entry.get("effect") == "allow"
        and isinstance(entry.get("rule"), dict)
        and entry["rule"].get("kind") == "shell_command_argv_prefix"
        and entry["rule"].get("workspace_root") == root
        and isinstance(entry["rule"].get("argv_prefix"), list)
        and all(isinstance(part, str) for part in entry["rule"]["argv_prefix"])
    }
    additions = [
        {
            "effect": "allow",
            "durability": "local_persistent",
            "rule": {"kind": "shell_command_argv_prefix", "argv_prefix": command, "workspace_root": root},
            "reason": "RenovaCAD local development",
        }
        for command in commands
        if tuple(command) not in existing
    ]
    return {**store, "rules": [*store["rules"], *additions]}, len(additions)


def synchronize():
    if Path(sys.prefix).name != "musedev":
        raise ValueError("musedev is required")
    root = Path(__file__).resolve(strict=True).parents[1]
    directories = []
    lock_fd = None
    temp_name = None
    try:
        directories.append(os.open(root, os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW))
        directories.append(open_directory(directories[-1], ".muse"))
        manifest = read_json(directories[-1], "dev-commands.json")
        commands = manifest.get("commands") if isinstance(manifest, dict) else None
        if manifest.get("schema_version") != 1 or not isinstance(commands, list):
            raise ValueError("invalid development commands")
        if not all(isinstance(command, list) and len(command) >= 2 and all(isinstance(part, str) and part for part in command) for command in commands):
            raise ValueError("invalid development command prefix")
        if len({tuple(command) for command in commands}) != len(commands):
            raise ValueError("duplicate development command prefix")
        for name in ["runtime", "config", "muse"]:
            directories.append(open_directory(directories[-1], name))
        directory = directories[-1]
        try:
            lock_fd = os.open("approval-policy.lock", os.O_RDWR | os.O_CREAT | os.O_EXCL | os.O_NOFOLLOW, 0o600, dir_fd=directory)
        except FileExistsError:
            lock_fd = os.open("approval-policy.lock", os.O_RDWR | os.O_NOFOLLOW, dir_fd=directory)
        deadline = time.monotonic() + 5
        while True:
            try:
                fcntl.flock(lock_fd, fcntl.LOCK_EX | fcntl.LOCK_NB)
                break
            except BlockingIOError:
                if time.monotonic() >= deadline:
                    raise TimeoutError("approval store is busy")
                time.sleep(0.05)
        try:
            store = read_json(directory, "approval-policy.json")
        except FileNotFoundError:
            store = {"schema_version": 2, "rules": []}
        merged, added = merge_rules(store, str(root), commands)
        if added:
            temp_name = f".approval-policy-{uuid.uuid4().hex}.tmp"
            fd = os.open(temp_name, os.O_WRONLY | os.O_CREAT | os.O_EXCL | os.O_NOFOLLOW, 0o600, dir_fd=directory)
            with os.fdopen(fd, "w", encoding="utf-8") as output:
                json.dump(merged, output, indent=2)
                output.write("\n")
                output.flush()
                os.fsync(output.fileno())
            os.replace(temp_name, "approval-policy.json", src_dir_fd=directory, dst_dir_fd=directory)
            temp_name = None
            os.fsync(directory)
        print(json.dumps({"added": added, "total": len(merged["rules"])}))
    finally:
        if temp_name is not None:
            os.unlink(temp_name, dir_fd=directories[-1])
        if lock_fd is not None:
            os.close(lock_fd)
        for directory in reversed(directories):
            os.close(directory)


if __name__ == "__main__":
    try:
        synchronize()
    except (OSError, ValueError, TypeError, AttributeError):
        print("Cannot synchronize Muse permissions. Check the project paths, musedev, and native approval-store schema.", file=sys.stderr)
        sys.exit(1)
