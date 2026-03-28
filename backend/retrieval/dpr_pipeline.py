import os
import sys
import json

# Add project root to sys.path
current_dir = os.path.dirname(os.path.abspath(__file__))
project_root = os.path.dirname(os.path.dirname(current_dir))
sys.path.append(project_root)

try:
    from backend.database.chroma.chroma_client import get_collection
except ImportError:
    # Fallback for different execution contexts
    sys.path.append(os.path.join(project_root, 'backend'))
    from database.chroma.chroma_client import get_collection

def search_tennis_knowledge(query, n_results=5):
    """
    Searches the ChromaDB collection for the most relevant tennis chunks.
    """
    try:
        collection = get_collection()
        
        results = collection.query(
            query_texts=[query],
            n_results=n_results
        )
        
        # Structure the results for easier consumption
        formatted_results = []
        
        # results['documents'], results['metadatas'], results['distances'] are lists of lists
        if results['documents']:
            for i in range(len(results['documents'][0])):
                formatted_results.append({
                    "content": results['documents'][0][i],
                    "metadata": results['metadatas'][0][i],
                    "distance": results['distances'][0][i] if 'distances' in results else None
                })
        
        return formatted_results
    except Exception as e:
        return {"error": str(e)}

if __name__ == "__main__":
    import argparse
    from tabulate import tabulate
    import warnings
    
    # Suppress FutureWarnings globally for a cleaner CLI experience
    warnings.filterwarnings("ignore", category=FutureWarning)

    parser = argparse.ArgumentParser()
    parser.add_argument("query", nargs="*", help="The search query")
    parser.add_argument("--json", action="store_true", help="Output results in JSON format")
    parser.add_argument("--top_k", type=int, default=5, help="Number of results to return")
    args = parser.parse_args()
    
    query = " ".join(args.query) if args.query else "Who is Roger Federer?"
    
    results = search_tennis_knowledge(query, n_results=args.top_k)
    
    if args.json:
        print(json.dumps(results))
    else:
        print(f"\nFEDERER-AI SEARCH ENGINE")
        print(f"Query: \"{query}\"")
        print("-" * 50)
        
        if isinstance(results, dict) and "error" in results:
            print(f"Error: {results['error']}")
        elif not results:
            print("No relevant results found.")
        else:
            table_data = []
            for i, res in enumerate(results):
                # Format distance to 4 decimal places
                dist_str = f"{res['distance']:.4g}" if res['distance'] is not None else "N/A"
                
                # Clean up snippet for table (remove newlines, truncate)
                snippet = res['content'][:120].replace('\n', ' ') + "..."
                
                table_data.append([
                    i + 1, 
                    res['metadata']['title'], 
                    dist_str, 
                    snippet
                ])
            
            headers = ["#", "Source Article", "Distance", "Content Snippet"]
            print(tabulate(table_data, headers=headers, tablefmt="fancy_grid", maxcolwidths=[None, 20, None, 60]))
            
            print(f"\nFound {len(results)} relevant chunks in vector storage.")
