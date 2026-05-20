#!/usr/bin/env python3
# -*- coding: utf-8 -*-

"""
generate_chapters_tree.py

This script scans the RNCGN练习题库 folder and generates chapters_tree.json
that is used by index.html to display the chapter navigation tree.

It now also supports adding a separate "Chapter Practice" folder located outside
the main quiz structure.

Usage:
    python generate_chapters_tree.py [--deploy]

Options:
    --deploy   Generate relative paths (for GitHub Pages) instead of absolute paths.
               Use this flag when preparing files for deployment.

Example:
    python generate_chapters_tree.py           # Absolute paths (local testing)
    python generate_chapters_tree.py --deploy  # Relative paths (GitHub Pages)
"""

import os
import json
import sys
import argparse
from pathlib import Path

# ==================== USER CONFIGURATION ====================
# Change these paths to match your actual folder locations

# Root directory containing the main quiz folders (医学术语, Saunders, Uworld, 患者需求)
MAIN_ROOT = r"C:\Users\User\Desktop\quizapp"

# Path to the existing chapters_tree.json (usually inside MAIN_ROOT)
TREE_PATH = os.path.join(MAIN_ROOT, "chapters_tree.json")

# Path to the separate "Chapter Practice" folder (outside the main root)
# Set to None if you don't want to include it
CHAPTER_PRACTICE_ROOT = None

# Order of top-level categories in the tree (preserves display order)
TOP_CATEGORIES = ["Saunders", "Uworld", "医学术语", "患者需求", "ChapterPractice"]

# Files and folders to ignore (not scanned)
IGNORE_FILES = {".bak", "chapters_tree.json", "sync.js", "index.html", "quiz_player.html", "sync.py", "generate_chapters_tree.py"}
IGNORE_FOLDERS = {"sync", ".git", "__pycache__", "node_modules", ".vscode"}

# ==================== HELPER FUNCTIONS ====================

def get_question_count(json_path):
    """
    Extract the number of questions from a quiz JSON file.

    The JSON structure can vary slightly. This function tries multiple
    possible paths to find the studentQuestionArray.

    Args:
        json_path (str): Absolute path to the JSON file

    Returns:
        int: Number of questions, or 0 if the file cannot be read or structure is unknown.
    """
    try:
        with open(json_path, 'r', encoding='utf-8') as f:
            data = json.load(f)

        # Try different possible paths to the studentQuestionArray
        # Path 1: data.record.extJson.studentQuestionArray
        student_array = data.get('data', {}).get('record', {}).get('extJson', {}).get('studentQuestionArray')

        # Path 2: record.extJson.studentQuestionArray
        if student_array is None:
            student_array = data.get('record', {}).get('extJson', {}).get('studentQuestionArray')

        # Path 3: extJson.studentQuestionArray
        if student_array is None:
            student_array = data.get('extJson', {}).get('studentQuestionArray')

        # Path 4: direct studentQuestionArray
        if student_array is None:
            student_array = data.get('studentQuestionArray')

        return len(student_array) if student_array else 0

    except Exception as e:
        print(f"⚠️ Could not read {json_path}: {e}")
        return 0


def to_relative_path(absolute_path, base_dir=MAIN_ROOT, is_deploy=False):
    """
    Convert an absolute Windows path to a relative path (for GitHub Pages) or keep absolute.

    Args:
        absolute_path (str): Full absolute path to a file.
        base_dir (str): Base directory to make relative to (usually MAIN_ROOT).
        is_deploy (bool): If True, return relative paths; if False, return absolute.

    Returns:
        str: Either the original absolute path or a relative path.
    """
    if not is_deploy:
        return absolute_path

    # Convert backslashes to forward slashes for web compatibility
    abs_path = Path(absolute_path)
    try:
        rel_path = abs_path.relative_to(Path(base_dir))
        # Convert Windows backslashes to forward slashes
        return str(rel_path).replace('\\', '/')
    except ValueError:
        # If file is outside base_dir (e.g., Chapter Practice folder), try to make relative to its own root
        # For Chapter Practice, we want paths like "Chapter-Practice/62期医学术语/file.json"
        # We'll keep it as a simple relative path from the current working directory
        try:
            rel_to_cwd = abs_path.relative_to(Path.cwd())
            return str(rel_to_cwd).replace('\\', '/')
        except ValueError:
            # Fallback: just return the absolute path
            print(f"⚠️ Could not make relative path for {absolute_path}, keeping absolute.")
            return absolute_path


def scan_directory(dir_path, base_dir=MAIN_ROOT, is_deploy=False, relative_root=""):
    """
    Recursively scan a directory and build a tree node (folder or leaf).

    Args:
        dir_path (str): Absolute path to the directory to scan.
        base_dir (str): Base directory for relative path conversion.
        is_deploy (bool): If True, generate relative paths; if False, absolute.
        relative_root (str): Internal use for recursion – do not set manually.

    Returns:
        list: A list of node dictionaries (folder or leaf).
    """
    items = []

    # Get all items in the directory and sort them alphabetically
    for item in sorted(os.listdir(dir_path)):

        # Skip ignored files and folders
        if item in IGNORE_FILES or item in IGNORE_FOLDERS:
            continue

        full_path = os.path.join(dir_path, item)
        rel_path = os.path.join(relative_root, item) if relative_root else item

        # Case 1: This is a folder (has children)
        if os.path.isdir(full_path):
            # Recursively scan the subfolder
            children = scan_directory(full_path, base_dir, is_deploy, rel_path)

            # Only add the folder if it contains at least one valid child
            if children:
                total_questions = sum(child.get('questionNumber', 0) for child in children)
                items.append({
                    "name": item,
                    "questionNumber": total_questions,
                    "isLeaf": False,
                    "filePath": None,
                    "children": children
                })

        # Case 2: This is a JSON file (leaf node)
        elif item.endswith('.json') and not item.endswith('.bak'):
            # Get the number of questions inside the JSON file
            q_count = get_question_count(full_path)

            # Determine the file path (absolute or relative based on --deploy flag)
            file_path = to_relative_path(full_path, base_dir, is_deploy)

            items.append({
                "name": os.path.splitext(item)[0],
                "questionNumber": q_count,
                "isLeaf": True,
                "filePath": file_path,
                "children": []
            })

    return items


