import os
import json
import wikipediaapi
from tqdm import tqdm

# Constants
# Get the absolute path of the directory this script is in: .../backend/database/utils
CURRENT_DIR = os.path.dirname(os.path.abspath(__file__))
# Navigate up to .../backend
BACKEND_DIR = os.path.dirname(os.path.dirname(CURRENT_DIR))
DATA_DIR = os.path.join(BACKEND_DIR, 'data')
RAW_DIR = os.path.join(DATA_DIR, 'raw')
OUTPUT_FILE = os.path.join(RAW_DIR, 'articles.json')

# Ensure directories exist
os.makedirs(RAW_DIR, exist_ok=True)

# Topics to scrape
TOPICS = [
    "Tennis",
    "History of tennis",
    "Grand Slam (tennis)",
    "Roger Federer",
    "Rafael Nadal",
    "Novak Djokovic",
    "Serena Williams",
    "Wimbledon Championships",
    "US Open (tennis)",
    "French Open",
    "Australian Open",
    "Association of Tennis Professionals",
    "Women's Tennis Association",
    "Steffi Graf",
    "Pete Sampras",
    "Andre Agassi",
    "Bjorn Borg",
    "Rod Laver",
    "Margaret Court",
    "Martina Navratilova",
    "Chris Evert",
    "Billie Jean King",
    "Arthur Ashe",
    "Tennis scoring system",
    "Types of tennis match",
    "Tennis court",
    "Hawk-Eye",
    "ATP Tour",
    "WTA Tour",
    "Davis Cup",
    "Billie Jean King Cup"
]

def fetch_articles():
    # Initialize Wikipedia API
    # User agent is required by Wikipedia API policy
    wiki_wiki = wikipediaapi.Wikipedia(
        user_agent='TennisRAGAgent/1.0 (Development; +https://github.com/regional-specter/R-Federer)',
        language='en',
        extract_format=wikipediaapi.ExtractFormat.WIKI
    )

    articles_data = []

    print(f"Starting scrap for {len(TOPICS)} topics...")
    
    for title in tqdm(TOPICS):
        page = wiki_wiki.page(title)
        
        if page.exists():
            # print(f"Fetched: {title}")
            articles_data.append({
                "title": page.title,
                "summary": page.summary,
                "content": page.text,
                "url": page.fullurl,
                "categories": list(page.categories.keys())
            })
        else:
            print(f"Page not found: {title}")

    # Save to JSON
    with open(OUTPUT_FILE, 'w', encoding='utf-8') as f:
        json.dump(articles_data, f, ensure_ascii=False, indent=4)
    
    print(f"Successfully saved {len(articles_data)} articles to {OUTPUT_FILE}")

if __name__ == "__main__":
    fetch_articles()
