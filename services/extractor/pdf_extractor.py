"""
PDF Text & Bounding Box Extractor.
Extracts page text with normalized [0, 1] bounding box provenance.
"""

from __future__ import annotations

import hashlib
import io
from typing import Any, Dict, List, Optional
import pdfplumber
from pypdf import PdfReader


def compute_sha256(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


def extract_pdf_pages_with_layout(pdf_bytes: bytes) -> List[Dict[str, Any]]:
    """
    Extracts text, word coordinates, and normalized bounding boxes from a PDF.
    Returns a list of dicts:
      [
        {
          "page_number": 1,
          "width": 595.2,
          "height": 841.8,
          "text": "...",
          "words": [{"text": "...", "bbox": {"x": 0.1, "y": 0.2, "width": 0.05, "height": 0.02}}]
        }
      ]
    """
    results: List[Dict[str, Any]] = []

    with pdfplumber.open(io.BytesIO(pdf_bytes)) as pdf:
        for idx, page in enumerate(pdf.pages):
            p_num = idx + 1
            p_width = float(page.width)
            p_height = float(page.height)

            words_data: List[Dict[str, Any]] = []
            extracted_words = page.extract_words() or []

            for w in extracted_words:
                x0 = float(w.get("x0", 0))
                top = float(w.get("top", 0))
                x1 = float(w.get("x1", 0))
                bottom = float(w.get("bottom", 0))

                # Normalize to [0, 1] coordinates
                norm_x = max(0.0, min(1.0, x0 / p_width)) if p_width > 0 else 0.0
                norm_y = max(0.0, min(1.0, top / p_height)) if p_height > 0 else 0.0
                norm_w = max(0.0, min(1.0, (x1 - x0) / p_width)) if p_width > 0 else 0.0
                norm_h = max(0.0, min(1.0, (bottom - top) / p_height)) if p_height > 0 else 0.0

                words_data.append({
                    "text": str(w.get("text", "")),
                    "bbox": {
                        "x": round(norm_x, 4),
                        "y": round(norm_y, 4),
                        "width": round(norm_w, 4),
                        "height": round(norm_h, 4),
                    }
                })

            results.append({
                "page_number": p_num,
                "width": p_width,
                "height": p_height,
                "text": page.extract_text() or "",
                "words": words_data,
            })

    return results
