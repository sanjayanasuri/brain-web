"""
Build a SAFE curated demo dataset from a personal graph export.

Goal: produce two files that are safe to upload publicly:
- graph/demo_nodes.csv  (no notes_key, lecture_key, etc)
- graph/demo_edges.csv  (no relation_notes_key, etc)

Default filter:
- domain == "Software Architecture"
- node_id matches ^N\\d+$  (keeps simple curated IDs like N001; drops Notion-ish IDs)
- edges kept only if both endpoints are kept nodes
"""

import argparse
import csv
import re
from pathlib import Path
from typing import Dict, Iterable, List, Set, Tuple


NODE_ID_RE_DEFAULT = r"^N\d+$"


def read_csv(path: Path) -> List[Dict[str, str]]:
    with path.open("r", newline="", encoding="utf-8") as f:
        return list(csv.DictReader(f))


def write_csv(path: Path, fieldnames: List[str], rows: Iterable[Dict[str, str]]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open("w", newline="", encoding="utf-8") as f:
        w = csv.DictWriter(f, fieldnames=fieldnames)
        w.writeheader()
        for r in rows:
            w.writerow({k: r.get(k, "") for k in fieldnames})


def main() -> int:
    p = argparse.ArgumentParser()
    p.add_argument("--in-nodes", default=str(Path("graph") / "nodes_semantic.csv"))
    p.add_argument("--in-edges", default=str(Path("graph") / "edges_semantic.csv"))
    p.add_argument("--out-nodes", default=str(Path("graph") / "demo_nodes.csv"))
    p.add_argument("--out-edges", default=str(Path("graph") / "demo_edges.csv"))
    p.add_argument("--domain", default="Software Architecture")
    p.add_argument("--node-id-regex", default=NODE_ID_RE_DEFAULT)
    args = p.parse_args()

    in_nodes = Path(args.in_nodes)
    in_edges = Path(args.in_edges)
    out_nodes = Path(args.out_nodes)
    out_edges = Path(args.out_edges)

    node_id_re = re.compile(args.node_id_regex)

    nodes = read_csv(in_nodes)
    edges = read_csv(in_edges)

    kept_nodes: List[Dict[str, str]] = []
    kept_ids: Set[str] = set()

    for n in nodes:
        node_id = (n.get("node_id") or "").strip()
        domain = (n.get("domain") or "").strip()
        if not node_id:
            continue
        if domain != args.domain:
            continue
        if not node_id_re.match(node_id):
            continue
        kept_ids.add(node_id)
        kept_nodes.append(
            {
                "node_id": node_id,
                "name": (n.get("name") or "").strip(),
                "domain": domain,
                "type": (n.get("type") or "").strip(),
            }
        )

    kept_edges: List[Dict[str, str]] = []
    for e in edges:
        s = (e.get("source_id") or "").strip()
        t = (e.get("target_id") or "").strip()
        pred = (e.get("predicate") or e.get("type") or "").strip()
        if not s or not t or not pred:
            continue
        if s not in kept_ids or t not in kept_ids:
            continue
        kept_edges.append({"source_id": s, "predicate": pred, "target_id": t})

    write_csv(out_nodes, ["node_id", "name", "domain", "type"], kept_nodes)
    write_csv(out_edges, ["source_id", "predicate", "target_id"], kept_edges)

    print(f"Input nodes: {len(nodes)}  -> demo nodes: {len(kept_nodes)}  ({out_nodes})")
    print(f"Input edges: {len(edges)}  -> demo edges: {len(kept_edges)}  ({out_edges})")
    print("Demo dataset contains ONLY: node_id,name,domain,type and source_id,predicate,target_id")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())


