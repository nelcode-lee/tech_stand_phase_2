# Supabase vector store setup

The RAG service uses **Supabase** with the **pgvector** extension as the vector database. The Python client **vecs** talks to Supabase using the PostgreSQL connection string.

## 1. Enable pgvector in Supabase

1. In the [Supabase Dashboard](https://supabase.com/dashboard), open your project.
2. Go to **Database** → **Extensions**.
3. Search for **vector** (pgvector) and enable it.

## 2. Get the database connection string

1. Go to **Project Settings** → **Database**.
2. Under **Connection string**, copy the **URI** (use the pooler connection for serverless if you prefer, e.g. port **6543**).
3. Replace `[YOUR-PASSWORD]` with your database password.
4. Set this as `SUPABASE_DB_URL` in your environment or `.env`:

   ```
   SUPABASE_DB_URL=postgresql://postgres.[project-ref]:[YOUR-PASSWORD]@aws-0-[region].pooler.supabase.com:6543/postgres
   ```

## 3. No manual table creation

The **vecs** library creates and manages the collection (`document_chunks`) automatically when the app first runs. It creates the required tables and indexes for pgvector.

## 4. Retrieval (later)

For similarity search (retriever), use the same vecs collection: `collection.query(...)` with an embedding and optional metadata filters (e.g. `doc_layer`, `sites`, `policy_ref`). See vecs docs for `query()` and filters.
