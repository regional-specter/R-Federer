# 🎾 R-Federer
A tennis-knowledge RAG system that retrieves and answers questions via RAG (Python + Ink terminal UI)

<p align="center">
  <img src="https://github.com/user-attachments/assets/c336b32d-b1d3-4a3d-afc6-ce6d66b0be22" width="700" alt="RAG Pipeline Diagram" />
</p>


### Intro to Retrieval-Augmented Generation (RAG)

<p align="center">
  <img width="750" alt="What is RAG ?" src="https://github.com/user-attachments/assets/ab198a2e-b8ea-4dc3-b99e-728342f66c8e" />
</p>

- **Retrieval-Augmented Generation (RAG)** is the process of optimizing the output of a large language model, so it references an authoritative knowledge base outside of its training data sources before generating a response.
- Large Language Models (LLMs) are trained on vast volumes of data and use billions of parameters to generate original output for tasks like answering questions, translating languages, and completing sentences.
- RAG extends the already powerful capabilities of LLMs to specific domains or an organization's internal knowledge base, all without the need to retrain the model. It is a cost-effective approach to improving LLM output so it remains relevant, accurate, and useful in various contexts.
- The nature of LLM technology introduces unpredictability in LLM responses. Additionally, LLM training data is static and introduces a cut-off date on the knowledge it has.
- Known **challenges of LLMs** include :
    - Presenting false information when it does not have the answer.
    - Presenting out-of-date or generic information when the user expects a specific, current response.
    - Creating a response from non-authoritative sources.
    - Creating inaccurate responses due to terminology confusion, wherein different training sources use the same terminology to talk about different things.

<div style="background-color: rgba(0, 128, 0, 0.5); padding: 15px; border-radius: 10px; color: white;">
    <ul>
        <li>RAG is one approach to solving some of these challenges. It redirects the LLM to retrieve relevant information from authoritative, pre-determined knowledge sources.</li>
        <li>Organizations have greater control over the generated text output, and users gain insights into how the LLM generates the response.</li>
    </ul>
</div>

## RAG Pipeline Structure

### Stage 1: Data Ingestion + Text Processing

**1. Wiki Data Collection**

The pipeline uses articles-scraper.py to target the Wikipedia API. It fetches specific tennis-related topics (e.g., "Roger Federer", "Wimbledon") and stores the raw results as JSON with fields for title, summary, and URL.

**2. Text Cleaning & Normalization**

text-processing.py handles the raw input by stripping citations and whitespace. It ensures the text is clean before further processing to prevent noise in the vector space.

**3. Recursive Chunking**

The cleaned text is split into segments of approximately 1,000 characters with a 200-character overlap. Each chunk is assigned a unique ID and saved in chunks.json for mapping back to the source.

---

### Stage 2: Vector Embedding & Storage

**1. Generate Semantic Embeddings**

The pipeline utilizes the all-MiniLM-L6-v2 model via SentenceTransformerEmbeddingFunction. This transforms the text chunks into high-dimensional numerical vectors that capture the semantic meaning of the tennis content.

**2. ChromaDB Upsert**

Using chroma_client.py, the vectors are upserted into the tennis_knowledge collection. This persistent storage at backend/data/chromadb allows for lightning-fast similarity searches later.

**3. Metadata Attachment**

Alongside each vector, the system stores specific metadata tags: the source URL, article title, and chunk index. This ensures that every retrieved result remains context-aware and attributable.

---

### Stage 3: Query Processing & Retrieval

**1. Similarity Search (DPR)**

When a user asks a question like "Who is Roger Federer?", dpr_pipeline.py converts the query into an embedding and performs a vector search against the ChromaDB collection.

**2. Distance-Based Ranking**

The system retrieves the Top 5 most relevant chunks. It ranks them based on a "distance" score—the closer the vector is to the query in the embedding space, the higher it ranks in the results.

**3. Contextual Output**

The final step returns the text snippets paired with their source metadata. This allows the user (or a downstream LLM) to see the most relevant facts with a direct link back to the original Wikipedia source.
