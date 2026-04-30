import json
import os
from collections import defaultdict

# Paths to your source JSONs (adjust if needed)
SOURCE_PATHS = {
    "Saunders": r"C:\Users\User\Desktop\FFMPEG\practice_exam\chaperlistRN\RNCGN练习题库 Saunders.json",
    "Uworld": r"C:\Users\User\Desktop\FFMPEG\practice_exam\chaperlistRN\RNCGN练习题库 Uworldchapterlist.json",
    "医学术语": r"C:\Users\User\Desktop\FFMPEG\practice_exam\chaperlistRN\RNCGN练习题库 医学术语.json",
    "患者需求": r"C:\Users\User\Desktop\FFMPEG\practice_exam\chaperlistRN\RNCGN练习题库 患者需求.json",
}
MAP_PATH = r"C:\Users\User\Desktop\FFMPEG\practice_exam\analysis\RNCGN练习题库\chapterid_map.json"
OUTPUT_TREE = "chapters_tree.json"

def load_json(path):
    with open(path, 'r', encoding='utf-8') as f:
        return json.load(f)

def build_tree_from_source(source_name, source_data, file_map):
    """
    Recursively build a tree from the source JSON structure.
    Each node: { name, children (list), questionNumber, isLeaf, filePath? }
    """
    def process_node(node, current_path):
        node_name = node.get('name')
        if not node_name:
            return None
        children = node.get('childrens', [])
        node_id = node.get('id')
        question_num = node.get('questionNumber', 0)
        # Check if this node is a leaf (no children)
        is_leaf = not children
        file_path = None
        if is_leaf and node_id and node_id in file_map:
            file_path = file_map[node_id]
        result = {
            "name": node_name,
            "questionNumber": question_num,
            "isLeaf": is_leaf,
            "filePath": file_path,
            "children": []
        }
        if not is_leaf:
            total_questions = 0
            for child in children:
                child_node = process_node(child, current_path + [node_name])
                if child_node:
                    result["children"].append(child_node)
                    total_questions += child_node.get("questionNumber", 0)
            # If no sum from children, keep the node's own questionNumber (top-level)
            result["questionNumber"] = total_questions if total_questions > 0 else question_num
        return result

    # Find top-level nodes (parentId == "-1")
    top_nodes = []
    for item in source_data.get("data", []):
        if item.get("parentId") == "-1":
            node = process_node(item, [source_name])
            if node:
                top_nodes.append(node)
    return {source_name: top_nodes}

def main():
    # Load file mapping (chapterId -> file path)
    file_map = load_json(MAP_PATH)
    full_tree = {}
    for src_name, src_path in SOURCE_PATHS.items():
        if not os.path.exists(src_path):
            print(f"Warning: {src_path} not found, skipping {src_name}")
            continue
        src_data = load_json(src_path)
        tree_part = build_tree_from_source(src_name, src_data, file_map)
        full_tree.update(tree_part)
    with open(OUTPUT_TREE, 'w', encoding='utf-8') as f:
        json.dump(full_tree, f, indent=2, ensure_ascii=False)
    print(f"Tree saved to {OUTPUT_TREE}")

if __name__ == "__main__":
    main()