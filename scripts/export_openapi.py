#!/usr/bin/env python3
"""Write the API's OpenAPI schema (every module enabled) for client generation.

    python scripts/export_openapi.py            # -> web/openapi.json
    cd web && npm run gen:api                   # -> web/lib/api-types.ts
"""
import json
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))

from optionflow.core.settings import Settings  # noqa: E402
from optionflow.main import create_app  # noqa: E402
from optionflow.modules.registry import MODULES  # noqa: E402

app = create_app(Settings(_env_file=None, enabled_modules=",".join(MODULES)))
out = ROOT / "web" / "openapi.json"
out.write_text(json.dumps(app.openapi(), indent=1, sort_keys=True) + "\n")
print(f"wrote {out.relative_to(ROOT)}: {len(app.openapi()['paths'])} paths")
