"""Start ordered stubs with the real Gateway overlay, without Cloud data or host ports."""

import json
import os
from pathlib import Path
import shutil
import subprocess
import tempfile
import unittest
import uuid


ROOT = Path(__file__).resolve().parents[2]


def stub(**options):
    return {
        "image": "busybox:1.37.0",
        "command": ["sleep", "300"],
        "stop_grace_period": "1s",
        "healthcheck": {"test": ["CMD", "true"], "interval": "1s", "timeout": "1s"},
        **options,
    }


class GatewayNetworkTest(unittest.TestCase):
    def test_cloud_can_start_before_the_proxy(self):
        with tempfile.TemporaryDirectory(prefix="web-ci-gateway-") as directory:
            root = Path(directory)
            cloud = root / "AppFlowy-Cloud-Premium"
            (cloud / "nginx").mkdir(parents=True)
            (root / ".github").mkdir()
            for name in ("docker-compose-web-ci.override.yml", "docker-compose-web-ci.gateway.override.yml"):
                shutil.copyfile(ROOT / ".github" / name, root / ".github" / name)
            (cloud / "nginx/api-limits-ci.conf").write_text("# Network regression stub\n")

            # Match the Server fixture's dedicated proxy network and nginx identity.
            # Gateway waits for Cloud, so nginx must be able to join after Cloud starts.
            base = {
                "services": {
                    "appflowy_cloud": stub(networks={
                        "default": {}, "cloud_proxy": {"aliases": ["appflowy_cloud_proxy"]},
                    }),
                    "appflowy_worker": stub(),
                    "redis": stub(),
                    "nginx": stub(networks={
                        "default": {}, "cloud_proxy": {"ipv4_address": "172.31.255.2"},
                    }),
                },
                "networks": {"default": {}, "cloud_proxy": {
                    "internal": True, "ipam": {"config": [{"subnet": "172.31.255.0/29"}]},
                }},
            }
            canonical = {"services": {
                "gateway_clickhouse": stub(networks=["shared_network"]),
                "appflowy_gateway": stub(networks=["shared_network"], depends_on={
                    "appflowy_cloud": {"condition": "service_healthy"},
                    "gateway_clickhouse": {"condition": "service_healthy"},
                    "redis": {"condition": "service_started"},
                }),
            }}
            for name, config in (("docker-compose-web-ci.yml", base), ("docker-compose-ci.yml", canonical)):
                (cloud / name).write_text(json.dumps(config))
            # Replace only Cloud's HTTP probe; the stubs do not run an HTTP server.
            health = cloud / "stub-health.json"
            health.write_text(json.dumps({"services": {"appflowy_cloud": {
                "healthcheck": {"test": ["CMD", "true"], "interval": "1s", "start_period": "0s"},
            }}}))
            compose = [
                "docker", "compose", "-p", f"web-ci-gateway-{uuid.uuid4().hex[:12]}",
                "-f", str(cloud / "docker-compose-web-ci.yml"),
                "-f", str(root / ".github/docker-compose-web-ci.gateway.override.yml"),
                "-f", str(health),
            ]
            env = {**os.environ, "APPFLOWY_BASE_URL": "http://localhost"}
            try:
                for args in (["pull", "--quiet"], ["up", "-d", "--no-build", "--pull", "never"],
                             ["exec", "-T", "nginx", "ping", "-c", "1", "-W", "3", "appflowy_cloud_proxy"]):
                    subprocess.run(compose + args, cwd=cloud, env=env, text=True,
                                   capture_output=True, check=True, timeout=60)
            except subprocess.CalledProcessError as error:
                self.fail((error.stderr or error.stdout)[-4000:])
            finally:
                subprocess.run(compose + ["down", "--timeout", "1", "--volumes", "--remove-orphans"],
                               cwd=cloud, env=env, capture_output=True, check=True, timeout=30)


if __name__ == "__main__":
    unittest.main()
