"""Check source-capability selection without Docker, settings, or services."""

from pathlib import Path
import subprocess
import tempfile
import unittest


ROOT = Path(__file__).resolve().parents[2]
SELECTOR = ROOT / ".github/scripts/select_web_ci_compose.sh"


class WebCiComposeTest(unittest.TestCase):
    def select(self, files):
        with tempfile.TemporaryDirectory(prefix="web ci source ") as directory:
            cloud = Path(directory)
            for name in files:
                path = cloud / name
                path.parent.mkdir(parents=True, exist_ok=True)
                path.write_text("source fixture\n")
            before = {str(p.relative_to(cloud)): p.read_bytes()
                      for p in cloud.rglob("*") if p.is_file()}
            result = subprocess.run(["bash", str(SELECTOR), str(cloud)],
                                    text=True, capture_output=True)
            after = {str(p.relative_to(cloud)): p.read_bytes()
                     for p in cloud.rglob("*") if p.is_file()}
            self.assertEqual(before, after)
            return result

    def test_legacy_source_keeps_the_existing_web_override(self):
        result = self.select(["docker-compose-web-ci.yml"])
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertEqual(result.stdout.strip(),
                         str(ROOT / ".github/docker-compose-web-ci.override.yml"))

    def test_complete_gateway_capability_selects_the_hosted_overlay(self):
        result = self.select(["docker-compose-web-ci.yml", "docker-compose-ci.yml",
                              "libs/database/src/gateway_api_limits.rs", "nginx/api-limits-ci.conf"])
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertEqual(result.stdout.strip(),
                         str(ROOT / ".github/docker-compose-web-ci.gateway.override.yml"))

    def test_gateway_fixture_without_the_former_cloud_admission_module(self):
        result = self.select(["docker-compose-web-ci.yml", "docker-compose-ci.yml",
                              "nginx/api-limits-ci.conf"])
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertEqual(result.stdout.strip(),
                         str(ROOT / ".github/docker-compose-web-ci.gateway.override.yml"))

    def test_partial_capability_cannot_silently_select_the_legacy_fixture(self):
        for files in (["libs/database/src/gateway_api_limits.rs"],
                      ["nginx/api-limits-ci.conf"],
                      ["libs/database/src/gateway_api_limits.rs", "nginx/api-limits-ci.conf"]):
            with self.subTest(files=files):
                result = self.select(["docker-compose-web-ci.yml", *files])
                self.assertNotEqual(result.returncode, 0)
                self.assertEqual(result.stdout, "")
                self.assertIn("Incomplete Server Gateway admission fixture", result.stderr)

    def test_missing_server_checkout_fails_without_a_selected_override(self):
        result = self.select([])
        self.assertNotEqual(result.returncode, 0)
        self.assertEqual(result.stdout, "")


if __name__ == "__main__":
    unittest.main()
