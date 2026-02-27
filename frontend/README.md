# Tech Standards — Frontend

React UI for the Tech Standards RAG and agent pipeline. Built for QAs and senior managers to ingest documents, run analysis, and review agent findings.

## Features

- **Ingest** — Upload documents (DOCX, PDF, DOC) to the vector store
- **Analyse** — Run the agent pipeline (query vector store, challenge documents)
- **Results** — View flag counts, agent outputs (specifying, sequencing, formatting, compliance, terminology, conflicts, risk gaps)
- **Metrics** — Draft ready status, overall risk, flag counts by category

## Setup

1. Start the FastAPI backend (port 8000):
   ```bash
   uvicorn main:app --reload --port 8000
   ```

2. Install and run the frontend:
   ```bash
   cd frontend
   npm install
   npm run dev
   ```

3. Open http://localhost:5173

The frontend proxies API requests to the backend during development. For production, set `VITE_API_URL` to the backend URL.

## API

- `POST /ingest/file` — File upload (DOCX, PDF, DOC)
- `POST /analyse` — Run analysis with query, doc_layer, sites, policy_ref
