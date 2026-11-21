"""Exercise paired-runtime workflow inputs without services or account settings."""

import json
import os
from pathlib import Path
import subprocess
import tempfile
import unittest

import yaml


ROOT = Path(__file__).resolve().parents[2]
WORKFLOW = yaml.safe_load((ROOT / ".github/workflows/playwright-test.yml").read_text())


class InteropWorkflowTest(unittest.TestCase):
    def step(self, name):
        return next(step for step in WORKFLOW["jobs"]["test"]["steps"] if step.get("name") == name)

    def test_cached_browser_setup_is_bounded_in_both_database_jobs(self):
        for job in ("test", "dashboard-large-database"):
            with self.subTest(job=job):
                steps = WORKFLOW["jobs"][job]["steps"]
                cache = next(step for step in steps if step.get("id") == "playwright-cache")
                install = next(step for step in steps if step.get("uses") == "./.github/actions/install-chromium")
                self.assertLess(steps.index(cache), steps.index(install))
                self.assertGreater(install["timeout-minutes"], 0)
                self.assertLessEqual(install["timeout-minutes"], 25)
                self.assertEqual(install["with"]["cache-hit"], "${{ steps.playwright-cache.outputs.cache-hit }}")

    def test_chromium_dependencies_and_downloads_follow_the_browser_cache(self):
        action = yaml.safe_load((ROOT / ".github/actions/install-chromium/action.yml").read_text())
        checkout, install = action["runs"]["steps"]
        self.assertEqual(checkout["with"]["repository"], "AppFlowy-IO/AppFlowy-CI")
        self.assertRegex(checkout["with"]["ref"], r"^[a-f0-9]{40}$")
        self.assertFalse(checkout["with"]["persist-credentials"])
        self.assertEqual(install["env"]["PLAYWRIGHT_CACHE_HIT"], "${{ inputs.cache-hit }}")
        with tempfile.TemporaryDirectory() as directory:
            temporary = Path(directory)
            trace = temporary / "commands"
            # Shell functions record attempts and preserve failures from package setup.
            shell = '''
                sudo() { printf '%s\\n' "$*" >> "$TRACE"; }
                pnpm() {
                    printf '%s\\n' "$*" >> "$TRACE"
                    [[ "$*" != "exec playwright install-deps chromium" ]] || return "$DEPENDENCY_EXIT"
                }
            ''' + install["run"]
            for cached, dep_exit in (("true", 0), ("false", 0), ("", 0), ("false", 7)):
                with self.subTest(cached=cached, dep_exit=dep_exit):
                    trace.write_text("")
                    env = {**os.environ, "TRACE": str(trace), "GITHUB_WORKSPACE": directory,
                           "PLAYWRIGHT_CACHE_HIT": cached, "DEPENDENCY_EXIT": str(dep_exit)}
                    result = subprocess.run(["bash", "-eo", "pipefail", "-c", shell], env=env)
                    self.assertEqual(result.returncode, dep_exit)
                    setup, *commands = trace.read_text().splitlines()
                    script = temporary / checkout["with"]["path"] / ".github/scripts/configure_flutter_apt.py"
                    self.assertEqual(setup, f"--preserve-env=GITHUB_ACTIONS,RUNNER_OS python3 {script} --network-only")
                    expected = ["exec playwright install-deps chromium"]
                    if cached != "true" and not dep_exit:
                        expected.append("exec playwright install chromium")
                    self.assertEqual(commands, expected)

    def selection(self, **values):
        with tempfile.TemporaryDirectory() as directory:
            output = Path(directory) / "outputs"
            output.touch()
            env = {**os.environ, "GITHUB_OUTPUT": str(output), "CI_TOOLS_REF": "a" * 40,
                   "CLOUD_SOURCE_SHA": "", "IMAGE_RUN_ID": "", "PUBLISHED_VERSION": "", **values}
            result = subprocess.run(["bash", "-c", self.step("Validate compatibility runtime selection")["run"]],
                                    env=env, text=True, capture_output=True)
            return result.returncode, output.read_text()

    def test_paired_interop_defaults_to_verified_artifact_selection(self):
        code, output = self.selection()
        self.assertEqual(code, 0)
        self.assertIn("needs-tools=true", output)
        inputs = WORKFLOW[True]["workflow_dispatch"]["inputs"]
        self.assertEqual(inputs["cloud_version"]["default"], "")
        self.assertIn("cloud_source_sha", inputs)
        self.assertIn("cloud_image_run_id", inputs)
        self.assertIn("ci_tools_ref", inputs)

    def test_explicit_registry_version_preserves_the_registry_path(self):
        code, output = self.selection(PUBLISHED_VERSION="published-candidate")
        self.assertEqual(code, 0)
        self.assertNotIn("needs-tools=true", output)
        self.assertEqual(self.step("Resolve latest Cloud release")["if"],
                         "steps.cloud-selection.outputs.enabled != 'true'")

    def test_complete_exact_pair_uses_tools_but_partial_or_conflicting_pairs_fail(self):
        pair = {"CLOUD_SOURCE_SHA": "b" * 40, "IMAGE_RUN_ID": "123"}
        code, output = self.selection(**pair)
        self.assertEqual(code, 0)
        self.assertIn("needs-tools=true", output)
        for values in ({"CLOUD_SOURCE_SHA": "b" * 40}, {"IMAGE_RUN_ID": "123"},
                       {**pair, "PUBLISHED_VERSION": "latest"},
                       {"CLOUD_SOURCE_SHA": "main", "IMAGE_RUN_ID": "123"},
                       {"CI_TOOLS_REF": "main"}):
            with self.subTest(values=values):
                self.assertNotEqual(self.selection(**values)[0], 0)

    def test_centralized_verification_runs_after_each_source_checkout(self):
        steps = WORKFLOW["jobs"]["test"]["steps"]
        exact = self.step("Start the verified exact Cloud runtime")
        for name in ("Checkout Desktop SDK under test", "Check out the pinned CI runtime tools",
                     "Checkout AppFlowy-Cloud-Premium", "Setup AppFlowy Cloud"):
            self.assertLess(steps.index(self.step(name)), steps.index(exact))
        self.assertEqual(exact["uses"], "./.ci-runtime-tools/.github/actions/desktop-cloud-runtime")
        self.assertEqual(exact["with"]["runtime-profile"], "web")
        self.assertEqual(exact["with"]["ci-tools-ref"], "${{ env.CI_TOOLS_REF }}")
        self.assertEqual(exact["if"], "steps.cloud-selection.outputs.enabled == 'true'")
        self.assertNotIn("continue-on-error", exact)
        self.assertRegex(WORKFLOW["jobs"]["test"]["env"]["CI_TOOLS_REF"], r"'[a-f0-9]{40}'")

    def test_only_immutable_tools_reachable_from_ci_main_can_run(self):
        verify = self.step("Verify CI runtime tools are reviewed on main")
        checkout = self.step("Check out the pinned CI runtime tools")
        steps = WORKFLOW["jobs"]["test"]["steps"]
        self.assertLess(steps.index(verify), steps.index(checkout))
        self.assertLess(steps.index(checkout), steps.index(self.step("Select verified prebuilt Cloud artifacts")))
        self.assertEqual(verify["if"], "steps.cloud-input.outputs.needs-tools == 'true'")
        self.assertEqual(checkout["if"], verify["if"])
        self.assertEqual(verify["env"]["GH_TOKEN"], "${{ secrets.CI_TOKEN }}")
        self.assertNotIn("continue-on-error", verify)
        self.assertNotIn("continue-on-error", checkout)
        with tempfile.TemporaryDirectory() as directory:
            gh = Path(directory) / "gh"
            gh.write_text('''#!/usr/bin/env bash
set -euo pipefail
[[ "$*" == "api repos/AppFlowy-IO/AppFlowy-CI/compare/$CI_TOOLS_REF...main --jq .merge_base_commit.sha" ]] || exit 9
[[ "$GH_API_STATUS" == 0 ]] || exit "$GH_API_STATUS"
printf '%s\\n' "$GH_MERGE_BASE"
''')
            gh.chmod(0o755)
            for merge_base, api_status, accepted in (("a" * 40, "0", True),
                                                     ("b" * 40, "0", False),
                                                     ("", "0", False),
                                                     ("a" * 40, "1", False)):
                with self.subTest(merge_base=merge_base, api_status=api_status):
                    env = {**os.environ, "PATH": f"{directory}:{os.environ['PATH']}",
                           "CI_TOOLS_REF": "a" * 40, "GH_MERGE_BASE": merge_base,
                           "GH_API_STATUS": api_status}
                    result = subprocess.run(["bash", "-c", verify["run"]], env=env,
                                            text=True, capture_output=True)
                    self.assertEqual(result.returncode == 0, accepted, result.stdout + result.stderr)

    def test_automatic_selection_uses_the_helper_and_never_requests_image_builds(self):
        script = self.step("Select verified prebuilt Cloud artifacts")["run"]
        self.assertIn("desktop_cloud_runtime.py select", script)
        self.assertIn('--ci-ref "$CI_TOOLS_REF"', script)
        self.assertNotIn("workflow run", script)
        self.assertNotIn("docker build", script)
        self.assertEqual(self.step("Upload exact Cloud runtime manifest")["if"],
                         "always() && steps.cloud-input.outputs.needs-tools == 'true'")

    def test_live_row_editor_requires_paired_images_and_enables_the_feature_before_startup(self):
        select = next(step for step in WORKFLOW["jobs"]["build"]["steps"] if step.get("name") == "Select test groups")
        with tempfile.TemporaryDirectory() as directory:
            for source, image, interop, accepted in [
                ("", "", "true", False), ("b" * 40, "", "true", False),
                ("b" * 40, "0", "true", False), ("main", "123", "true", False),
                ("b" * 40, "123", "false", False), ("b" * 40, "123", "true", True),
            ]:
                with self.subTest(source=source, image=image, interop=interop):
                    output = Path(directory) / "output"
                    output.write_text("")
                    env = {**os.environ, "GITHUB_OUTPUT": str(output), "INTEROP_ONLY": interop,
                           "CLOUD_SOURCE_SHA": source, "CLOUD_IMAGE_RUN_ID": image, "REQUIRE_ROW_AUTOMATIONS": "true"}
                    rc = subprocess.run(["bash", "-c", select["run"]], cwd=ROOT, env=env, capture_output=True)
                    self.assertEqual(rc.returncode == 0, accepted, rc.stderr)
        enable = self.step("Enable row automations for the paired editor test")
        case = self.step("Test the live Web row automation editor")
        steps = WORKFLOW["jobs"]["test"]["steps"]
        self.assertEqual(enable["if"], "matrix.test-group.name == 'template-interop' && (inputs.require_row_automations || inputs.require_workspace_webhook_policy)")
        self.assertEqual(case["if"], enable["if"])
        self.assertLess(steps.index(enable), steps.index(self.step("Start Docker services")))
        self.assertLess(steps.index(self.step("Start Docker services")), steps.index(case))
        self.assertIn("APPFLOWY_DATABASE_AUTOMATIONS_ENABLED=true", enable["run"])
        self.assertEqual(case["env"]["APPFLOWY_TEST_REQUIRE_ROW_AUTOMATIONS"], "true")
        self.assertTrue((ROOT / "playwright/e2e/database/automation-row-editor.spec.ts").is_file())
        self.assertIn("playwright/e2e/database/automation-row-editor.spec.ts", case["run"])

    def test_workspace_webhook_policy_uses_the_paired_editor_and_requires_exact_images(self):
        select = next(step for step in WORKFLOW["jobs"]["build"]["steps"] if step.get("id") == "groups")
        self.assertIn("inputs.require_workspace_webhook_policy", select["env"]["REQUIRE_ROW_AUTOMATIONS"])
        case = self.step("Test the live Web row automation editor")
        self.assertIn("inputs.require_workspace_webhook_policy", case["if"])
        self.assertEqual(case["env"]["APPFLOWY_TEST_REQUIRE_WORKSPACE_WEBHOOK_POLICY"],
                         "${{ inputs.require_workspace_webhook_policy }}")

    def test_exact_inputs_cannot_be_ignored_by_a_noninterop_run(self):
        step = next(step for step in WORKFLOW["jobs"]["build"]["steps"]
                    if step.get("name") == "Select test groups")
        with tempfile.TemporaryDirectory() as directory:
            output = Path(directory) / "outputs"
            env = {**os.environ, "GITHUB_OUTPUT": str(output), "INTEROP_ONLY": "false",
                   "CLOUD_SOURCE_SHA": "b" * 40, "CLOUD_IMAGE_RUN_ID": "123"}
            result = subprocess.run(["bash", "-c", step["run"]], cwd=ROOT,
                                    env=env, text=True, capture_output=True)
            self.assertNotEqual(result.returncode, 0)
            self.assertIn("Exact Cloud artifacts require interop_only=true", result.stderr)
            env.update(INTEROP_ONLY="true")
            result = subprocess.run(["bash", "-c", step["run"]], cwd=ROOT,
                                    env=env, text=True, capture_output=True)
            self.assertEqual(result.returncode, 0, result.stderr)
            groups = json.loads(output.read_text().split("=", 1)[1])
            self.assertEqual([group["name"] for group in groups], ["template-interop"])


if __name__ == "__main__":
    unittest.main()
