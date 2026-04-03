"""CLI: export analysis JSON to Markdown. Canonical implementation: src.pipeline.audit_report_export."""
import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from src.pipeline.audit_report_export import export_from_dict  # noqa: E402


def export(
    json_path: Path,
    out_path: Path | None = None,
    *,
    audit_pack: bool = False,
) -> str:
    """Load analysis JSON from file and write markdown."""
    data = json.loads(json_path.read_text(encoding="utf-8"))
    report = export_from_dict(data, audit_pack=audit_pack)
    out_path = out_path or json_path.with_suffix(".md")
    out_path.write_text(report, encoding="utf-8")
    return str(out_path)


def main() -> None:
    args = [a for a in sys.argv[1:] if a != "--audit-pack"]
    audit_pack = "--audit-pack" in sys.argv[1:]
    default = Path(__file__).resolve().parent.parent / "test_result_vehicle_loading.json"
    src = Path(args[0]) if args else default
    if not src.exists():
        print(f"File not found: {src}")
        sys.exit(1)
    out = export(src, audit_pack=audit_pack)
    print(f"Report saved to {out}")


if __name__ == "__main__":
    main()
