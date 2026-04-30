import json
import os
import re
import unicodedata
from pathlib import Path

# Configuration – adjust these paths to match your environment
SOURCE_FILES = {
    "Saunders": r"C:\Users\User\Desktop\FFMPEG\practice_exam\chaperlistRN\RNCGN练习题库 Saunders.json",
    "Uworld": r"C:\Users\User\Desktop\FFMPEG\practice_exam\chaperlistRN\RNCGN练习题库 Uworldchapterlist.json",
    "医学术语": r"C:\Users\User\Desktop\FFMPEG\practice_exam\chaperlistRN\RNCGN练习题库 医学术语.json",
    "患者需求": r"C:\Users\User\Desktop\FFMPEG\practice_exam\chaperlistRN\RNCGN练习题库 患者需求.json",
}

BASE_OUTPUT_DIR = r"C:\Users\User\Desktop\FFMPEG\practice_exam\analysis\RNCGN练习题库"
MAPPING_OUTPUT = "chapterid_map.json"

def sanitize_filename(name: str) -> str:
    name = unicodedata.normalize('NFC', name)
    name = name.replace('\uFF06', '&')
    name = name.replace('\u00A0', ' ')
    name = name.replace('\u2002', ' ')
    name = name.replace('\u2003', ' ')
    name = name.replace('\u2009', ' ')
    name = name.replace('\u202F', ' ')
    invalid_chars = r'[\\/*?:"<>|]'
    name = re.sub(invalid_chars, '_', name)
    name = name.strip(' .')
    return name if name else "_empty_"

def build_mapping_for_source(source_name, source_json_path, root_output_dir):
    """Recursively walk the source JSON and map leaf node id -> file path."""
    mapping = {}
    with open(source_json_path, 'r', encoding='utf-8') as f:
        data = json.load(f)
    
    def recurse(node, current_dir):
        node_name = node.get('name')
        if not node_name:
            return
        sanitized = sanitize_filename(node_name)
        children = node.get('childrens')
        if children and len(children) > 0:
            # Folder
            folder_path = os.path.join(current_dir, sanitized)
            for child in children:
                recurse(child, folder_path)
        else:
            # Leaf – map the node's id to the file path
            node_id = node.get('id')
            if node_id:
                filename = sanitized + ".json"
                filepath = os.path.join(current_dir, filename)
                mapping[node_id] = filepath
    
    # Top-level nodes (parentId == "-1") are the root folders
    for top in data.get("data", []):
        if top.get("parentId") == "-1":
            recurse(top, root_output_dir)
    return mapping

# Collect all mappings
all_mappings = {}
for source_name, src_path in SOURCE_FILES.items():
    if not os.path.exists(src_path):
        print(f"Warning: {src_path} not found, skipping.")
        continue
    subdir = os.path.join(BASE_OUTPUT_DIR, source_name)
    os.makedirs(subdir, exist_ok=True)  # ensure root folders exist
    m = build_mapping_for_source(source_name, src_path, subdir)
    all_mappings.update(m)
    print(f"Added {len(m)} entries from {source_name}")

# Save the combined mapping
with open(MAPPING_OUTPUT, 'w', encoding='utf-8') as f:
    json.dump(all_mappings, f, indent=2, ensure_ascii=False)

print(f"\nTotal mapping entries: {len(all_mappings)}")
print(f"Saved to {MAPPING_OUTPUT}")