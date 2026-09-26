"""One engine per database: an OS-level exclusive lock on ``<db>.lease``."""

from __future__ import annotations

import os


class LeaseHeld(RuntimeError):
    pass


class FileLease:
    def __init__(self, path: str):
        self.path = path
        self.fh = open(path, "a+b")
        try:
            self.fh.seek(0)
            if os.name == "nt":
                import msvcrt

                if os.path.getsize(path) == 0:
                    self.fh.write(b"0")
                    self.fh.flush()
                self.fh.seek(0)
                msvcrt.locking(self.fh.fileno(), msvcrt.LK_NBLCK, 1)
            else:
                import fcntl

                fcntl.flock(self.fh, fcntl.LOCK_EX | fcntl.LOCK_NB)
        except OSError as exc:
            self.fh.close()
            raise LeaseHeld(f"another Mio job engine is using {path}") from exc

    def release(self) -> None:
        if self.fh.closed:
            return
        try:
            if os.name == "nt":
                import msvcrt

                self.fh.seek(0)
                msvcrt.locking(self.fh.fileno(), msvcrt.LK_UNLCK, 1)
            else:
                import fcntl

                fcntl.flock(self.fh, fcntl.LOCK_UN)
        except OSError:
            pass
        finally:
            self.fh.close()
