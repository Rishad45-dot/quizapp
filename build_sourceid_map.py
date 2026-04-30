import os
import json
import glob

# Set the root directory containing all your chapter folders
# Adjust this path to match your actual location
ROOT_DIR = r"C:\Users\User\Desktop\FFMPEG\practice_exam\analysis\RNCGN练习题库"

OUTPUT_MAP = "sourceid_map.json"

mapping = {}

# Walk through all JSON files under ROOT_DIR
for root, dirs, files in os.walk(ROOT_DIR):
    for file in files:
        if file.endswith(".json"):
            filepath = os.path.join(root, file)
            try:
                with open(filepath, 'r', encoding='utf-8') as f:
                    data = json.load(f)
                source_id = data.get("sourceId")
                if source_id:
                    # If duplicate sourceId appears, keep the first (or handle conflict)
                    if source_id not in mapping:
                        mapping[source_id] = filepath
                    else:
                        print(f"Warning: duplicate sourceId {source_id} found in {filepath}")
            except Exception as e:
                print(f"Error reading {filepath}: {e}")

with open(OUTPUT_MAP, 'w', encoding='utf-8') as f:
    json.dump(mapping, f, indent=2, ensure_ascii=False)

print(f"Mapping saved to {OUTPUT_MAP} with {len(mapping)} entries.")