def scan_chapter_practice(chapter_practice_path, is_deploy=False):
    """
    Scan the Chapter Practice folder and return a list of top-level nodes.

    Args:
        chapter_practice_path (str): Absolute path to the Chapter Practice folder.
        is_deploy (bool): If True, generate relative paths; if False, absolute.

    Returns:
        list: A list of node dictionaries (each representing a folder like "62期医学术语").
    """
    if not os.path.exists(chapter_practice_path):
        print(f"⚠️ Chapter Practice folder not found: {chapter_practice_path}")
        return []

    items = []
    # Scan each subfolder inside Chapter Practice (e.g., "62期医学术语")
    for folder in sorted(os.listdir(chapter_practice_path)):
        folder_path = os.path.join(chapter_practice_path, folder)

        # Skip non-directories and ignored items
        if not os.path.isdir(folder_path) or folder in IGNORE_FOLDERS:
            continue

        # Scan the subfolder recursively
        children = scan_directory(folder_path, chapter_practice_path, is_deploy, folder)

        if children:
            total_questions = sum(child.get('questionNumber', 0) for child in children)
            # Convert the folder path to relative if needed
            folder_path_rel = to_relative_path(folder_path, Path.cwd(), is_deploy)
            items.append({
                "name": folder,
                "questionNumber": total_questions,
                "isLeaf": False,
                "filePath": None,
                "children": children
            })

    return items


def update_or_create_tree(main_root, tree_path, chapter_practice_root=None, is_deploy=False):
    """
    Main function: Reads existing tree (if any), updates it with scanned data,
    and writes back to chapters_tree.json.

    Args:
        main_root (str): Path to the main quiz folder.
        tree_path (str): Path to chapters_tree.json.
        chapter_practice_root (str or None): Path to the Chapter Practice folder.
        is_deploy (bool): If True, generate relative paths; if False, absolute.
    """
    # Step 1: Scan the main quiz folders
    print("📁 Scanning main quiz folders...")
    main_tree = {}
    for category in TOP_CATEGORIES:
        # Skip the Chapter Practice category here (it will be added separately)
        if category == "Chapter Practice":
            continue

        category_path = os.path.join(main_root, category)
        if not os.path.exists(category_path):
            print(f"⚠️ Category folder not found: {category_path}")
            main_tree[category] = []
            continue

        print(f"   Scanning: {category}")
        category_children = scan_directory(category_path, main_root, is_deploy)
        main_tree[category] = category_children

    # Step 2: Scan Chapter Practice folder if provided
    if chapter_practice_root and os.path.exists(chapter_practice_root):
        print(f"📁 Scanning Chapter Practice folder: {chapter_practice_root}")
        chapter_practice_tree = scan_chapter_practice(chapter_practice_root, is_deploy)
        main_tree["Chapter Practice"] = chapter_practice_tree
    else:
        print("⚠️ Chapter Practice folder not included (set CHAPTER_PRACTICE_ROOT = None to disable)")

    # Step 3: Write the merged tree to chapters_tree.json
    print(f"📝 Writing tree to: {tree_path}")
    with open(tree_path, 'w', encoding='utf-8') as f:
        json.dump(main_tree, f, indent=2, ensure_ascii=False)

    # Step 4: Print summary
    print("\n✅ Done! Summary:")
    for category, nodes in main_tree.items():
        print(f"   - {category}: {len(nodes)} top-level item(s)")


# ==================== MAIN ENTRY POINT ====================
if __name__ == "__main__":

    # Parse command line arguments
    parser = argparse.ArgumentParser(description="Generate chapters_tree.json for the quiz app")
    parser.add_argument('--deploy', action='store_true',
                        help='Generate relative paths (for GitHub Pages) instead of absolute paths')
    args = parser.parse_args()

    is_deploy = args.deploy

    # Validate that the main root exists
    if not os.path.exists(MAIN_ROOT):
        print(f"❌ Main root directory not found: {MAIN_ROOT}")
        print("Please update the MAIN_ROOT variable in the script to match your actual path.")
        sys.exit(1)

    print("=" * 60)
    print("Chapters Tree Generator")
    print("=" * 60)
    print(f"Main root: {MAIN_ROOT}")
    print(f"Output file: {TREE_PATH}")
    print(f"Chapter Practice: {CHAPTER_PRACTICE_ROOT if CHAPTER_PRACTICE_ROOT else '(not included)'}")
    print(f"Path mode: {'RELATIVE (deploy)' if is_deploy else 'ABSOLUTE (local)'}")
    print("=" * 60)

    # Run the main function
    update_or_create_tree(MAIN_ROOT, TREE_PATH, CHAPTER_PRACTICE_ROOT, is_deploy)

    # Optional: print a reminder about backup
    print("\n💡 Tip: Keep a backup of your previous chapters_tree.json before deploying.")