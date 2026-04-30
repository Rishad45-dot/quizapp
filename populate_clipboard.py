import json
import os
import sys
import time
import pyperclip

MAPPING_FILE = "chapterid_map.json"

def load_mapping():
    with open(MAPPING_FILE, 'r', encoding='utf-8') as f:
        return json.load(f)

def extract_chapter_id(data):
    """Extract chapterId from the API response structure."""
    if "data" in data and "record" in data["data"] and "chapterId" in data["data"]["record"]:
        return data["data"]["record"]["chapterId"]
    if "record" in data and "chapterId" in data["record"]:
        return data["record"]["chapterId"]
    if "chapterId" in data:
        return data["chapterId"]
    return None

def process_clipboard(mapping):
    clipboard = pyperclip.paste().strip()
    if not clipboard:
        return False
    
    try:
        api_data = json.loads(clipboard)
    except json.JSONDecodeError:
        # Not valid JSON – ignore silently in watch mode
        return False
    
    chapter_id = extract_chapter_id(api_data)
    if not chapter_id:
        return False
    
    if chapter_id not in mapping:
        print(f"⚠️  No mapping found for chapterId: {chapter_id}")
        return False
    
    target_file = mapping[chapter_id]
    # Create backup only once
    backup_file = target_file + ".bak"
    if os.path.exists(target_file) and not os.path.exists(backup_file):
        with open(target_file, 'r', encoding='utf-8') as src:
            with open(backup_file, 'w', encoding='utf-8') as dst:
                dst.write(src.read())
    
    # Write clipboard content exactly as is
    with open(target_file, 'w', encoding='utf-8') as f:
        f.write(clipboard)
    
    print(f"✅ Updated: {target_file}")
    return True

def watch_clipboard(mapping):
    print("🔍 Watching clipboard for JSON data. Press Ctrl+C to stop.")
    last_content = ""
    while True:
        try:
            current = pyperclip.paste().strip()
            # Only process if content changed and is not empty
            if current and current != last_content:
                # Quick check: if it looks like JSON (starts with { or [)
                if current.startswith(('{', '[')):
                    print("\n📋 New clipboard data detected.")
                    process_clipboard(mapping)
                    last_content = current
            time.sleep(1)  # Check every second
        except KeyboardInterrupt:
            print("\n🛑 Monitoring stopped.")
            break
        except Exception as e:
            print(f"Error in watch loop: {e}")
            time.sleep(2)

def main():
    if not os.path.exists(MAPPING_FILE):
        print(f"Error: {MAPPING_FILE} not found. Run build_mapping_from_sources.py first.")
        sys.exit(1)
    
    mapping = load_mapping()
    print(f"Loaded mapping with {len(mapping)} entries.")
    
    if len(sys.argv) > 1 and sys.argv[1] == "--watch":
        watch_clipboard(mapping)
    else:
        # One-shot mode
        process_clipboard(mapping)

if __name__ == "__main__":
    main()