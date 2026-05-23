import json
import re
import os

INPUT_FILE = "chapters_tree.json"
OUTPUT_FILE = "chapters_tree_relative.json"  # or overwrite the original

KNOWN_ROOTS = ["Saunders", "Uworld", "医学术语", "患者需求", "ChapterPractice"]

def to_relative_path(absolute_path):
    """Convert a Windows absolute path to a relative path starting from a known root."""
    # Normalize backslashes to forward slashes for easier handling
    path = absolute_path.replace("\\", "/")
    # Look for the first occurrence of any known root
    for root in KNOWN_ROOTS:
        idx = path.find(root)
        if idx != -1:
            # Return from that root onward
            return path[idx:]
    # If no known root found, return the original path (should not happen)
    return path

def convert_node(node):
    """Recursively convert filePath in leaf nodes."""
    if node.get("isLeaf") and node.get("filePath"):
        original = node["filePath"]
        relative = to_relative_path(original)
        if relative != original:
            print(f"Converting: {original} -> {relative}")
            node["filePath"] = relative
    # Recurse into children if any
    if "children" in node and node["children"]:
        for child in node["children"]:
            convert_node(child)

def main():
    with open(INPUT_FILE, "r", encoding="utf-8") as f:
        data = json.load(f)
    
    # Process each top-level category
    for category, nodes in data.items():
        for node in nodes:
            convert_node(node)
    
    # Write back preserving order and formatting
    with open(OUTPUT_FILE, "w", encoding="utf-8") as f:
        json.dump(data, f, indent=2, ensure_ascii=False)
    print(f"Done. Output written to {OUTPUT_FILE}")

if __name__ == "__main__":
    main()