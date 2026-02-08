import base64
import io

from PIL import Image

from models_note_images import NoteImageIngestRequest
from services_note_images import ingest_note_image, normalize_bbox_to_pct


def _png_data_url(*, width: int = 64, height: int = 32) -> str:
    img = Image.new("RGB", (width, height), color=(255, 255, 255))
    buf = io.BytesIO()
    img.save(buf, format="PNG")
    b64 = base64.b64encode(buf.getvalue()).decode("utf-8")
    return f"data:image/png;base64,{b64}"


def test_normalize_bbox_pct_clips_and_keeps_unit_pct():
    sel = normalize_bbox_to_pct(
        x=-0.1,
        y=0.2,
        w=0.5,
        h=2.0,
        unit="pct",
        image_width=None,
        image_height=None,
    )
    assert sel is not None
    assert sel["unit"] == "pct"
    assert 0.0 <= sel["x"] <= 1.0
    assert 0.0 <= sel["y"] <= 1.0
    assert 0.0 < sel["w"] <= 1.0
    assert 0.0 < sel["h"] <= 1.0


def test_normalize_bbox_px_requires_dimensions():
    sel = normalize_bbox_to_pct(
        x=10,
        y=10,
        w=10,
        h=10,
        unit="px",
        image_width=None,
        image_height=None,
    )
    assert sel is None


def test_ingest_note_image_builds_bbox_anchors(mock_neo4j_session, monkeypatch):
    # Avoid filesystem I/O in tests
    import services_note_images as svc

    monkeypatch.setattr(
        svc,
        "save_file",
        lambda content, filename, tenant_id=None: ("/static/resources/test.png", "/tmp/test.png"),
    )

    payload = NoteImageIngestRequest(
        image_data=_png_data_url(width=100, height=50),
        title="Test Whiteboard",
        ocr_engine="tesseract.js",
        ocr_blocks=[
            {
                "text": "centromere",
                "confidence": 92.0,
                "bbox": {"x": 10, "y": 5, "w": 40, "h": 10, "unit": "px"},
            }
        ],
    )

    resp = ingest_note_image(session=mock_neo4j_session, payload=payload, tenant_id="test-tenant")
    assert resp.status == "ok"
    assert resp.image_url == "/static/resources/test.png"
    assert resp.blocks
    blk = resp.blocks[0]
    assert blk.text == "centromere"
    assert blk.anchor["selector"]["kind"] == "bbox"
    assert blk.anchor["selector"]["unit"] == "pct"
    assert 0.0 <= blk.anchor["selector"]["x"] <= 1.0
    assert blk.quote_id and blk.quote_id.startswith("QIMG_")

