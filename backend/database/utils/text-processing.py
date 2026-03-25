import os
import json
import re
from tqdm import tqdm
import uuid

# Constants
CURRENT_DIR = os.path.dirname(os.path.abspath(__file__))
BACKEND_DIR = os.path.dirname(os.path.dirname(CURRENT_DIR))
DATA_DIR = os.path.join(BACKEND_DIR, 'data')
RAW_DIR = os.path.join(DATA_DIR, 'raw')
PROCESSED_DIR = os.path.join(DATA_DIR, 'processed')
INPUT_FILE = os.path.join(RAW_DIR, 'articles.json')
OUTPUT_FILE = os.path.join(PROCESSED_DIR, 'chunks.json')

# Ensure directories exist
os.makedirs(PROCESSED_DIR, exist_ok=True)

def clean_text(text):
    """
    Basic text cleaning.
    """
    # Remove citations like [1], [12], etc.
    text = re.sub(r'\[\d+\]', '', text)
    # Remove multiple newlines
    text = re.sub(r'\n\s*\n', '\n\n', text)
    # Strip whitespace
    return text.strip()

def chunk_text(text, chunk_size=1000, overlap=200):
    """
    Splits text into chunks of approximately chunk_size characters with overlap.
    Uses a simple sliding window with basic boundary detection.
    """
    chunks = []
    start = 0
    text_len = len(text)
    
    while start < text_len:
        end = start + chunk_size
        
        # If we are not at the end, try to find a sentence ending or space to break at
        if end < text_len:
            # Look for the last period or newline in the window to break cleanly
            last_period = text.rfind('.', start, end)
            last_newline = text.rfind('\n', start, end)
            
            # Prioritize breaking at paragraphs (newlines) then sentences (periods)
            break_point = max(last_period, last_newline)
            
            # If we found a valid break point in the second half of the chunk, use it
            if break_point != -1 and break_point > start + (chunk_size // 2):
                end = break_point + 1 # Include the punctuation
        
        chunk = text[start:end].strip()
        if chunk:
            chunks.append(chunk)
        
        # Move start forward, respecting overlap
        # If we are near the end, just advance by chunk_size - overlap
        step = chunk_size - overlap
        start += step
        
    return chunks

def process_articles():
    if not os.path.exists(INPUT_FILE):
        print(f"Input file not found: {INPUT_FILE}")
        print("Please run the scraper first: python articles-scraper.py")
        return

    with open(INPUT_FILE, 'r', encoding='utf-8') as f:
        articles = json.load(f)

    processed_chunks = []
    
    print(f"Processing {len(articles)} articles...")
    
    for article in tqdm(articles):
        cleaned_content = clean_text(article['content'])
        chunks = chunk_text(cleaned_content)
        
        for i, chunk in enumerate(chunks):
            chunk_entry = {
                "id": str(uuid.uuid4()),
                "text": chunk,
                "metadata": {
                    "source_url": article['url'],
                    "title": article['title'],
                    "chunk_index": i
                }
            }
            processed_chunks.append(chunk_entry)

    with open(OUTPUT_FILE, 'w', encoding='utf-8') as f:
        json.dump(processed_chunks, f, ensure_ascii=False, indent=4)

    print(f"Successfully created {len(processed_chunks)} chunks from {len(articles)} articles.")
    print(f"Saved to {OUTPUT_FILE}")

if __name__ == "__main__":
    process_articles()
