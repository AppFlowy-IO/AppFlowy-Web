"""Check browser CORS across the real nginx rewrite and proxy boundary."""

import json
from pathlib import Path
import subprocess
import tempfile
import unittest
from urllib.error import HTTPError
from urllib.request import build_opener, ProxyHandler, Request
import uuid

from web_ci_gateway_routes import prepare_routes


SOURCE = """location ~ ^/api/workspace/[^/]+/(database-view-creation-status|page-view)/?$ {
    set $appflowy_api_limits_backend "http://appflowy_gateway:8100";
    proxy_pass $appflowy_api_limits_backend;
}
"""
EDGE = """events {}
http {
    resolver 127.0.0.11 ipv6=off;
    map $http_origin $cors_origin { default $http_origin; }
    map $http_access_control_request_headers $cors_headers { default $http_access_control_request_headers; }
    map $request_method $cors_methods { default "GET, POST, PUT, DELETE, PATCH, OPTIONS"; }
    server {
        listen 80;
        location /api {
            include /etc/nginx/gateway-routes.conf;
            if ($request_method = 'OPTIONS') {
                add_header Access-Control-Allow-Origin $cors_origin always;
                return 204;
            }
            add_header Access-Control-Allow-Origin $cors_origin always;
            add_header Access-Control-Allow-Credentials true always;
            proxy_pass http://appflowy_gateway:8100;
        }
    }
}
"""
UPSTREAM = """events {}
http { server {
    listen 8100;
    if ($request_method = 'OPTIONS') { return 405; }
    if ($request_method = 'POST') { return 409; }
    return 200 "gateway";
} }
"""


class GatewayCorsTest(unittest.TestCase):
    def test_preflight_and_actual_gateway_responses_keep_browser_cors(self):
        with tempfile.TemporaryDirectory(prefix="web-ci-gateway-cors-") as directory:
            root = Path(directory)
            source = root / "server-routes.conf"
            routes = root / "web-routes.conf"
            prepared_routes = root / "prepared-web-routes.conf"
            source.write_text(SOURCE)
            routes.write_text(SOURCE)
            (root / "nginx.conf").write_text(EDGE)
            (root / "upstream.conf").write_text(UPSTREAM)
            health = {"test": ["CMD", "nginx", "-t"], "interval": "1s", "timeout": "1s", "retries": 10}
            config = {"services": {
                "appflowy_gateway": {
                    "image": "nginx:alpine", "healthcheck": health,
                    "volumes": [f"{root / 'upstream.conf'}:/etc/nginx/nginx.conf:ro"],
                },
                "nginx": {
                    "image": "nginx:alpine", "healthcheck": health,
                    "depends_on": {"appflowy_gateway": {"condition": "service_healthy"}},
                    "ports": ["127.0.0.1::80"],
                    "volumes": [f"{root / 'nginx.conf'}:/etc/nginx/nginx.conf:ro",
                                f"{routes}:/etc/nginx/gateway-routes.conf:ro"],
                },
            }}
            compose_file = root / "compose.json"
            compose_file.write_text(json.dumps(config))
            compose = ["docker", "compose", "-p", f"web-ci-cors-{uuid.uuid4().hex[:12]}", "-f", str(compose_file)]

            def run(*args):
                return subprocess.check_output(compose + list(args), text=True,
                                               stderr=subprocess.STDOUT, timeout=60)

            opener = build_opener(ProxyHandler({}))
            origin = "http://localhost:3000"
            base_url = ""

            def request(method, path):
                headers = {"Origin": origin, "Access-Control-Request-Method": "POST",
                           "Access-Control-Request-Headers": "authorization, client-version"}
                try:
                    return opener.open(Request(base_url + path, method=method, headers=headers), timeout=5)
                except HTTPError as error:
                    return error

            try:
                run("pull", "--quiet")
                run("up", "-d", "--wait", "--no-build", "--pull", "never")
                base_url = "http://" + run("port", "nginx", "80").strip()
                # A child location's rewrite directives replace the parent's
                # preflight handling, reproducing the browser's HTTP 405.
                with request("OPTIONS", "/api/workspace/test/page-view") as response:
                    self.assertEqual(response.status, 405)

                prepare_routes(source, prepared_routes)
                self.assertEqual(source.read_text(), SOURCE)
                config["services"]["nginx"]["volumes"][1] = (
                    f"{prepared_routes}:/etc/nginx/gateway-routes.conf:ro"
                )
                compose_file.write_text(json.dumps(config))
                run("up", "-d", "--wait", "--no-build", "--pull", "never")
                base_url = "http://" + run("port", "nginx", "80").strip()
                for endpoint in ("page-view", "database-view-creation-status"):
                    for method, expected in (("OPTIONS", 204), ("GET", 200), ("POST", 409)):
                        with self.subTest(endpoint=endpoint, method=method):
                            with request(method, f"/api/workspace/test/{endpoint}") as response:
                                self.assertEqual(response.status, expected)
                                self.assertEqual(response.headers["Access-Control-Allow-Origin"], origin)
                                self.assertEqual(response.headers["Access-Control-Allow-Credentials"], "true")
                                if method == "OPTIONS":
                                    self.assertIn("POST", response.headers["Access-Control-Allow-Methods"])
                                    self.assertEqual(response.headers["Access-Control-Allow-Headers"],
                                                     "authorization, client-version")
            except subprocess.CalledProcessError as error:
                self.fail(error.output[-4000:])
            finally:
                run("down", "--timeout", "1", "--volumes", "--remove-orphans")


if __name__ == "__main__":
    unittest.main()
