"""Entry-point alias: existing launchd and Docker configs start backend_api.main:app.

The app now lives in optionflow/main.py; this alias goes away in plan step 6.
"""
from optionflow.main import app  # noqa: F401
