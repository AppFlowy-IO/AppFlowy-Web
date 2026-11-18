"""Exercise nginx before and after Bun starts in a fresh Web SSR image."""

from contextlib import closing
from http.client import HTTPConnection
import subprocess
import time


def status(client, path):
    client.request("GET", path)
    response = client.getresponse()
    response.read()
    return response.status


def main():
    subprocess.run(["nginx"], check=True)
    # One keep-alive connection keeps every request on the worker that saw Bun offline.
    with closing(HTTPConnection("127.0.0.1", 80, timeout=3)) as client:
        assert status(client, "/app") == 502, "expected a 502 before Bun starts"
        bun = subprocess.Popen(["bun", "run", "/app/deploy/server.ts"])
        try:
            deadline = time.monotonic() + 15
            while status(client, "/health") != 200:
                if bun.poll() is not None or time.monotonic() >= deadline:
                    raise RuntimeError("Bun failed to become ready")
                time.sleep(0.05)

            app = status(client, "/app")
            assert app == 200, f"/app returned {app} after /health reported ready"
        finally:
            bun.terminate()
            bun.wait(timeout=5)


if __name__ == "__main__":
    main()
