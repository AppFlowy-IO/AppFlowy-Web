"""Add the Web fixture's preflight handling to the immutable Server route definitions."""

from pathlib import Path
import re
import sys


PREFLIGHT = """
    # Web CI serves its browser frontend separately from the HTTPS API.
    if ($request_method = 'OPTIONS') {
        add_header 'Access-Control-Allow-Origin' $cors_origin always;
        add_header 'Access-Control-Allow-Credentials' 'true' always;
        add_header 'Access-Control-Allow-Methods' $cors_methods always;
        add_header 'Access-Control-Allow-Headers' $cors_headers always;
        add_header 'Access-Control-Max-Age' 86400 always;
        return 204;
    }
"""


def prepare_routes(source: Path, destination: Path):
    if source.resolve() == destination.resolve():
        raise ValueError("Keep the immutable Server routes separate from the Web fixture")
    routes = source.read_text()
    prepared, count = re.subn(r"(?m)^(location[^\n]*\{)[ \t]*$",
                              lambda match: match.group(1) + PREFLIGHT, routes)
    if not count:
        raise ValueError("Server Gateway routes contain no location blocks")
    destination.write_text(prepared)


if __name__ == "__main__":
    prepare_routes(Path(sys.argv[1]), Path(sys.argv[2]))
