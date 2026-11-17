"""VerifyStack Extractor_Service (run as package ``services.extractor`` from the repo root)."""

import os

# Must be set before pydantic-ai loads. The banner prints to stdout on the first
# agent run and would corrupt CLI JSON output.
os.environ.setdefault("PYDANTIC_AI_NO_BANNER", "1")

__version__ = "0.1.0"

__all__ = ["__version__"]
