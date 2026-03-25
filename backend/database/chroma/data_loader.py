import json
import os
import sys
from tqdm import tqdm

# Add backend directory to sys.path to allow imports
current_dir = os.path.dirname(os.path.abspath(__file__))
# up to backend/database/chroma -> backend/database -> backend
backend_path = os.path.dirname(os.path.dirname(os.path.dirname(current_dir)))
if backend_path not in sys.path:
    sys.path.append(backend_path)

# Now we can import from backend...
# However, since we are inside backend package structure conceptually, 
# but running as script, we need to be careful.
# The sys.path append adds the ROOT of the project (if backend_path is root) or the parent of backend.
# Let's assume backend_path is the project root containing 'backend' folder.
# My calculation:
# current: .../backend/database/chroma
# dirname: .../backend/database
# dirname: .../backend
# dirname: .../ (project root)

# So if we add project root to path, we can do `from backend.database.chroma.chroma_client import ...`

project_root = os.path.dirname(os.path.dirname(os.path.dirname(current_dir)))
sys.path.append(project_root)

try:
    from backend.database.chroma.chroma_client import get_collection
except ImportError:
    # Fallback for relative run
    from chroma_client import get_collection

PROCESSED_FILE = os.path.join(project_root, 'backend', 'data', 'processed', 'chunks.json')

def load_data():
    if not os.path.exists(PROCESSED_FILE):
        print(f"Processed file not found: {PROCESSED_FILE}")
        print("Please run the text processor first.")
        return

    print("Initializing ChromaDB collection...")
    try:
        collection = get_collection()
    except Exception as e:
        print(f"Error initializing collection: {e}")
        return
    
    print(f"Reading chunks from {PROCESSED_FILE}...")
    with open(PROCESSED_FILE, 'r', encoding='utf-8') as f:
        chunks = json.load(f)
    
    total_chunks = len(chunks)
    print(f"Found {total_chunks} chunks.")
    
    batch_size = 100
    print(f"Upserting into ChromaDB in batches of {batch_size}...")
    
    for i in tqdm(range(0, total_chunks, batch_size)):
        batch = chunks[i:i+batch_size]
        
        ids = [item['id'] for item in batch]
        documents = [item['text'] for item in batch]
        metadatas = [item['metadata'] for item in batch]
        
        collection.upsert(
            ids=ids,
            documents=documents,
            metadatas=metadatas
        )
        
    print("Data loading complete.")

if __name__ == "__main__":
    load_data()
