"""web/openapi.json (the source of web/lib/api-types.ts) must match the API.

If this fails: python scripts/export_openapi.py && (cd web && npm run gen:api)
"""
import json
from pathlib import Path

from optionflow.core.settings import Settings
from optionflow.main import create_app
from optionflow.modules.registry import MODULES


def test_committed_openapi_schema_is_current():
    live = create_app(Settings(_env_file=None, enabled_modules=",".join(MODULES))).openapi()
    committed = json.loads((Path(__file__).resolve().parent.parent / "web" / "openapi.json").read_text())
    assert committed == json.loads(json.dumps(live)), \
        "API changed: run `python scripts/export_openapi.py && (cd web && npm run gen:api)`"
