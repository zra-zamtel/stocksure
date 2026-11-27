"""Every address the mobile app calls must exist here, with that method.

The app built "add staff" against /api/v1/staff while the route lives at
/api/v1/auth/staff, and the only symptom was a vague error on the phone. This
reads the app's API client directly, so a renamed route or a typo in the app
fails here instead of in a shop.
"""

import re
from pathlib import Path

from django.test import SimpleTestCase
from django.urls import Resolver404, resolve

API_CLIENT = Path(__file__).resolve().parents[2] / "mobile" / "src" / "lib" / "api.ts"
# Stands in for ids in a path. A UUID also satisfies int and str converters.
SAMPLE_ID = "3f1c2a8e-0000-4000-8000-000000000001"


def app_calls() -> list[tuple[str, str]]:
    source = API_CLIENT.read_text(encoding="utf-8")
    constants = dict(re.findall(r"const (\w+) = '([^']+)';", source))
    builders = dict(re.findall(r"function (\w+)\([^)]*\): string \{\s*return `([^`]+)`;", source))

    calls = []
    for helper, argument in re.findall(r"\b(postJson|getJson)\(\s*([^,]+?)\s*,", source):
        argument = argument.strip()
        if argument.startswith("path"):
            continue  # the helpers' own definitions
        builder = re.fullmatch(r"(\w+)\(.*\)", argument)
        if builder:
            argument = f"`{builders[builder.group(1)]}`"
        if argument in constants:
            path = constants[argument]
        else:
            path = argument.strip("'`")
            path = re.sub(r"\$\{(\w+)\}", lambda m: constants.get(m.group(1), m.group(0)), path)
            path = re.sub(r"\$\{[^}]*\}", SAMPLE_ID, path)
        path = path.split("?", 1)[0]
        calls.append(("POST" if helper == "postJson" else "GET", path))
    return calls


class MobileRoutesTest(SimpleTestCase):
    def test_reads_the_app_client(self):
        # Guards the parser: if it found almost nothing, the next test proves nothing.
        self.assertGreaterEqual(len(app_calls()), 20)

    def test_every_app_call_has_a_route_and_method(self):
        problems = []
        for method, path in app_calls():
            if not path.startswith("/api/"):
                problems.append(f"{method} {path}: could not read this address")
                continue
            try:
                match = resolve(path)
            except Resolver404:
                problems.append(f"{method} {path}: no such route")
                continue
            view = getattr(match.func, "view_class", None) or getattr(match.func, "cls", None)
            if view is None or not hasattr(view, method.lower()):
                problems.append(f"{method} {path}: route exists but does not accept {method}")
        self.assertEqual(problems, [], "\n".join(problems))
