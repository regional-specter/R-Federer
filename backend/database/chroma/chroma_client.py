import chromadb
from chromadb.utils import embedding_functions
import os

# Constants
# Path to backend/data/chromadb
CHROMA_PATH = os.path.join(os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__)))), 'data', 'chromadb')
COLLECTION_NAME = "tennis_knowledge"

def get_chroma_client():
    # Ensure the directory exists
    os.makedirs(CHROMA_PATH, exist_ok=True)
    return chromadb.PersistentClient(path=CHROMA_PATH)

def get_collection():
    client = get_chroma_client()
    
    # Use the sentence-transformers model as specified
    # This automatically handles embedding generation
    sentence_transformer_ef = embedding_functions.SentenceTransformerEmbeddingFunction(model_name="all-MiniLM-L6-v2")
    
    collection = client.get_or_create_collection(
        name=COLLECTION_NAME,
        embedding_function=sentence_transformer_ef
    )
    return collection
